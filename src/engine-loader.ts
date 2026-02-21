/**
 * Engine loader: try to load the built C++ addon; fall back to mock when missing or not built.
 * Used by createSniffer so the container can use the real engine when the addon is built.
 */

import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Engine, CaptureStats } from './engine.js';
import { createMockEngine } from './engine-mock.js';
import { logInfo, logWarn } from './logger.js';
import type { EngineConfig, EngineError, HttpMessage } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Path to the native addon (node-gyp default: build/Release/<target_name>.node). */
function getAddonPath(): string {
  const root = path.resolve(__dirname, '..');
  return path.join(root, 'build', 'Release', 'tcp_sniffer_native.node');
}

/**
 * Wraps the raw addon (start(config, onMessage?), stop(), getLastError()) into the Engine interface.
 */
function wrapNativeAddon(addon: {
  start: (config: unknown, onMessage?: (msg: HttpMessage) => void) => boolean;
  stop: () => Record<string, unknown> | void;
  getLastError: () => { code: string; message: string };
}): Engine {
  return {
    async start(config: EngineConfig, callbacks: { onMessage: (msg: HttpMessage) => void; onError: (err: EngineError) => void }): Promise<void> {
      try {
        const onMessage = (msg: HttpMessage): void => callbacks.onMessage(msg);
        const ok = addon.start(config, onMessage);
        if (!ok) {
          const err = addon.getLastError();
          const engineError: EngineError = { code: err?.code ?? 'UNRECOVERABLE', message: err?.message ?? 'Unknown error' };
          callbacks.onError(engineError);
          throw new Error(engineError.message);
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const code = (e as { code?: string })?.code ?? 'UNRECOVERABLE';
        callbacks.onError({ code, message });
        throw e;
      }
    },

    async stop(): Promise<CaptureStats | void> {
      const result = addon.stop();
      if (result && typeof result === 'object' && (typeof result.packetsReceived === 'number' || typeof result.packetsDropped === 'number')) {
        return {
          packetsReceived: typeof result.packetsReceived === 'number' ? result.packetsReceived : undefined,
          packetsDropped: typeof result.packetsDropped === 'number' ? result.packetsDropped : undefined,
          packetsIfDropped: typeof result.packetsIfDropped === 'number' ? result.packetsIfDropped : undefined,
        };
      }
      return undefined;
    },
  };
}

/**
 * Tries to load the built native addon; on success returns an Engine backed by it.
 * On failure (missing file, wrong ABI, etc.) returns the mock engine.
 */
function loadNativeEngine(): Engine | null {
  try {
    const require = createRequire(import.meta.url);
    const addonPath = getAddonPath();
    const addon = require(addonPath) as {
      start: (config: unknown, onMessage?: (msg: HttpMessage) => void) => boolean;
      stop: () => Record<string, unknown> | void;
      getLastError: () => { code: string; message: string };
    };
    if (typeof addon?.start !== 'function' || typeof addon?.stop !== 'function') {
      logWarn('Native addon missing start/stop; using mock engine');
      return null;
    }
    return wrapNativeAddon(addon);
  } catch (_) {
    return null;
  }
}

let cachedEngine: Engine | undefined = undefined;

/**
 * Returns the best available engine: native addon if load succeeds, otherwise mock.
 * Result is cached so we only attempt load once.
 */
export function getEngine(): Engine {
  if (cachedEngine !== undefined) {
    return cachedEngine;
  }
  const native = loadNativeEngine();
  if (native !== null) {
    logInfo('Using native C++ capture engine');
    cachedEngine = native;
    return cachedEngine;
  }
  logWarn('Native addon not available (missing or not built); using mock engine');
  const mock = createMockEngine();
  cachedEngine = mock;
  return mock;
}
