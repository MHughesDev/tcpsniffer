# TCP Sniffer — TypeScript Library Implementation Plan

## Purpose

Define the implementation plan for the TypeScript API and lifecycle described in `docs/specs/TS_API_AND_LIFECYCLE.md`.

## Phase 1 — API scaffolding

Tasks:
- Define `createSniffer(config)` and `Sniffer` interface (`start`, `stop`, `isRunning`).
- Implement config validation (ports required, ranges, output settings).
- Log fail-fast validation errors and exit.

Milestone:
- API compiles and validates config consistently with the overview.

## Phase 2 — C++ integration

Tasks:
- Load N-API addon or spawn subprocess.
- Pass config values to the engine (interface, ports, limits).
- Define lifecycle calls (start/stop) and error reporting from C++.

Milestone:
- Start opens capture handle; errors are propagated and logged.
- Stop drains and releases resources cleanly.

## Phase 3 — Output pipeline

Tasks:
- Receive messages from C++ and forward to:
  - `onHttpMessage` callback/event (wrapped with try/catch).
  - `outputUrl` POST with retries (1s, 2s, 4s).
  - stdout JSON lines if `outputStdout` is true.
- Log warning at startup if no output is configured.

Milestone:
- Callback errors are logged without crashing.
- POST retries occur and failures are logged and dropped.
- Stdout is line-buffered and emits valid JSON lines.

## Phase 4 — Lifecycle and shutdown

Tasks:
- Register SIGTERM/SIGINT handlers to call `stop()`.
- Ensure draining completes within termination grace period.
- Maintain `isRunning()` state accurately.

Milestone:
- SIGTERM/SIGINT triggers graceful shutdown and drain.
- `isRunning()` reflects lifecycle state.

## Phase 5 — Logging and placement metadata

Tasks:
- Emit structured logs with `timestamp`, `level`, `message`.
- Include placement metadata (pod/namespace/node) when available from env.
- Log chosen interface and capture ports at startup.

Milestone:
- Startup logs provide placement and capture configuration visibility.
