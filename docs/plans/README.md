# TCP Sniffer — Plan Index

## Implementation plans

- `PLAN_MASTER_ROADMAP.md` — Phased roadmap across TS, C++, injector, and ops.
- `IMPLEMENTATION_LAYOUT.md` — **Parallel implementation layout**: what can be built in parallel and dependencies.
- `PLAN_CPP_ENGINE.md` — C++ capture/reassembly/HTTP implementation plan.
- `PLAN_TS_LIBRARY.md` — TypeScript API, lifecycle, and output plan.
- `PLAN_INJECTOR_DEPLOYMENT.md` — Mutating webhook + container deployment plan.
- `PLAN_TESTING_VALIDATION.md` — Testing strategy and validation coverage.
- `PLAN_OPS_RELIABILITY.md` — Logging, security, resource, and shutdown plan.

## Contract (Phase 0)

- `docs/specs/TS_CPP_CONTRACT.md` — TS↔C++ contract: config, message shape, lifecycle, error reporting. Required before parallel implementation.
