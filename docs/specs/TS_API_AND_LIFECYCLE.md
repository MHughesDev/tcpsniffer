# TCP Sniffer — TypeScript API & Lifecycle Spec

## Purpose

Define the public TypeScript API, lifecycle, and output behavior for the TCP Sniffer library described in `docs/ARCHITECTURE.md` and `docs/OVERVIEW.md`.

## Scope

In scope:
- Public API (`createSniffer`, `start`, `stop`, `isRunning`).
- Config validation and lifecycle management.
- Output handling: callback/event, `outputUrl`, stdout.
- Logging and shutdown behavior at the TS layer.

Out of scope:
- Packet capture, TCP reassembly, or HTTP parsing logic (C++ engine).
- Deployment and injector behavior (handled in other specs).

## Public API

- `createSniffer(config)` → `Sniffer`
- `sniffer.start()` → starts capture; rejects and logs on failure.
- `sniffer.stop()` → stops capture and drains outputs; safe to call when stopped.
- `sniffer.isRunning()` → boolean.

No additional public methods for the MVP.

## Configuration

Config is passed to `createSniffer(config)` and aligns with the overview table:

- `interface?: string` — capture interface; default implementation choice.
- `ports: number[]` — required; used to build the BPF filter.
- `outputUrl?: string` — POST each HTTP message; must be HTTPS in production.
- `outputStdout?: boolean` — JSON lines to stdout.
- `sampleRate?: number` — 0–1; fraction of connections to process.
- `maxBodySize?: number` — HTTP body size cap.
- `maxConcurrentConnections?: number` — cap on concurrent reassembly.
- `connectionIdleTimeoutMs?: number` — idle eviction threshold.
- `onHttpMessage?: (msg) => void` — callback per reassembled HTTP message.

Validation:
- `ports` is required and must be non-empty; invalid config logs a clear error and exits.
- If no output (`outputUrl`, `outputStdout`, `onHttpMessage`) is set, log a warning at startup.

## Lifecycle

### Start
- Validate config (fail fast on invalid).
- Load the C++ addon or spawn the C++ subprocess.
- Pass config (interface, ports, limits, output settings).
- Log startup info: interface, ports, placement (pod/namespace/node) when available.
- If the interface is missing, log available interfaces and exit.
- If libpcap fails to open (e.g. missing NET_RAW), log the exact error and exit.

### Output handling
- For each message from C++, the TS layer:
  - Invokes `onHttpMessage` if set; exceptions are caught, logged, and do not crash the process.
  - POSTs to `outputUrl` if set.
  - Writes JSON lines to stdout if `outputStdout` is true (line-buffered).
- `outputUrl` retries: up to 3 attempts with exponential backoff (1s, 2s, 4s); log and drop after retries.
- Optional Bearer auth when `OUTPUT_URL_AUTH_TOKEN` is provided via env.

### Stop
- On `sniffer.stop()` or SIGTERM/SIGINT:
  - Stop accepting new packets.
  - Drain in-flight messages to all configured outputs.
  - Close the capture handle and exit cleanly within the pod’s grace period.

## Message shape (TS output)

Messages conform to the overview output shape:
- `receiver`: `{ ip, port }`
- `destination`: `{ ip, port }`
- `direction`: `'request' | 'response'`
- `method?`, `path?`, `statusCode?`, `headers`, `body?`, `bodyTruncated?`, `timestamp`
- `body` is UTF-8 when possible; non-UTF-8 may be omitted or flagged.

## Logging

- Structured logs (JSON recommended) with `timestamp`, `level`, `message`.
- Startup logs include interface, ports, and placement when available.
- Errors from config validation, capture start, or output failures are logged clearly.
