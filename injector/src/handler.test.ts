/**
 * Webhook tests (Stream C): AdmissionReview request/response, label-based injection, patch contents.
 * See docs/plans/PLAN_TESTING_VALIDATION.md — Webhook tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { handleAdmissionReview } from './handler.js';
import { DEFAULT_INJECTOR_OPTIONS } from './types.js';

const validRequestUid = '705ab4f5-6393-11e8-b7cc-42010a800002';

function makeRequest(pod: Record<string, unknown>, uid = validRequestUid) {
  return {
    apiVersion: 'admission.k8s.io/v1',
    kind: 'AdmissionReview',
    request: {
      uid,
      kind: { group: '', version: 'v1', kind: 'Pod' },
      resource: { group: '', version: 'v1', resource: 'pods' },
      namespace: 'default',
      name: 'test-pod',
      operation: 'CREATE',
      object: pod,
    },
  };
}

describe('handleAdmissionReview', () => {
  it('returns allowed: false when body has no request', () => {
    const res = handleAdmissionReview({});
    assert.strictEqual(res.response.allowed, false);
    assert.strictEqual(res.response.status?.message, 'Invalid AdmissionReview: missing request');
  });

  it('returns 400 when request.uid is missing', () => {
    const res = handleAdmissionReview({
      apiVersion: 'admission.k8s.io/v1',
      kind: 'AdmissionReview',
      request: { operation: 'CREATE' },
    });
    assert.strictEqual(res.response.allowed, false);
    assert.ok(res.response.status?.message?.includes('uid'));
  });

  it('returns allowed: true with no patch when pod does not have inject label', () => {
    const pod = {
      metadata: { name: 'app', namespace: 'default', labels: {} },
      spec: { containers: [{ name: 'app', image: 'app:latest' }] },
    };
    const res = handleAdmissionReview(makeRequest(pod));
    assert.strictEqual(res.response.allowed, true);
    assert.strictEqual(res.response.uid, validRequestUid);
    assert.strictEqual(res.response.patch, undefined);
  });

  it('returns allowed: true with patch when pod has inject label', () => {
    const pod = {
      metadata: {
        name: 'app',
        namespace: 'default',
        labels: { 'tcp-sniffer/inject': 'true' },
      },
      spec: { containers: [{ name: 'app', image: 'app:latest' }] },
    };
    const res = handleAdmissionReview(makeRequest(pod));
    assert.strictEqual(res.response.allowed, true);
    assert.strictEqual(res.response.patchType, 'JSONPatch');
    assert.ok(Buffer.from(res.response.patch!, 'base64').toString('utf8').includes('tcp-sniffer'));
  });

  it('patch adds container with NET_RAW, env, resources, and terminationGracePeriodSeconds when missing', () => {
    const pod = {
      metadata: {
        name: 'app',
        namespace: 'default',
        labels: { 'tcp-sniffer/inject': 'true' },
      },
      spec: { containers: [{ name: 'app', image: 'app:latest' }] },
    };
    const res = handleAdmissionReview(makeRequest(pod));
    const patchJson = Buffer.from(res.response.patch!, 'base64').toString('utf8');
    const patch = JSON.parse(patchJson) as Array<{ op: string; path: string; value: unknown }>;
    assert.strictEqual(patch.length, 2, 'patch should add container and terminationGracePeriodSeconds');
    assert.strictEqual(patch[0].op, 'add');
    assert.strictEqual(patch[0].path, '/spec/containers/-');
    const container = patch[0].value as Record<string, unknown>;
    assert.strictEqual(container.name, DEFAULT_INJECTOR_OPTIONS.snifferContainerName);
    assert.deepStrictEqual((container.securityContext as any)?.capabilities?.add, ['NET_RAW']);
    const env = (container.env as Array<{ name: string; value?: string; valueFrom?: unknown }>) ?? [];
    const envNames = env.map((e) => e.name);
    assert.ok(envNames.includes('PORTS'));
    assert.ok(envNames.includes('INTERFACE'));
    assert.ok(envNames.includes('OUTPUT_URL'));
    assert.ok(envNames.includes('POD_NAME'));
    assert.ok(envNames.includes('NAMESPACE'));
    assert.ok(envNames.includes('NODE_NAME'));
    assert.deepStrictEqual(container.resources, DEFAULT_INJECTOR_OPTIONS.resources);
    assert.strictEqual(patch[1].op, 'add');
    assert.strictEqual(patch[1].path, '/spec/terminationGracePeriodSeconds');
    assert.strictEqual(patch[1].value, 30);
  });

  it('patch does not add terminationGracePeriodSeconds when pod already has it', () => {
    const pod = {
      metadata: {
        name: 'app',
        namespace: 'default',
        labels: { 'tcp-sniffer/inject': 'true' },
      },
      spec: {
        containers: [{ name: 'app', image: 'app:latest' }],
        terminationGracePeriodSeconds: 60,
      },
    };
    const res = handleAdmissionReview(makeRequest(pod));
    const patchJson = Buffer.from(res.response.patch!, 'base64').toString('utf8');
    const patch = JSON.parse(patchJson) as Array<{ op: string; path: string }>;
    assert.strictEqual(patch.length, 1, 'only container added when pod already has grace period');
    assert.strictEqual(patch[0].path, '/spec/containers/-');
  });

  it('returns no patch when pod already has sniffer container (no double injection)', () => {
    const pod = {
      metadata: {
        name: 'app',
        namespace: 'default',
        labels: { 'tcp-sniffer/inject': 'true' },
      },
      spec: {
        containers: [
          { name: 'app', image: 'app:latest' },
          { name: DEFAULT_INJECTOR_OPTIONS.snifferContainerName, image: 'sniffer:latest' },
        ],
      },
    };
    const res = handleAdmissionReview(makeRequest(pod));
    assert.strictEqual(res.response.allowed, true);
    assert.strictEqual(res.response.patch, undefined);
  });

  it('returns allowed: true with no patch for DELETE operation', () => {
    const req = makeRequest({
      metadata: { name: 'app', labels: { 'tcp-sniffer/inject': 'true' } },
      spec: { containers: [] },
    });
    (req as any).request.operation = 'DELETE';
    (req as any).request.object = null;
    const res = handleAdmissionReview(req);
    assert.strictEqual(res.response.allowed, true);
    assert.strictEqual(res.response.patch, undefined);
  });

  it('respects custom injector options (label key/value, image)', () => {
    const pod = {
      metadata: { name: 'app', namespace: 'default', labels: { 'custom/inject': 'yes' } },
      spec: { containers: [{ name: 'app', image: 'app:latest' }] },
    };
    const res = handleAdmissionReview(makeRequest(pod), {
      injectLabelKey: 'custom/inject',
      injectLabelValue: 'yes',
      snifferImage: 'my-registry/sniffer:v1',
    });
    assert.strictEqual(res.response.allowed, true);
    assert.ok(res.response.patch);
    const patchJson = Buffer.from(res.response.patch!, 'base64').toString('utf8');
    const patch = JSON.parse(patchJson) as Array<{ value: unknown }>;
    const container = patch[0].value as Record<string, unknown>;
    assert.strictEqual(container.image, 'my-registry/sniffer:v1');
  });

  it('patch uses custom resources and terminationGracePeriodSeconds when provided in options', () => {
    const pod = {
      metadata: {
        name: 'app',
        namespace: 'default',
        labels: { 'tcp-sniffer/inject': 'true' },
      },
      spec: { containers: [{ name: 'app', image: 'app:latest' }] },
    };
    const customResources = {
      requests: { memory: '128Mi', cpu: '50m' },
      limits: { memory: '256Mi', cpu: '250m' },
    };
    const res = handleAdmissionReview(makeRequest(pod), {
      resources: customResources,
      terminationGracePeriodSeconds: 45,
    });
    assert.ok(res.response.patch);
    const patchJson = Buffer.from(res.response.patch!, 'base64').toString('utf8');
    const patch = JSON.parse(patchJson) as Array<{ op: string; path: string; value: unknown }>;
    const container = patch.find((p) => p.path === '/spec/containers/-')?.value as Record<string, unknown>;
    assert.ok(container);
    assert.deepStrictEqual(container.resources, customResources);
    const graceOp = patch.find((p) => p.path === '/spec/terminationGracePeriodSeconds');
    assert.ok(graceOp);
    assert.strictEqual(graceOp.op, 'add');
    assert.strictEqual(graceOp.value, 45);
  });

  it('adds OUTPUT_URL_AUTH_TOKEN from secret when outputUrlAuthTokenSecret is configured', () => {
    const pod = {
      metadata: {
        name: 'app',
        namespace: 'default',
        labels: { 'tcp-sniffer/inject': 'true' },
      },
      spec: { containers: [{ name: 'app', image: 'app:latest' }] },
    };
    const res = handleAdmissionReview(makeRequest(pod), {
      outputUrlAuthTokenSecret: { name: 'tcp-sniffer-output-auth', key: 'token' },
    });
    assert.strictEqual(res.response.allowed, true);
    assert.ok(res.response.patch);
    const patchJson = Buffer.from(res.response.patch!, 'base64').toString('utf8');
    const patch = JSON.parse(patchJson) as Array<{ value: unknown }>;
    const container = patch[0].value as Record<string, unknown>;
    const env = (container.env as Array<{ name: string; valueFrom?: unknown }>) ?? [];
    const authEnv = env.find((e) => e.name === 'OUTPUT_URL_AUTH_TOKEN');
    assert.ok(authEnv, 'OUTPUT_URL_AUTH_TOKEN should be in env');
    assert.deepStrictEqual(authEnv.valueFrom, {
      secretKeyRef: { name: 'tcp-sniffer-output-auth', key: 'token' },
    });
  });
});
