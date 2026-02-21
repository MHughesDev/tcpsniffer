/**
 * Container entrypoint: read env, build config, validate, log placement/interface/ports, then createSniffer and start.
 * Handles SIGTERM/SIGINT for graceful shutdown (stop and exit).
 * Exit codes: 0 = success, EXIT_CONFIG (1) = validation/config error, EXIT_RUNTIME (2) = start/stop failure.
 */

import { createSniffer } from './sniffer.js';
import { validateConfig, ValidationError } from './validation.js';
import { logInfo, logError } from './logger.js';
import type { SnifferConfig } from './types.js';
import { EXIT_CONFIG, EXIT_RUNTIME } from './constants.js';

function parsePorts(portsEnv: string | undefined): number[] {
  if (portsEnv == null || portsEnv === '') {
    return [];
  }
  return portsEnv
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n) && n >= 1 && n <= 65535);
}

function configFromEnv(): SnifferConfig {
  const ports = parsePorts(process.env.PORTS);
  const config: SnifferConfig = {
    ports,
    interface: process.env.INTERFACE !== undefined && process.env.INTERFACE !== '' ? process.env.INTERFACE : undefined,
    outputUrl: process.env.OUTPUT_URL !== undefined && process.env.OUTPUT_URL !== '' ? process.env.OUTPUT_URL : undefined,
    outputStdout: process.env.OUTPUT_STDOUT === 'true' || process.env.OUTPUT_STDOUT === '1',
  };
  return config;
}

async function main(): Promise<void> {
  const config = configFromEnv();
  try {
    validateConfig(config);
  } catch (err) {
    const msg = err instanceof ValidationError ? err.message : String(err);
    logError('Invalid config: ' + msg, err instanceof ValidationError && err.field ? { field: err.field } : undefined);
    process.exitCode = EXIT_CONFIG;
    return;
  }

  logInfo('Sniffer entrypoint starting', {
    placement:
      process.env.POD_NAME || process.env.NAMESPACE || process.env.NODE_NAME
        ? {
            pod: process.env.POD_NAME,
            namespace: process.env.NAMESPACE,
            node: process.env.NODE_NAME,
          }
        : undefined,
    interface: config.interface ?? '(default)',
    ports: config.ports,
  });

  const sniffer = createSniffer(config);

  function shutdown(signal: string): void {
    logInfo(`Received ${signal}, stopping sniffer`);
    sniffer
      .stop()
      .then(() => process.exit(0))
      .catch((err) => {
        logError('Error during stop', { err: String(err) });
        process.exit(EXIT_RUNTIME);
      });
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  try {
    await sniffer.start();
  } catch (err) {
    logError('Sniffer start failed', { err: String(err) });
    process.exitCode = EXIT_RUNTIME;
    return;
  }
}

main().catch((err) => {
  logError('Entrypoint failed', { err: String(err) });
  process.exit(EXIT_RUNTIME);
});
