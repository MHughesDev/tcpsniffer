/**
 * Engine abstraction for TS ↔ C++ contract (docs/specs/TS_CPP_CONTRACT.md).
 * Real implementation will be N-API addon or subprocess; this module defines the interface.
 */

import type { EngineConfig, EngineError, HttpMessage } from './types.js';

export interface EngineCallbacks {
  onMessage: (msg: HttpMessage) => void;
  onError: (err: EngineError) => void;
}

/** Capture stats from pcap_stats(), exposed on stop() when available. */
export interface CaptureStats {
  packetsReceived?: number;
  packetsDropped?: number;
  packetsIfDropped?: number;
}

/**
 * Engine interface: start (with config and callbacks), stop (drain then close).
 * C++ addon or subprocess implements this; mock implements it for B2.
 * stop() may return capture stats when the native engine provides them.
 */
export interface Engine {
  start(config: EngineConfig, callbacks: EngineCallbacks): Promise<void>;
  stop(): Promise<CaptureStats | void>;
}
