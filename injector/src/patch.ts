/**
 * Build the JSON Patch (RFC 6902) to add the sniffer sidecar (Stream C Phase 2).
 * INJECTOR.md: sidecar container, NET_RAW, env (PORTS, INTERFACE, OUTPUT_*, downward API).
 * DEPLOYMENT_OPS.md: PORTS, INTERFACE, OUTPUT_URL, OUTPUT_URL_AUTH_TOKEN, POD_NAME, NAMESPACE, NODE_NAME.
 */

import type { Pod, InjectorOptions } from './types.js';

export type JsonPatchOp = { op: 'add' | 'remove' | 'replace'; path: string; value?: unknown };

/**
 * Get per-pod overrides from annotations (if options define annotation keys).
 */
function getAnnotation(pod: Pod, key: string | undefined): string | undefined {
  if (!key || !pod.metadata?.annotations) return undefined;
  return pod.metadata.annotations[key];
}

/**
 * Build env array for the sniffer container: PORTS, INTERFACE, OUTPUT_URL, OUTPUT_URL_AUTH_TOKEN,
 * plus downward API for POD_NAME, NAMESPACE, NODE_NAME.
 */
function buildEnv(pod: Pod, options: InjectorOptions): Array<{ name: string; value?: string; valueFrom?: Record<string, unknown> }> {
  const ports = getAnnotation(pod, options.portsAnnotation) ?? options.defaultPorts;
  const interface_ = options.defaultInterface;
  const outputUrl = getAnnotation(pod, options.outputUrlAnnotation) ?? '';

  const env: Array<{ name: string; value?: string; valueFrom?: Record<string, unknown> }> = [
    { name: 'PORTS', value: ports },
    { name: 'INTERFACE', value: interface_ },
    { name: 'OUTPUT_URL', value: outputUrl },
  ];

  // Downward API for placement logging (DEPLOYMENT_OPS.md)
  env.push({
    name: 'POD_NAME',
    valueFrom: { fieldRef: { fieldPath: 'metadata.name' } },
  });
  env.push({
    name: 'NAMESPACE',
    valueFrom: { fieldRef: { fieldPath: 'metadata.namespace' } },
  });
  env.push({
    name: 'NODE_NAME',
    valueFrom: { fieldRef: { fieldPath: 'spec.nodeName' } },
  });

  if (options.outputUrlAuthTokenSecret) {
    env.push({
      name: 'OUTPUT_URL_AUTH_TOKEN',
      valueFrom: {
        secretKeyRef: {
          name: options.outputUrlAuthTokenSecret.name,
          key: options.outputUrlAuthTokenSecret.key,
        },
      },
    });
  }

  return env;
}

/**
 * Build the sniffer sidecar container spec (securityContext NET_RAW, env, name, image, resources).
 */
function buildSnifferContainer(pod: Pod, options: InjectorOptions): Record<string, unknown> {
  const container: Record<string, unknown> = {
    name: options.snifferContainerName,
    image: options.snifferImage,
    imagePullPolicy: 'IfNotPresent',
    securityContext: {
      capabilities: {
        add: ['NET_RAW'],
      },
    },
    env: buildEnv(pod, options),
  };
  if (options.resources != null) {
    container.resources = options.resources;
  }
  return container;
}

/**
 * Returns true if the pod already has a container with the sniffer name (avoid double injection).
 */
export function alreadyHasSniffer(pod: Pod, options: InjectorOptions): boolean {
  const names = pod.spec?.containers?.map((c) => c.name) ?? [];
  return names.includes(options.snifferContainerName);
}

/**
 * Produce JSON Patch operations to add the sniffer sidecar to the pod.
 * - Add container to spec.containers (path /spec/containers/-).
 * - If spec.containers is missing, we must add it first (path /spec/containers, value [newContainer]).
 * - If spec.terminationGracePeriodSeconds is missing, add it (e.g. 30) so the sniffer can drain on SIGTERM.
 */
export function buildPatch(pod: Pod, options: InjectorOptions): JsonPatchOp[] {
  const container = buildSnifferContainer(pod, options);
  const containers = pod.spec?.containers;
  const ops: JsonPatchOp[] =
    Array.isArray(containers) && containers.length > 0
      ? [{ op: 'add', path: '/spec/containers/-', value: container }]
      : [{ op: 'add', path: '/spec/containers', value: [container] }];

  const grace = options.terminationGracePeriodSeconds ?? 30;
  if (pod.spec?.terminationGracePeriodSeconds == null) {
    ops.push({ op: 'add', path: '/spec/terminationGracePeriodSeconds', value: grace });
  }
  return ops;
}
