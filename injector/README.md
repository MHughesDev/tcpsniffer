# TCP Sniffer Injector (Stream C)

Mutating admission webhook that injects the TCP Sniffer sidecar into pods when they carry the opt-in label. See `docs/specs/INJECTOR.md` and `docs/plans/PLAN_INJECTOR_DEPLOYMENT.md`.

## Behavior

- **Eligibility:** Pod has label `tcp-sniffer/inject: "true"` (configurable).
- **Mutation:** Adds the sniffer container with `NET_RAW`, env (`PORTS`, `INTERFACE`, `OUTPUT_URL`, downward API for `POD_NAME`, `NAMESPACE`, `NODE_NAME`). No patch if the pod already has the sniffer container.
- **Response:** Standard `AdmissionReview` v1 with `allowed: true` and optional base64-encoded JSON Patch.

## Build and run

```bash
cd injector
npm install
npm run build
npm start
```

- Listens on port **8443** by default. Override with `PORT`.
- Optional env: `SNIFFER_IMAGE`, `INJECTOR_DEFAULT_PORTS` (default `8080`).

**Endpoints:** `POST /` or `POST /mutate` with `AdmissionReview` JSON body.

## C3 — TLS and deployment wiring

- **HTTPS:** The webhook endpoint **must** be HTTPS when registered with the API server. Options:
  1. Run this server behind a TLS-terminating reverse proxy (e.g. Ingress with TLS, or a sidecar that adds TLS).
  2. Use a wrapper or option to serve HTTPS (not included in this package; add e.g. `https` module with cert paths).
  3. In-cluster: use a Service in front of the webhook pod and configure **cert-manager** (or similar) to issue a certificate and mount it; run the Node process with that cert, or run behind a TLS proxy in the same pod.
- **Failure policy:** In `MutatingWebhookConfiguration`, set `failurePolicy: Fail` (reject the request if the webhook is unavailable) or `Ignore` (fail open). Document the choice in your deployment guide.
- **Deployment:** Create a `MutatingWebhookConfiguration` that targets Pods (e.g. `operations: [CREATE]`, `resources: [pods]`). Use `objectSelector` with `tcp-sniffer/inject: "true"` so only labeled pods are sent to the webhook, or use `namespaceSelector` and let the injector decide per pod. Set `clientConfig.service` to the webhook Service and `caBundle` to the CA that signed the webhook’s TLS cert. See Kubernetes [Dynamic Admission Control](https://kubernetes.io/docs/reference/access-authn-authz/extensible-admission-controllers/) and [MutatingWebhookConfiguration](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.35/#mutatingwebhookconfiguration-v1-admissionregistration-k8s-io).

## Tests

```bash
npm run test:ts
```

Covers: invalid/missing request, label-based eligibility, patch contents (container, NET_RAW, env), no double injection, custom options.
