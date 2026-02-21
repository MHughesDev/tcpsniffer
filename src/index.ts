/**
 * TCP Sniffer — TypeScript library (Stream B).
 * See docs/specs/TS_CPP_CONTRACT.md, docs/specs/TS_API_AND_LIFECYCLE.md, docs/plans/IMPLEMENTATION_LAYOUT.md.
 */

export { createSniffer } from './sniffer.js';
export type { Sniffer } from './sniffer.js';

export {
  CONTRACT_DEFAULTS,
  MAX_PORT,
  MAX_SAMPLE_RATE,
  MIN_PORT,
  MIN_SAMPLE_RATE,
} from './constants.js';

export type {
  EngineConfig,
  Endpoint,
  EngineError,
  EngineErrorCode,
  HttpDirection,
  HttpMessage,
  SnifferConfig,
} from './types.js';
export { ENGINE_ERROR_CODES } from './types.js';

export { hasOutputConfigured, validateConfig, ValidationError } from './validation.js';
