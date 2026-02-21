/** Exit code: configuration or validation error (invalid ports, non-HTTPS outputUrl in production, etc.). */
export const EXIT_CONFIG = 1;
/** Exit code: runtime fatal error (start failed, capture open failed, or error during stop). */
export const EXIT_RUNTIME = 2;

/**
 * Defaults from docs/specs/TS_CPP_CONTRACT.md §5.
 * TS applies these before passing config to C++; C++ may assume they are set.
 */
export const CONTRACT_DEFAULTS = {
  sampleRate: 1,
  maxBodySize: 1_048_576,
  maxConcurrentConnections: 10_000,
  connectionIdleTimeoutMs: 300_000,
  /** Empty string means C++ uses implementation default (e.g. first non-loopback). */
  interface: '',
} as const;

export const MIN_PORT = 1;
export const MAX_PORT = 65_535;
export const MIN_SAMPLE_RATE = 0;
export const MAX_SAMPLE_RATE = 1;
