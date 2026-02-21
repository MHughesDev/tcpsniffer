/**
 * Mock engine for Stream B2: emits fixture HTTP messages so TS output pipeline can be tested
 * without the C++ addon. Swap in real C++ when A4 is ready.
 */

import type { Engine, EngineCallbacks } from './engine.js';
import type { EngineConfig, HttpMessage } from './types.js';

const FIXTURE_REQUEST: HttpMessage = {
  receiver: { ip: '10.0.0.1', port: 8080 },
  destination: { ip: '10.0.0.2', port: 45678 },
  direction: 'request',
  method: 'GET',
  path: '/api/health',
  headers: { host: 'localhost:8080', accept: '*/*' },
  body: '',
  timestamp: new Date().toISOString(),
};

const FIXTURE_RESPONSE: HttpMessage = {
  receiver: { ip: '10.0.0.1', port: 8080 },
  destination: { ip: '10.0.0.2', port: 45678 },
  direction: 'response',
  statusCode: 200,
  headers: { 'content-type': 'application/json' },
  body: '{"ok":true}',
  timestamp: new Date().toISOString(),
};

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Mock engine: on start, emits a few fixture messages after a short delay, then idles.
 * stop() resolves immediately (no in-flight messages to drain).
 */
export function createMockEngine(): Engine {
  let callbacks: EngineCallbacks | null = null;
  let running = false;

  return {
    async start(_config: EngineConfig, cbs: EngineCallbacks): Promise<void> {
      if (running) {
        throw new Error('Engine already started');
      }
      callbacks = cbs;
      running = true;
      // Emit fixture messages after a brief delay so start() can resolve first
      await delayMs(10);
      if (!running || !callbacks) return;
      callbacks.onMessage({ ...FIXTURE_REQUEST, timestamp: new Date().toISOString() });
      await delayMs(5);
      if (!running || !callbacks) return;
      callbacks.onMessage({ ...FIXTURE_RESPONSE, timestamp: new Date().toISOString() });
    },

    async stop(): Promise<void> {
      running = false;
      callbacks = null;
      await delayMs(0);
    },
  };
}
