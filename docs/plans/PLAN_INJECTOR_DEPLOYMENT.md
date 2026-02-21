# TCP Sniffer — Injector + Deployment Implementation Plan

## Purpose

Define the implementation plan for the mutating webhook and the sniffer container deployment described in `docs/specs/INJECTOR.md` and `docs/specs/DEPLOYMENT_OPS.md`.

## Phase 1 — Injector request/response flow

Tasks:
- Parse AdmissionReview requests and extract the Pod object.
- Determine injection eligibility via label/selector rules.
- Produce AdmissionReview responses with JSON patch or full object mutation.

Milestone:
- Eligible pods are mutated; ineligible pods are passed through unchanged.
- Responses conform to AdmissionReview schema.

## Phase 2 — Patch composition

Tasks:
- Append sniffer sidecar container.
- Add `securityContext` with `NET_RAW` capability.
- Add required volumes if needed by the image.
- Set env vars for config (`PORTS`, `INTERFACE`, `OUTPUT_URL`, `OUTPUT_URL_AUTH_TOKEN`).
- Add downward API env (`POD_NAME`, `NAMESPACE`, `NODE_NAME`) for placement logging.

Milestone:
- Mutated pods include the expected container, env, and securityContext.

## Phase 3 — Sniffer container image

Tasks:
- Build Linux image including Node/TS entrypoint, C++ engine, and libpcap deps.
- Ensure the entrypoint reads env and calls `createSniffer(config)`.
- Log placement, interface, and ports on startup.

Milestone:
- Container starts and logs expected startup information.
- Capture fails clearly when interface or permissions are invalid.

## Phase 4 — Operational integration

Tasks:
- Define webhook TLS requirements and deployment wiring (per ops doc).
- Document failure policy selection (fail open/closed) in deployment/ops guidance.

Milestone:
- Webhook is reachable via HTTPS and processes admission traffic.
