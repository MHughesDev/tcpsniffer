/**
 * Integration tests: output pipeline (message shape, callback, stdout, outputUrl).
 * Feeds a known HttpMessage into deliverMessage and asserts contract and behaviour.
 */

import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { deliverMessage } from './output.js';
import type { HttpMessage } from './types.js';

const fixtureMessage: HttpMessage = {
  receiver: { ip: '10.0.0.1', port: 8080 },
  destination: { ip: '10.0.0.2', port: 443 },
  direction: 'request',
  headers: { 'content-type': 'application/json', host: 'example.com' },
  timestamp: '2025-01-01T12:00:00.000Z',
  method: 'GET',
  path: '/api/health',
  statusCode: undefined,
  body: '',
};

function assertMessageShape(obj: unknown): asserts obj is HttpMessage {
  assert.ok(obj && typeof obj === 'object');
  const o = obj as Record<string, unknown>;
  assert.ok(o.receiver && typeof (o.receiver as any).ip === 'string' && typeof (o.receiver as any).port === 'number');
  assert.ok(o.destination && typeof (o.destination as any).ip === 'string');
  assert.ok(o.direction === 'request' || o.direction === 'response');
  assert.ok(typeof o.headers === 'object');
  assert.ok(typeof o.timestamp === 'string');
}

describe('Output pipeline integration', () => {
  describe('message shape and delivery', () => {
    it('delivers fixture to callback with required fields (receiver, destination, direction, headers, timestamp)', () => {
      const onHttpMessage = mock.fn();
      deliverMessage({ onHttpMessage }, fixtureMessage);
      assert.equal(onHttpMessage.mock.calls.length, 1);
      const delivered = onHttpMessage.mock.calls[0].arguments[0];
      assertMessageShape(delivered);
      assert.equal((delivered as HttpMessage).receiver.ip, fixtureMessage.receiver.ip);
      assert.equal((delivered as HttpMessage).destination.port, fixtureMessage.destination.port);
      assert.equal((delivered as HttpMessage).direction, fixtureMessage.direction);
      assert.equal((delivered as HttpMessage).timestamp, fixtureMessage.timestamp);
    });

    it('writes one JSON line to stdout with required fields when outputStdout is true', () => {
      const chunks: string[] = [];
      const origWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = ((chunk: string | Buffer, encoding?: BufferEncoding, cb?: (err?: Error | null) => void) => {
        chunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
        return origWrite(chunk, encoding, cb);
      }) as typeof process.stdout.write;
      try {
        deliverMessage({ outputStdout: true }, fixtureMessage);
        assert.ok(chunks.length >= 1);
        const line = chunks.find((c) => c.trim().startsWith('{'));
        assert.ok(line);
        const parsed = JSON.parse(line.trim()) as unknown;
        assertMessageShape(parsed);
        assert.equal((parsed as HttpMessage).receiver.ip, fixtureMessage.receiver.ip);
        assert.equal((parsed as HttpMessage).path, fixtureMessage.path);
      } finally {
        process.stdout.write = origWrite;
      }
    });

    it('callback and stdout receive the same redacted message (default redact list)', () => {
      const msgWithSensitive: HttpMessage = {
        ...fixtureMessage,
        headers: { ...fixtureMessage.headers, authorization: 'Bearer x', cookie: 'y' },
      };
      const callbackReceived = mock.fn();
      const chunks: string[] = [];
      const origWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = ((chunk: string | Buffer, encoding?: BufferEncoding, cb?: (err?: Error | null) => void) => {
        chunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
        return origWrite(chunk, encoding, cb);
      }) as typeof process.stdout.write;
      try {
        deliverMessage({ onHttpMessage: callbackReceived, outputStdout: true }, msgWithSensitive);
        const delivered = callbackReceived.mock.calls[0].arguments[0] as HttpMessage;
        assert.equal(delivered.headers['authorization'], '[REDACTED]');
        assert.equal(delivered.headers['cookie'], '[REDACTED]');
        const line = chunks.find((c) => c.trim().startsWith('{'));
        const parsed = JSON.parse(line!.trim()) as HttpMessage;
        assert.equal(parsed.headers['authorization'], '[REDACTED]');
      } finally {
        process.stdout.write = origWrite;
      }
    });
  });

  describe('callback error handling', () => {
    it('when callback throws, deliverMessage does not throw and error is swallowed', () => {
      const onHttpMessage = () => {
        throw new Error('callback error');
      };
      assert.doesNotThrow(() => {
        deliverMessage({ onHttpMessage }, fixtureMessage);
      });
    });
  });

  describe('outputUrl POST', () => {
    let fetchCalls: Array<{ url: string; body: string; method: string }>;
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      fetchCalls = [];
      originalFetch = globalThis.fetch;
      globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
        const u = typeof url === 'string' ? url : url.toString();
        fetchCalls.push({
          url: u,
          body: (init?.body as string) ?? '',
          method: init?.method ?? 'GET',
        });
        return new Response('', { status: 200 });
      }) as typeof fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('POSTs message body as JSON to outputUrl with correct shape', async () => {
      deliverMessage(
        { outputUrl: 'https://example.com/ingest' },
        fixtureMessage
      );
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(fetchCalls.length, 1);
      assert.equal(fetchCalls[0].method, 'POST');
      assert.equal(fetchCalls[0].url, 'https://example.com/ingest');
      const body = JSON.parse(fetchCalls[0].body) as unknown;
      assertMessageShape(body);
      assert.equal((body as HttpMessage).path, '/api/health');
    });

    it('retries on 5xx until success (3 requests: 500, 500, 200)', { timeout: 10_000 }, async () => {
      let attempt = 0;
      globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
        attempt += 1;
        const u = typeof url === 'string' ? url : url.toString();
        fetchCalls.push({ url: u, body: (init?.body as string) ?? '', method: init?.method ?? 'GET' });
        return new Response('', { status: attempt < 3 ? 500 : 200 });
      }) as typeof fetch;

      deliverMessage(
        { outputUrl: 'https://example.com/ingest' },
        fixtureMessage
      );
      // Retry delays are 1s, 2s, 4s; wait for all retries
      await new Promise((r) => setTimeout(r, 7500));
      assert.equal(fetchCalls.length, 3, 'fetch should be called 3 times (500, 500, 200)');
    });
  });
});
