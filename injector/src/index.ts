/**
 * TCP Sniffer Injector — mutating admission webhook (Stream C).
 * Entrypoint: start the webhook server or export for programmatic use.
 */

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { startServer } from './server.js';

export { handleAdmissionReview } from './handler.js';
export { isEligibleForInjection } from './eligibility.js';
export { buildPatch, alreadyHasSniffer } from './patch.js';
export { createWebhookServer, startServer } from './server.js';
export type { InjectorOptions, AdmissionReviewRequest, AdmissionReviewResponse } from './types.js';
export { DEFAULT_INJECTOR_OPTIONS } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(__filename);

if (isMain) {
  const port = typeof process.env.PORT !== 'undefined' ? Number(process.env.PORT) : undefined;
  const snifferImage = process.env.SNIFFER_IMAGE;
  const defaultPorts = process.env.INJECTOR_DEFAULT_PORTS ?? '8080';
  startServer({
    port: port ?? 8443,
    injectorOptions: {
      ...(snifferImage && { snifferImage }),
      defaultPorts,
    },
  });
}
