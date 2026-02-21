/**
 * Label-based eligibility for injection (Stream C — INJECTOR.md, OVERVIEW.md).
 * Injection is applied when the Pod matches the webhook's selector (label-based opt-in).
 */

import type { Pod, InjectorOptions } from './types.js';

/**
 * Returns true if the pod should receive the sniffer sidecar (has the inject label with the expected value).
 */
export function isEligibleForInjection(pod: Pod | undefined | null, options: InjectorOptions): boolean {
  if (!pod?.metadata?.labels) return false;
  const value = pod.metadata.labels[options.injectLabelKey];
  return value === options.injectLabelValue;
}
