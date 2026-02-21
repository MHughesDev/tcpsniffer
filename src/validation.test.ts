/**
 * Phase 0: config validation per TS_CPP_CONTRACT.md §5.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, ValidationError, hasOutputConfigured } from './validation.js';
import { CONTRACT_DEFAULTS } from './constants.js';

describe('validateConfig', () => {
  it('accepts minimal valid config (ports only) and applies defaults', () => {
    const engine = validateConfig({ ports: [8080] });
    assert.equal(engine.ports.length, 1);
    assert.equal(engine.ports[0], 8080);
    assert.equal(engine.interface, CONTRACT_DEFAULTS.interface);
    assert.equal(engine.sampleRate, CONTRACT_DEFAULTS.sampleRate);
    assert.equal(engine.maxBodySize, CONTRACT_DEFAULTS.maxBodySize);
    assert.equal(engine.maxConcurrentConnections, CONTRACT_DEFAULTS.maxConcurrentConnections);
    assert.equal(engine.connectionIdleTimeoutMs, CONTRACT_DEFAULTS.connectionIdleTimeoutMs);
  });

  it('accepts full valid config and preserves provided values', () => {
    const engine = validateConfig({
      interface: 'eth0',
      ports: [80, 443],
      sampleRate: 0.1,
      maxBodySize: 4096,
      maxConcurrentConnections: 5000,
      connectionIdleTimeoutMs: 60_000,
    });
    assert.equal(engine.interface, 'eth0');
    assert.deepEqual(engine.ports, [80, 443]);
    assert.equal(engine.sampleRate, 0.1);
    assert.equal(engine.maxBodySize, 4096);
    assert.equal(engine.maxConcurrentConnections, 5000);
    assert.equal(engine.connectionIdleTimeoutMs, 60_000);
  });

  it('rejects missing ports', () => {
    assert.throws(
      () => validateConfig({ ports: [] as unknown as number[] }),
      (err: Error) => err instanceof ValidationError && err.message.includes('non-empty')
    );
  });

  it('rejects invalid port (out of range)', () => {
    assert.throws(
      () => validateConfig({ ports: [0] }),
      (err: Error) => err instanceof ValidationError && err.field === 'ports'
    );
    assert.throws(
      () => validateConfig({ ports: [65536] }),
      (err: Error) => err instanceof ValidationError && err.field === 'ports'
    );
  });

  it('rejects invalid sampleRate', () => {
    assert.throws(
      () => validateConfig({ ports: [8080], sampleRate: -0.1 }),
      (err: Error) => err instanceof ValidationError && err.field === 'sampleRate'
    );
    assert.throws(
      () => validateConfig({ ports: [8080], sampleRate: 1.5 }),
      (err: Error) => err instanceof ValidationError && err.field === 'sampleRate'
    );
  });

  it('rejects invalid maxBodySize', () => {
    assert.throws(
      () => validateConfig({ ports: [8080], maxBodySize: 0 }),
      (err: Error) => err instanceof ValidationError && err.field === 'maxBodySize'
    );
  });

  it('rejects non-object config', () => {
    assert.throws(
      () => validateConfig(null as unknown as Parameters<typeof validateConfig>[0]),
      ValidationError
    );
  });

  it('in production, rejects outputUrl with http (requires https)', () => {
    const origNodeEnv = process.env.NODE_ENV;
    const origTcp = process.env.TCP_SNIFFER_PRODUCTION;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.TCP_SNIFFER_PRODUCTION;
      assert.throws(
        () => validateConfig({ ports: [8080], outputUrl: 'http://example.com/ingest' }),
        (err: Error) =>
          err instanceof ValidationError &&
          err.message.includes('HTTPS') &&
          err.field === 'outputUrl'
      );
    } finally {
      if (origNodeEnv !== undefined) process.env.NODE_ENV = origNodeEnv;
      else delete process.env.NODE_ENV;
      if (origTcp !== undefined) process.env.TCP_SNIFFER_PRODUCTION = origTcp;
      else delete process.env.TCP_SNIFFER_PRODUCTION;
    }
  });

  it('in production, accepts outputUrl with https', () => {
    const orig = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      const engine = validateConfig({
        ports: [8080],
        outputUrl: 'https://example.com/ingest',
      });
      assert.equal(engine.ports[0], 8080);
    } finally {
      if (orig !== undefined) process.env.NODE_ENV = orig;
      else delete process.env.NODE_ENV;
    }
  });

  it('when not production, accepts outputUrl with http', () => {
    const origNodeEnv = process.env.NODE_ENV;
    const origTcp = process.env.TCP_SNIFFER_PRODUCTION;
    try {
      process.env.NODE_ENV = 'development';
      delete process.env.TCP_SNIFFER_PRODUCTION;
      const engine = validateConfig({
        ports: [8080],
        outputUrl: 'http://localhost:3000',
      });
      assert.equal(engine.ports[0], 8080);
    } finally {
      if (origNodeEnv !== undefined) process.env.NODE_ENV = origNodeEnv;
      else delete process.env.NODE_ENV;
      if (origTcp !== undefined) process.env.TCP_SNIFFER_PRODUCTION = origTcp;
      else delete process.env.TCP_SNIFFER_PRODUCTION;
    }
  });

  it('in production with TCP_SNIFFER_PRODUCTION=1, rejects http outputUrl', () => {
    const origNodeEnv = process.env.NODE_ENV;
    const origTcp = process.env.TCP_SNIFFER_PRODUCTION;
    try {
      delete process.env.NODE_ENV;
      process.env.TCP_SNIFFER_PRODUCTION = '1';
      assert.throws(
        () => validateConfig({ ports: [8080], outputUrl: 'http://x.com' }),
        (err: Error) => err instanceof ValidationError && err.message.includes('HTTPS')
      );
    } finally {
      if (origNodeEnv !== undefined) process.env.NODE_ENV = origNodeEnv;
      else delete process.env.NODE_ENV;
      if (origTcp !== undefined) process.env.TCP_SNIFFER_PRODUCTION = origTcp;
      else delete process.env.TCP_SNIFFER_PRODUCTION;
    }
  });

  it('rejects invalid outputUrl in production (rethrows as ValidationError)', () => {
    const orig = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      assert.throws(
        () => validateConfig({ ports: [8080], outputUrl: 'not-a-valid-url' }),
        (err: Error) =>
          err instanceof ValidationError &&
          err.field === 'outputUrl' &&
          err.message.includes('invalid')
      );
    } finally {
      if (orig !== undefined) process.env.NODE_ENV = orig;
      else delete process.env.NODE_ENV;
    }
  });
});

describe('hasOutputConfigured', () => {
  it('returns false when no output is set', () => {
    assert.equal(hasOutputConfigured({ ports: [8080] }), false);
  });
  it('returns true when outputUrl is set', () => {
    assert.equal(hasOutputConfigured({ ports: [8080], outputUrl: 'https://example.com' }), true);
  });
  it('returns true when outputStdout is true', () => {
    assert.equal(hasOutputConfigured({ ports: [8080], outputStdout: true }), true);
  });
  it('returns true when onHttpMessage is set', () => {
    assert.equal(
      hasOutputConfigured({ ports: [8080], onHttpMessage: () => {} }),
      true
    );
  });
});
