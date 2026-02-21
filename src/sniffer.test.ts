/**
 * Stream B: createSniffer, start/stop/isRunning, output pipeline (callback + stdout).
 * Includes shutdown/drain tests and optional subprocess SIGTERM test.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSniffer } from './sniffer.js';
import type { HttpMessage } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('createSniffer', () => {
  it('returns a Sniffer with start, stop, isRunning', () => {
    const sniffer = createSniffer({ ports: [8080], onHttpMessage: () => {} });
    assert.equal(typeof sniffer.start, 'function');
    assert.equal(typeof sniffer.stop, 'function');
    assert.equal(typeof sniffer.isRunning, 'function');
    assert.equal(sniffer.isRunning(), false);
  });
});

describe('Sniffer lifecycle', () => {
  it('start() then isRunning() is true, stop() then isRunning() is false', async () => {
    const sniffer = createSniffer({ ports: [8080], onHttpMessage: () => {} });
    await sniffer.start();
    assert.equal(sniffer.isRunning(), true);
    await sniffer.stop();
    assert.equal(sniffer.isRunning(), false);
  });

  it('stop() when not running is safe', async () => {
    const sniffer = createSniffer({ ports: [8080], onHttpMessage: () => {} });
    await sniffer.stop();
    await sniffer.stop();
    assert.equal(sniffer.isRunning(), false);
  });

  it('start() rejects when config is invalid', async () => {
    const sniffer = createSniffer({ ports: [] as unknown as number[], onHttpMessage: () => {} });
    await assert.rejects(sniffer.start(), /ports/);
    assert.equal(sniffer.isRunning(), false);
  });
});

describe('Output pipeline (mock engine)', () => {
  it('delivers fixture messages to onHttpMessage callback', async () => {
    const received: HttpMessage[] = [];
    const sniffer = createSniffer({
      ports: [8080],
      onHttpMessage: (msg) => received.push(msg),
    });
    await sniffer.start();
    await new Promise((r) => setTimeout(r, 50));
    await sniffer.stop();
    assert.ok(received.length >= 1, 'at least one message from mock');
    const first = received[0];
    assert.equal(first.direction, 'request');
    assert.equal(first.method, 'GET');
    assert.equal(first.path, '/api/health');
    assert.deepEqual(first.receiver, { ip: '10.0.0.1', port: 8080 });
  });

  it('delivers messages to stdout when outputStdout is true', async () => {
    const lines: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    const mockWrite = (
      chunk: string | Uint8Array,
      encoding?: BufferEncoding | ((err?: Error | null) => void),
      cb?: (err?: Error | null) => void
    ): boolean => {
      if (typeof chunk === 'string') lines.push(chunk);
      const callback = typeof encoding === 'function' ? encoding : cb;
      return origWrite(chunk, encoding as BufferEncoding, callback);
    };
    process.stdout.write = mockWrite as typeof process.stdout.write;
    const sniffer = createSniffer({ ports: [8080], outputStdout: true });
    await sniffer.start();
    await new Promise((r) => setTimeout(r, 50));
    await sniffer.stop();
    process.stdout.write = origWrite;
    // Stdout contains both log lines and HTTP message lines; find an HTTP message (has direction)
    const msgLine = lines.find((s) => {
      try {
        const o = JSON.parse(s.trim()) as Record<string, unknown>;
        return o.direction === 'request' || o.direction === 'response';
      } catch {
        return false;
      }
    });
    assert.ok(msgLine, 'expected at least one HTTP message line on stdout');
    const parsed = JSON.parse(msgLine!.trim()) as HttpMessage;
    assert.equal(parsed.direction, 'request');
    assert.equal(parsed.method, 'GET');
  });
});

describe('Shutdown / drain', () => {
  it('stop() allows in-flight messages to be delivered before resolving', async () => {
    const received: HttpMessage[] = [];
    const sniffer = createSniffer({
      ports: [8080],
      onHttpMessage: (msg) => received.push(msg),
    });
    await sniffer.start();
    // Mock engine emits 2 messages (request + response) with small delays; wait for first then stop
    await new Promise((r) => setTimeout(r, 20));
    await sniffer.stop();
    // After stop() resolves, we should have received all messages the engine emitted (drain)
    assert.ok(received.length >= 1, 'at least one message delivered');
    assert.ok(received.length <= 2, 'mock emits at most 2');
    assert.equal(sniffer.isRunning(), false);
  });

  it('entrypoint exits 0 on SIGTERM (graceful shutdown)', { skip: process.platform === 'win32' }, async () => {
    const entrypointPath = path.resolve(__dirname, 'entrypoint.js');
    const child = spawn(process.execPath, [entrypointPath], {
      env: { ...process.env, PORTS: '8080' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (c) => { stderr += c.toString(); });
    child.stdout?.on('data', () => {});
    await new Promise((r) => setTimeout(r, 200));
    child.kill('SIGTERM');
    const exit = await new Promise<number | null>((resolve) => {
      child.on('exit', (code) => resolve(code ?? null));
      setTimeout(() => resolve(null), 5000);
    });
    assert.equal(exit, 0, 'expected exit 0 after SIGTERM; stderr: ' + stderr.slice(-500));
  });
});
