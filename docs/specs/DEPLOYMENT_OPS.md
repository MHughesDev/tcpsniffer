# TCP Sniffer — Deployment & Ops Spec

## Purpose

Define container, environment, and operational requirements for the sniffer sidecar described in `docs/ARCHITECTURE.md` and `docs/OVERVIEW.md`.

## Scope

In scope:
- Sniffer container image requirements.
- Environment variables and downward API usage.
- Platform support, security requirements, and verification steps.
- Resource sizing considerations and operational logging.

Out of scope:
- API behavior (handled in TS and C++ specs).
- Injector implementation details beyond inputs/outputs.

## Container image

- Linux container only; includes Node/TypeScript entrypoint, C++ engine, and libpcap.
- Capture library: libpcap (no Windows/Npcap support).
- **Capabilities:** `NET_RAW` is **required** for packet capture (libpcap). Add to the pod spec: `securityContext.capabilities.add: ["NET_RAW"]`. `NET_ADMIN` is not required for standard capture.

## Environment and entrypoint

Environment variables:
- `PORTS` — capture ports (e.g. `8080,8443`).
- `INTERFACE` — capture interface (e.g. `eth0`).
- `OUTPUT_URL` — optional POST target.
- `OUTPUT_URL_AUTH_TOKEN` — optional Bearer token for `outputUrl`.
- `POD_NAME`, `NAMESPACE`, `NODE_NAME` — via downward API for startup logs.

Entrypoint behavior:
- Reads env vars, builds the config object, and calls `createSniffer(config)`.
- Logs placement info (pod/namespace/node), interface, and ports on startup.

## Platform support

- **Runtime**: Linux container only.
- **Host**: Any host that can run Linux containers (host OS agnostic).

## Security

- Do not log full HTTP bodies by default.
- **HTTPS:** In production, `outputUrl` **must** use HTTPS. Do not POST to untrusted or plain HTTP endpoints for sensitive traffic.
- Optional header redaction applies to logs and output (e.g. `Authorization`, `Cookie`).

## Resource limits and sizing

- Memory usage scales with `maxConcurrentConnections` and `maxBodySize`. Rough formula: base (e.g. 50–100 MiB) + per-connection overhead (e.g. 10–50 KiB per connection) + buffer for bodies up to `maxBodySize` per connection.
- **Recommended limits (starting point):** `memory: 256Mi` request, `512Mi` limit; `cpu: 100m` request, `500m` limit. Adjust upward for high connection counts or larger `maxBodySize`.
- Set the pod’s `terminationGracePeriodSeconds` (e.g. 30) so the sniffer can drain in-flight messages on SIGTERM before the container is killed.

## Failure handling and exit codes

- The sniffer entrypoint uses distinct exit codes so automation can distinguish failures:
  - **0** — Success (including graceful shutdown after SIGTERM/SIGINT).
  - **1** — Configuration / validation error (invalid ports, missing output, non-HTTPS outputUrl in production).
  - **2** — Runtime fatal error (start failed, capture open failed, or error during stop).
- Operators can alert on exit code 2 (runtime) vs 1 (config) for different remediation.
- Log capture drops (when available), evictions, and reassembly gaps.
- Shutdown drains in-flight messages within the pod’s termination grace period.

## Verification

- **Unit/Integration**: Validate TCP reassembly and HTTP parsing from fixtures or replayed traffic.
- **Webhook**: Verify label-based injection and expected container/env in the mutated Pod.
- **Shutdown**: SIGTERM drains outputs and exits within the configured grace period.
