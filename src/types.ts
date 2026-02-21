/**
 * Types for the TS ↔ C++ contract (docs/specs/TS_CPP_CONTRACT.md).
 * Both TS and C++ implement against these shapes.
 */

// --- Config passed TS → C++ (contract §1) ---

/** User-facing config for createSniffer(); may omit optional fields. */
export interface SnifferConfig {
  interface?: string;
  ports: number[];
  outputUrl?: string;
  outputStdout?: boolean;
  sampleRate?: number;
  maxBodySize?: number;
  maxConcurrentConnections?: number;
  connectionIdleTimeoutMs?: number;
  onHttpMessage?: (msg: HttpMessage) => void;
  /** Header names to redact (case-insensitive). Default: ['authorization', 'cookie']. Use [] to disable. */
  redactHeaders?: string[];
}

/**
 * Normalized config passed to C++ at start. All optional fields have defaults applied.
 * TS validates and normalizes before calling C++; C++ may assume valid ranges.
 */
export interface EngineConfig {
  interface: string;
  ports: number[];
  sampleRate: number;
  maxBodySize: number;
  maxConcurrentConnections: number;
  connectionIdleTimeoutMs: number;
}

// --- Message shape C++ → TS (contract §2) ---

export interface Endpoint {
  ip: string;
  port: number;
}

export type HttpDirection = 'request' | 'response';

export interface HttpMessage {
  receiver: Endpoint;
  destination: Endpoint;
  direction: HttpDirection;
  headers: Record<string, string>;
  timestamp: string;
  method?: string;
  path?: string;
  statusCode?: number;
  body?: string;
  bodyTruncated?: boolean;
  bodyEncoding?: string;
}

// --- Error reporting C++ → TS (contract §4) ---

/** Fatal engine error codes; C++ uses these when reporting to TS. */
export const ENGINE_ERROR_CODES = {
  CAPTURE_OPEN_FAILED: 'CAPTURE_OPEN_FAILED',
  INVALID_INTERFACE: 'INVALID_INTERFACE',
  UNRECOVERABLE: 'UNRECOVERABLE',
} as const;

export type EngineErrorCode = (typeof ENGINE_ERROR_CODES)[keyof typeof ENGINE_ERROR_CODES];

export interface EngineError {
  code: string;
  message: string;
}
