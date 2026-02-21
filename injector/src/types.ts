/**
 * Kubernetes AdmissionReview and Pod types for the mutating webhook.
 * See docs/specs/INJECTOR.md and Kubernetes AdmissionReview v1 API.
 */

export const ADMISSION_API_VERSION = 'admission.k8s.io/v1';
export const ADMISSION_KIND = 'AdmissionReview';

/** AdmissionReview request as sent by the API server. */
export interface AdmissionRequest {
  uid: string;
  kind: { group: string; version: string; kind: string };
  resource: { group: string; version: string; resource: string };
  namespace?: string;
  name: string;
  operation: 'CREATE' | 'UPDATE' | 'DELETE' | 'CONNECT';
  object?: Record<string, unknown> | null;
  oldObject?: Record<string, unknown> | null;
  dryRun?: boolean;
}

/** AdmissionReview request body (what we receive). */
export interface AdmissionReviewRequest {
  apiVersion: string;
  kind: string;
  request?: AdmissionRequest | null;
}

/** AdmissionReview response body (what we return). */
export interface AdmissionReviewResponse {
  apiVersion: string;
  kind: string;
  response: {
    uid: string;
    allowed: boolean;
    status?: { code: number; message: string };
    patchType?: 'JSONPatch';
    patch?: string;
    warnings?: string[];
  };
}

/** Pod metadata (labels, name, namespace). */
export interface PodMetadata {
  name?: string;
  namespace?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

/** Kubernetes container resources (requests/limits). */
export interface ContainerResources {
  requests?: { memory?: string; cpu?: string };
  limits?: { memory?: string; cpu?: string };
}

/** Pod spec.containers[]. */
export interface Container {
  name: string;
  image?: string;
  imagePullPolicy?: string;
  env?: Array<{ name: string; value?: string; valueFrom?: Record<string, unknown> }>;
  securityContext?: Record<string, unknown>;
  resources?: ContainerResources;
  volumeMounts?: Array<{ name: string; mountPath: string }>;
}

/** Minimal Pod shape we need (object from request.object). */
export interface Pod {
  apiVersion?: string;
  kind?: string;
  metadata?: PodMetadata;
  spec?: {
    containers?: Container[];
    terminationGracePeriodSeconds?: number;
    volumes?: Array<{ name: string; [k: string]: unknown }>;
    securityContext?: Record<string, unknown>;
  };
}

/** Injector configuration (env var names and defaults from docs/specs/DEPLOYMENT_OPS.md). */
export interface InjectorOptions {
  /** Label key for opt-in injection (pod must have this label). Default: tcp-sniffer/inject */
  injectLabelKey: string;
  /** Label value for opt-in. Default: "true" */
  injectLabelValue: string;
  /** Sniffer container image. */
  snifferImage: string;
  /** Sniffer container name in the pod. */
  snifferContainerName: string;
  /** Default capture ports (env PORTS). Comma-separated or array. */
  defaultPorts: string;
  /** Default interface (env INTERFACE). */
  defaultInterface: string;
  /** Optional: override OUTPUT_URL per-pod via annotation (annotation key). Omit to disable. */
  outputUrlAnnotation?: string;
  /** Optional: override PORTS per-pod via annotation. Omit to disable. */
  portsAnnotation?: string;
  /** Pod terminationGracePeriodSeconds when injecting; only added if pod has none. Default: 30 */
  terminationGracePeriodSeconds?: number;
  /** Sidecar container resources (requests/limits). When set, applied to injected container. */
  resources?: ContainerResources;
  /** When set, inject OUTPUT_URL_AUTH_TOKEN from this Secret (valueFrom.secretKeyRef). */
  outputUrlAuthTokenSecret?: { name: string; key: string };
}

export const DEFAULT_INJECTOR_OPTIONS: InjectorOptions = {
  injectLabelKey: 'tcp-sniffer/inject',
  injectLabelValue: 'true',
  snifferImage: 'tcp-sniffer:latest',
  snifferContainerName: 'tcp-sniffer',
  defaultPorts: '8080',
  defaultInterface: 'eth0',
  terminationGracePeriodSeconds: 30,
  resources: {
    requests: { memory: '256Mi', cpu: '100m' },
    limits: { memory: '512Mi', cpu: '500m' },
  },
};
