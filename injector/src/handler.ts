/**
 * AdmissionReview request/response handling (Stream C Phase 1).
 * Parses request, checks eligibility, returns AdmissionReview response with optional patch.
 */

import type { AdmissionReviewRequest, AdmissionReviewResponse, InjectorOptions } from './types.js';
import { ADMISSION_API_VERSION, ADMISSION_KIND, DEFAULT_INJECTOR_OPTIONS } from './types.js';
import { isEligibleForInjection } from './eligibility.js';
import { buildPatch, alreadyHasSniffer } from './patch.js';

/**
 * Handle a single AdmissionReview request body and return the response body.
 * Uses JSON Patch for mutation; patch is base64-encoded per Kubernetes API.
 */
export function handleAdmissionReview(
  body: unknown,
  options: Partial<InjectorOptions> = {}
): AdmissionReviewResponse {
  const opts: InjectorOptions = { ...DEFAULT_INJECTOR_OPTIONS, ...options };
  const response: AdmissionReviewResponse = {
    apiVersion: ADMISSION_API_VERSION,
    kind: ADMISSION_KIND,
    response: {
      uid: '',
      allowed: true,
    },
  };

  if (!body || typeof body !== 'object' || !('request' in body)) {
    response.response.allowed = false;
    response.response.status = { code: 400, message: 'Invalid AdmissionReview: missing request' };
    return response;
  }

  const req = (body as AdmissionReviewRequest).request;
  if (!req?.uid) {
    response.response.allowed = false;
    response.response.status = { code: 400, message: 'Invalid AdmissionReview: missing request.uid' };
    return response;
  }

  response.response.uid = req.uid;

  if (req.operation !== 'CREATE' && req.operation !== 'UPDATE') {
    return response;
  }

  const pod = req.object as import('./types.js').Pod | undefined | null;
  if (!pod?.metadata) {
    response.response.allowed = false;
    response.response.status = { code: 400, message: 'Invalid Pod: missing metadata' };
    return response;
  }

  if (!isEligibleForInjection(pod, opts)) {
    return response;
  }

  if (alreadyHasSniffer(pod, opts)) {
    return response;
  }

  const patchOps = buildPatch(pod, opts);
  const patchJson = JSON.stringify(patchOps);
  const patchBase64 = Buffer.from(patchJson, 'utf8').toString('base64');
  response.response.patchType = 'JSONPatch';
  response.response.patch = patchBase64;

  return response;
}
