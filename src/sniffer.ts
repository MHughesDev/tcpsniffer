/**
 * Sniffer instance and createSniffer — Stream B (B1–B5).
 * Public API: createSniffer(config), sniffer.start(), sniffer.stop(), sniffer.isRunning().
 */

import { getEngine } from './engine-loader.js';
import type { Engine } from './engine.js';
import { EXIT_RUNTIME } from './constants.js';
import { logError, logInfo, logWarn } from './logger.js';
import { deliverMessage } from './output.js';
import { ENGINE_ERROR_CODES } from './types.js';
import type { EngineError, SnifferConfig } from './types.js';
import { validateConfig, hasOutputConfigured } from './validation.js';

export interface Sniffer {
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
}

/**
 * Creates a sniffer instance. Config is validated on start(), not on create.
 * At least one of outputUrl, outputStdout, or onHttpMessage should be set; otherwise a warning is logged at start().
 */
export function createSniffer(config: SnifferConfig): Sniffer {
  const engine: Engine = getEngine();
  let running = false;
  let signalHandlersAttached = false;

  const onSignal = (): void => {
    logInfo('Received signal, stopping sniffer');
    void sniffer.stop();
  };

  function attachSignalHandlers(): void {
    if (signalHandlersAttached) return;
    process.on('SIGTERM', onSignal);
    process.on('SIGINT', onSignal);
    signalHandlersAttached = true;
  }

  function detachSignalHandlers(): void {
    if (!signalHandlersAttached) return;
    process.off('SIGTERM', onSignal);
    process.off('SIGINT', onSignal);
    signalHandlersAttached = false;
  }

  const sniffer: Sniffer = {
    async start(): Promise<void> {
      if (running) {
        throw new Error('Sniffer already running');
      }
      const engineConfig = validateConfig(config);
      if (!hasOutputConfigured(config)) {
        logWarn('No output configured (outputUrl, outputStdout, or onHttpMessage); messages will not be delivered');
      }
      logInfo('Starting sniffer', {
        interface: engineConfig.interface || '(default)',
        ports: engineConfig.ports,
      });
      attachSignalHandlers();
      try {
        await engine.start(engineConfig, {
          onMessage: (msg) => deliverMessage(config, msg),
          onError: (err: EngineError) => {
            logError('Engine reported fatal error', { code: err.code, message: err.message });
            if (
              err.code === ENGINE_ERROR_CODES.CAPTURE_OPEN_FAILED ||
              err.code === ENGINE_ERROR_CODES.INVALID_INTERFACE ||
              err.code === ENGINE_ERROR_CODES.UNRECOVERABLE
            ) {
              process.exit(EXIT_RUNTIME);
            }
          },
        });
        running = true;
      } catch (e) {
        detachSignalHandlers();
        const message = e instanceof Error ? e.message : String(e);
        logInfo('Sniffer start failed', { error: message });
        throw e;
      }
    },

    async stop(): Promise<void> {
      if (!running) {
        detachSignalHandlers();
        return;
      }
      running = false;
      logInfo('Stopping sniffer, draining in-flight messages');
      const stats = await engine.stop();
      if (stats && (typeof stats.packetsReceived === 'number' || typeof stats.packetsDropped === 'number')) {
        logInfo('Capture stats', {
          packetsReceived: stats.packetsReceived,
          packetsDropped: stats.packetsDropped,
          packetsIfDropped: stats.packetsIfDropped,
        });
      }
      detachSignalHandlers();
      logInfo('Sniffer stopped');
    },

    isRunning(): boolean {
      return running;
    },
  };

  return sniffer;
}
