/**
 * Config validation and normalization per docs/specs/TS_CPP_CONTRACT.md §5.
 * TS enforces these before calling C++; invalid config produces a clear error.
 */

import {
  CONTRACT_DEFAULTS,
  MAX_PORT,
  MAX_SAMPLE_RATE,
  MIN_PORT,
  MIN_SAMPLE_RATE,
} from './constants.js';
import type { EngineConfig, SnifferConfig } from './types.js';

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly field?: string
  ) {
    super(message);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

function assert(condition: boolean, message: string, field?: string): asserts condition {
  if (!condition) {
    throw new ValidationError(message, field);
  }
}

/** True when NODE_ENV=production or TCP_SNIFFER_PRODUCTION=1 (production requires outputUrl HTTPS). */
function isProduction(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.TCP_SNIFFER_PRODUCTION === '1'
  );
}

/**
 * Validates and normalizes user config into EngineConfig (and preserves TS-only fields).
 * Throws ValidationError with a clear message (and optional field) on invalid config.
 * Call this before passing config to C++.
 */
export function validateConfig(config: SnifferConfig): EngineConfig {
  assert(config != null && typeof config === 'object', 'config must be an object');

  // ports: required, non-empty, each in [1, 65535]
  assert(Array.isArray(config.ports), 'ports is required and must be an array', 'ports');
  assert(config.ports.length > 0, 'ports must be non-empty', 'ports');
  for (let i = 0; i < config.ports.length; i++) {
    const p = config.ports[i];
    assert(
      typeof p === 'number' && Number.isInteger(p) && p >= MIN_PORT && p <= MAX_PORT,
      `ports[${i}] must be an integer between ${MIN_PORT} and ${MAX_PORT}`,
      'ports'
    );
  }

  // sampleRate: if present, number in [0, 1]
  const sampleRate =
    config.sampleRate !== undefined ? config.sampleRate : CONTRACT_DEFAULTS.sampleRate;
  assert(
    typeof sampleRate === 'number' &&
      !Number.isNaN(sampleRate) &&
      sampleRate >= MIN_SAMPLE_RATE &&
      sampleRate <= MAX_SAMPLE_RATE,
    `sampleRate must be a number between ${MIN_SAMPLE_RATE} and ${MAX_SAMPLE_RATE}`,
    'sampleRate'
  );

  // maxBodySize: if present, positive integer
  const maxBodySize =
    config.maxBodySize !== undefined ? config.maxBodySize : CONTRACT_DEFAULTS.maxBodySize;
  assert(
    typeof maxBodySize === 'number' &&
      Number.isInteger(maxBodySize) &&
      maxBodySize > 0,
    'maxBodySize must be a positive integer',
    'maxBodySize'
  );

  // maxConcurrentConnections: if present, positive integer
  const maxConcurrentConnections =
    config.maxConcurrentConnections !== undefined
      ? config.maxConcurrentConnections
      : CONTRACT_DEFAULTS.maxConcurrentConnections;
  assert(
    typeof maxConcurrentConnections === 'number' &&
      Number.isInteger(maxConcurrentConnections) &&
      maxConcurrentConnections > 0,
    'maxConcurrentConnections must be a positive integer',
    'maxConcurrentConnections'
  );

  // connectionIdleTimeoutMs: if present, positive integer
  const connectionIdleTimeoutMs =
    config.connectionIdleTimeoutMs !== undefined
      ? config.connectionIdleTimeoutMs
      : CONTRACT_DEFAULTS.connectionIdleTimeoutMs;
  assert(
    typeof connectionIdleTimeoutMs === 'number' &&
      Number.isInteger(connectionIdleTimeoutMs) &&
      connectionIdleTimeoutMs > 0,
    'connectionIdleTimeoutMs must be a positive integer',
    'connectionIdleTimeoutMs'
  );

  // interface: if present, non-empty string (C++ may still fail if it doesn't exist)
  const iface =
    config.interface !== undefined ? config.interface : CONTRACT_DEFAULTS.interface;
  assert(
    typeof iface === 'string',
    'interface must be a string (use empty string for default)',
    'interface'
  );

  // outputUrl: in production, must use HTTPS (non-production allows http for local/dev)
  if (config.outputUrl != null && config.outputUrl !== '' && isProduction()) {
    try {
      const url = new URL(config.outputUrl);
      if (url.protocol !== 'https:') {
        throw new ValidationError(
          'outputUrl must use HTTPS in production',
          'outputUrl'
        );
      }
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new ValidationError(
        `outputUrl is invalid: ${message}`,
        'outputUrl'
      );
    }
  }

  return {
    interface: iface,
    ports: [...config.ports],
    sampleRate,
    maxBodySize,
    maxConcurrentConnections,
    connectionIdleTimeoutMs,
  };
}

/**
 * Returns true if at least one output is configured (for startup warning when none set).
 */
export function hasOutputConfigured(config: SnifferConfig): boolean {
  return (
    (config.outputUrl != null && config.outputUrl !== '') ||
    config.outputStdout === true ||
    typeof config.onHttpMessage === 'function'
  );
}
