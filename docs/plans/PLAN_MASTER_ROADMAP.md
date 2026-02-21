# TCP Sniffer — Master Implementation Roadmap

## Purpose

Provide a phased implementation plan that sequences work across the TypeScript library, C++ engine, injector, and deployment/ops, based on `docs/ARCHITECTURE.md` and `docs/OVERVIEW.md`.

## Inputs

- `docs/OVERVIEW.md`
- `docs/ARCHITECTURE.md`
- `docs/specs/TS_API_AND_LIFECYCLE.md`
- `docs/specs/CPP_ENGINE.md`
- `docs/specs/INJECTOR.md`
- `docs/specs/DEPLOYMENT_OPS.md`

## Phases

### Phase 0 — Foundations

Tasks:
- Define the TS↔C++ contract (message shape, lifecycle calls, error reporting).
- Specify config validation rules and default behaviors.

Milestone:
- Contract and validation rules are documented and referenced by TS and C++ plans.

### Phase 1 — C++ capture pipeline

Tasks:
- Implement libpcap open + BPF filter from `ports`.
- Decode packets and track connections by 4-tuple.
- Reassemble TCP with ordering and retransmit dedupe.
- Classify receiver/destination from ports.

Milestone:
- Reassembly from fixtures yields ordered streams, correct 4-tuples, and logged evictions.

### Phase 2 — HTTP parsing and message emission

Tasks:
- Parse HTTP/1.x requests/responses (chunked, keep-alive, multiple messages).
- Apply `maxBodySize` truncation and flags.
- Emit structured messages to the TS layer.

Milestone:
- Parsed messages match fixtures; parse failures are logged once per stream.

### Phase 3 — TS API and output pipeline

Tasks:
- Implement public API (`createSniffer`, `start`, `stop`, `isRunning`).
- Enforce config validation and fail-fast errors.
- Route output to callback/event, `outputUrl`, and stdout JSON lines.
- Implement retry policy for `outputUrl`.

Milestone:
- TS layer receives C++ messages and outputs to all configured sinks.

### Phase 4 — Deployment and injector

Tasks:
- Implement mutating webhook injection by label.
- Patch in container, securityContext (NET_RAW), env, and downward API fields.
- Build sniffer container image with libpcap deps and TS entrypoint.

Milestone:
- Labeled pods are admitted with the sidecar; container starts and logs placement.

### Phase 5 — End-to-end validation and ops hardening

Tasks:
- Capture test HTTP traffic in a pod and validate output.
- Verify shutdown drain on SIGTERM within grace period.
- Validate operational logs and failure mode behavior.

Milestone:
- Overview verification steps pass with expected startup/capture/shutdown logs.

## Dependencies and sequencing

- C++ pipeline (Phases 1–2) can start in parallel with TS API scaffolding, but message contract must be finalized first.
- Injector and deployment (Phase 4) depend on stable env/config and entrypoint behavior.
- End-to-end validation depends on all previous phases.
