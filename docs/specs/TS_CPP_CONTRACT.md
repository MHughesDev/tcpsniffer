# TCP Sniffer — TS ↔ C++ Contract

## Purpose

Single source of truth for the boundary between the TypeScript library and the C++ engine. Both sides implement against this contract. See `docs/ARCHITECTURE.md` and `docs/plans/IMPLEMENTATION_LAYOUT.md`.

---

## 1. Config passed TS → C++

At **start**, the TS layer passes the following to the C++ engine. All values are validated by TS before being passed; C++ may assume valid ranges where noted.

| Field | Type | Required | Default (if omitted) | Notes |
|-------|------|----------|---------------------|--------|
| `interface` | string | No | implementation default (e.g. first non-loopback) | Capture interface name |
| `ports` | number[] | Yes | — | Non-empty; used to build BPF filter |
| `sampleRate` | number | No | 1 | 0–1; fraction of connections to process |
| `maxBodySize` | number | No | implementation (e.g. 1 MiB) | Max HTTP body bytes to include |
| `maxConcurrentConnections` | number | No | e.g. 10000 | Cap on concurrent reassembly connections |
| `connectionIdleTimeoutMs` | number | No | e.g. 300000 | Idle eviction in milliseconds |

**Out of scope for C++:** `outputUrl`, `outputStdout`, `onHttpMessage` — these are TS-only; C++ only delivers messages to TS.

**Serialization:** When using N-API, pass as object properties; when using subprocess IPC, pass as JSON object (one line per message type).

---

## 2. Message shape (C++ → TS)

For each reassembled HTTP message, C++ sends one structured message to TS. TS forwards to callback, outputUrl, and/or stdout.

**Required fields:**

| Field | Type | Description |
|-------|------|-------------|
| `receiver` | `{ ip: string, port: number }` | Server side of the 4-tuple (port in `ports`) |
| `destination` | `{ ip: string, port: number }` | Peer side of the 4-tuple |
| `direction` | `'request' \| 'response'` | Request = client→server; response = server→client |
| `headers` | `Record<string, string>` or array of `[name, value]` | HTTP headers (normalized name, value) |
| `timestamp` | string | ISO 8601 UTC (e.g. `2025-02-21T12:00:00.000Z`) |

**Conditional / optional:**

| Field | Type | When present |
|-------|------|----------------------|
| `method` | string | For requests (e.g. `GET`, `POST`) |
| `path` | string | For requests (path + query) |
| `statusCode` | number | For responses |
| `body` | string | UTF-8 when possible |
| `bodyTruncated` | boolean | `true` when body was cut by `maxBodySize` |
| `bodyEncoding` | string | e.g. `'binary'` when body omitted or not UTF-8 |

**Serialization:** N-API: object with these properties. Subprocess IPC: one JSON object per message, one line per message (NDJSON), UTF-8.

**Example (conceptual):**

```json
{
  "receiver": { "ip": "10.0.0.1", "port": 8080 },
  "destination": { "ip": "10.0.0.2", "port": 45678 },
  "direction": "request",
  "method": "GET",
  "path": "/api/health",
  "headers": { "host": "localhost:8080", "accept": "*/*" },
  "body": "",
  "timestamp": "2025-02-21T12:00:00.000Z"
}
```

---

## 3. Lifecycle

### Start

- **TS** calls into C++ (e.g. `start(config)`).
- **C++** opens libpcap on the configured interface, applies BPF filter from `ports`, and begins the capture loop.
- **C++** returns success when the handle is open (or sends an async success).
- **C++** on failure: reports error to TS (see §5); TS logs and rejects `sniffer.start()`.

### During capture

- **C++** reassembles TCP, parses HTTP, and for each message calls the TS callback or pushes a message to the TS queue (per binding).
- **TS** does not block C++; delivery is asynchronous (queue or callback invoked from C++ thread).

### Stop

- **TS** calls into C++ (e.g. `stop()`).
- **C++** stops accepting new packets, **drains** in-flight messages to TS (so all parsed messages are delivered), then closes the libpcap handle and frees reassembly state.
- **C++** returns (or signals completion) when drain and cleanup are done.
- **TS** considers capture stopped only after C++ has returned from stop.

---

## 4. Error reporting (C++ → TS)

C++ reports failures to TS so TS can log and/or exit.

**Fatal (capture cannot continue):**

- Interface missing or invalid.
- libpcap open failure (e.g. permission / NET_RAW).
- Any unrecoverable engine error.

**Contract:** C++ invokes an error callback or sends an error message to TS with at least:

- `code`: string (e.g. `CAPTURE_OPEN_FAILED`, `INVALID_INTERFACE`).
- `message`: string (human-readable, suitable for logs).

**TS responsibility:** Log the error clearly and reject `start()` or exit the process when fatal.

**Non-fatal:** Reassembly gaps, parse failures, evictions — C++ logs these itself (structured log); optional: also send a small set of stats to TS for logging.

---

## 5. Config validation rules (TS; reference for both)

TS enforces these before calling C++; C++ can assume they hold.

- **ports:** Required, non-empty array of numbers in valid port range (1–65535).
- **sampleRate:** If present, number in [0, 1].
- **maxBodySize:** If present, positive integer.
- **maxConcurrentConnections:** If present, positive integer.
- **connectionIdleTimeoutMs:** If present, positive integer.
- **interface:** If present, non-empty string (C++ may still fail if interface does not exist).

**Defaults (TS applies before passing to C++):**

- `sampleRate`: 1  
- `maxBodySize`: 1_048_576  
- `maxConcurrentConnections`: 10_000  
- `connectionIdleTimeoutMs`: 300_000  
- `interface`: `''` (empty → C++ uses implementation default)

If validation fails, TS logs a clear message and does not call C++ start; `createSniffer` may still return an instance, but `start()` will reject.

---

## 6. Summary

- **Config:** TS validates and passes §1 to C++ at start.
- **Messages:** C++ sends §2 per HTTP message to TS; TS forwards to callback/URL/stdout.
- **Lifecycle:** Start (open capture), run (deliver messages), Stop (drain then close).
- **Errors:** C++ reports fatal errors to TS with code + message; TS logs and exits or rejects start.

This contract is the Phase 0 deliverable; TS and C++ implementations should both reference this document.
