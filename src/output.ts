/**
 * Output pipeline per TS_API_AND_LIFECYCLE and B3: callback, outputUrl (retries), stdout JSON.
 * Callback errors are caught and logged; POST retries 3x with exponential backoff.
 */

import { logError } from './logger.js';
import type { HttpMessage } from './types.js';

const RETRY_DELAYS_MS = [1000, 2000, 4000];
const OUTPUT_URL_AUTH_TOKEN = 'OUTPUT_URL_AUTH_TOKEN';

/** Default headers to redact when redactHeaders is not set (authorization, cookie). */
export const DEFAULT_REDACT_HEADERS = ['authorization', 'cookie'];

export interface OutputConfig {
  onHttpMessage?: (msg: HttpMessage) => void;
  outputUrl?: string;
  outputStdout?: boolean;
  /** Header names to redact (case-insensitive). Default: authorization, cookie. Use [] to disable. */
  redactHeaders?: string[];
}

/**
 * Returns a copy of the message with sensitive header values replaced by '[REDACTED]'.
 * Matches header names case-insensitively.
 */
export function redactSensitiveHeaders(
  msg: HttpMessage,
  headerNamesToRedact: string[]
): HttpMessage {
  if (headerNamesToRedact.length === 0) {
    return { ...msg, headers: { ...msg.headers } };
  }
  const lowerNames = new Set(headerNamesToRedact.map((h) => h.toLowerCase()));
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(msg.headers)) {
    headers[k] = lowerNames.has(k.toLowerCase()) ? '[REDACTED]' : v;
  }
  return { ...msg, headers };
}

/**
 * Invoke user callback; log and swallow errors so one bad callback doesn't kill the process.
 */
export function emitCallback(config: OutputConfig, msg: HttpMessage): void {
  if (typeof config.onHttpMessage !== 'function') return;
  try {
    config.onHttpMessage(msg);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError('onHttpMessage callback threw', { error: message });
  }
}

/**
 * POST message to outputUrl. Retries up to 3 times with exponential backoff (1s, 2s, 4s).
 * On final failure: log and drop. Optional Bearer token from OUTPUT_URL_AUTH_TOKEN.
 */
export async function postToUrl(config: OutputConfig, msg: HttpMessage): Promise<void> {
  const url = config.outputUrl;
  if (!url || url === '') return;

  const body = JSON.stringify(msg);
  const token = process.env[OUTPUT_URL_AUTH_TOKEN];
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
  };

  let lastErr: Error | undefined;
  for (let i = 0; i <= RETRY_DELAYS_MS.length; i++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body,
      });
      if (res.ok) return;
      lastErr = new Error(`POST ${url} returned ${res.status} ${res.statusText}`);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
    if (i < RETRY_DELAYS_MS.length) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[i]));
    }
  }
  logError('outputUrl POST failed after retries', { url, error: lastErr?.message });
}

/**
 * Write one JSON line to stdout (line-buffered). No trailing newline added if body already has one.
 */
export function writeStdout(config: OutputConfig, msg: HttpMessage): void {
  if (config.outputStdout !== true) return;
  const line = JSON.stringify(msg) + '\n';
  process.stdout.write(line);
}

/**
 * Deliver one message to all configured outputs: callback, outputUrl, stdout.
 * Sensitive headers are redacted before any output. Callback is synchronous; POST is fire-and-forget.
 */
export function deliverMessage(config: OutputConfig, msg: HttpMessage): void {
  const namesToRedact =
    config.redactHeaders !== undefined
      ? config.redactHeaders
      : DEFAULT_REDACT_HEADERS;
  const redacted = redactSensitiveHeaders(msg, namesToRedact);
  emitCallback(config, redacted);
  writeStdout(config, redacted);
  if (config.outputUrl) {
    postToUrl(config, redacted).catch(() => {
      /* already logged in postToUrl */
    });
  }
}
