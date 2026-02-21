# TCP Sniffer — Ops & Reliability Plan

## Purpose

Define operational, security, and reliability practices to support the TCP Sniffer runtime described in `docs/OVERVIEW.md` and `docs/ARCHITECTURE.md`.

## Logging and observability

Tasks:
- Structured logs (JSON recommended) with `timestamp`, `level`, `message`.
- Startup logs include interface, ports, and placement (pod/namespace/node).
- Log capture drop counts when available; log evictions and reassembly gaps.
- Log parse failures and non-HTTP streams once per stream.

## Security posture

Tasks:
- Container requires `NET_RAW`; avoid `NET_ADMIN` unless explicitly justified.
- Do not log full HTTP bodies by default.
- Require HTTPS for `outputUrl` in production.
- Support header redaction for sensitive headers (e.g. `Authorization`, `Cookie`).

## Resource management

Tasks:
- Enforce `maxConcurrentConnections` and `connectionIdleTimeoutMs`.
- Document how memory scales with connection count and `maxBodySize`.
- Provide recommended limits in deployment guidance.

## Failure handling

Tasks:
- Invalid config: log and exit (fail-fast).
- Missing interface: log available interfaces and exit.
- libpcap open failure: log exact error and exit.
- `outputUrl` failures: retry 3 times with exponential backoff; then log and drop.

## Graceful shutdown

Tasks:
- SIGTERM/SIGINT triggers stop, drain, and clean exit within grace period.
- Log shutdown start and completion for operator clarity.

## Milestones

- Structured logging and startup metadata are present and consistent.
- Security defaults are enforced (NET_RAW only, HTTPS output, header redaction).
- Resource limits and failure behaviors are active and logged.
- Graceful shutdown completes within the termination grace period.
