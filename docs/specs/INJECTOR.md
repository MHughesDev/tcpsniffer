# TCP Sniffer — Injector (Mutating Webhook) Spec

## Purpose

Define the mutating admission webhook responsible for injecting the sniffer sidecar, as described in `docs/ARCHITECTURE.md` and `docs/OVERVIEW.md`.

## Scope

In scope:
- AdmissionReview request/response handling.
- Selection criteria for injection (labels/selectors).
- Pod mutation to add the sniffer container and required settings.

Out of scope:
- Running the sniffer or parsing traffic.
- Deployment guides (cert provisioning, failure policy details are documented separately).

## Trigger and selection

- Injection is applied when the Pod or its namespace matches the webhook’s selector (label-based opt-in).
- Exact label/annotation names and any overrides are defined in the deployment/ops spec.

## AdmissionReview contract

- **Request**: Kubernetes API server sends an AdmissionReview containing the Pod.
- **Response**: AdmissionReview response that allows the request and includes a mutation:
  - JSON patch or full object containing the modified Pod.

## Patch contents

The mutation adds:
- The sniffer sidecar container.
- Required volumes (as needed by the image/runtime).
- `securityContext` with `NET_RAW` capability.
- Environment sources for config (ports, interface, output URL, auth token).
- Downward API env for placement logs (pod/namespace/node) when available.

## Security and availability

- Webhook endpoint must be HTTPS.
- Failure policy (fail open vs fail closed) and certificate management are defined in the deployment/ops spec.
