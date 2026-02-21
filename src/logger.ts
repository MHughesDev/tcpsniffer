/**
 * Structured logging and placement metadata per TS_API_AND_LIFECYCLE and B5.
 * JSON logs with timestamp, level, message; placement from env when available.
 */

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogRecord {
  timestamp: string;
  level: LogLevel;
  message: string;
  /** Pod/namespace/node when running in Kubernetes (downward API). */
  placement?: { pod?: string; namespace?: string; node?: string };
  /** Optional extra key-value for context. */
  [key: string]: unknown;
}

function isoTimestamp(): string {
  return new Date().toISOString();
}

function getPlacement(): LogRecord['placement'] {
  const pod = process.env.POD_NAME;
  const namespace = process.env.NAMESPACE;
  const node = process.env.NODE_NAME;
  if (pod ?? namespace ?? node) {
    return { pod, namespace, node };
  }
  return undefined;
}

function write(record: LogRecord): void {
  const line = JSON.stringify(record) + '\n';
  const out = record.level === 'error' ? process.stderr : process.stdout;
  out.write(line);
}

export function logInfo(message: string, extra?: Record<string, unknown>): void {
  const placement = getPlacement();
  const record: LogRecord = {
    timestamp: isoTimestamp(),
    level: 'info',
    message,
    ...(placement && { placement }),
    ...extra,
  };
  write(record);
}

export function logWarn(message: string, extra?: Record<string, unknown>): void {
  const placement = getPlacement();
  const record: LogRecord = {
    timestamp: isoTimestamp(),
    level: 'warn',
    message,
    ...(placement && { placement }),
    ...extra,
  };
  write(record);
}

export function logError(message: string, extra?: Record<string, unknown>): void {
  const placement = getPlacement();
  const record: LogRecord = {
    timestamp: isoTimestamp(),
    level: 'error',
    message,
    ...(placement && { placement }),
    ...extra,
  };
  write(record);
}

export function logDebug(message: string, extra?: Record<string, unknown>): void {
  const placement = getPlacement();
  const record: LogRecord = {
    timestamp: isoTimestamp(),
    level: 'debug',
    message,
    ...(placement && { placement }),
    ...extra,
  };
  write(record);
}
