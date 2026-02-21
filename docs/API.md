# TCP Sniffer — API reference

This page summarizes the public API of the `tcp-sniffer` package. For lifecycle, config validation, and output behaviour, see [TS API & Lifecycle spec](specs/TS_API_AND_LIFECYCLE.md) and [Overview](OVERVIEW.md).

## Entry point

```ts
import { createSniffer, validateConfig, ... } from 'tcp-sniffer';
```

## createSniffer

**`createSniffer(config: SnifferConfig): Sniffer`**

Creates a sniffer instance. Does not start capture until `start()` is called. Config must include `ports`; at least one of `outputUrl`, `outputStdout`, or `onHttpMessage` is typically set. Invalid config will cause `validateConfig()` / `start()` to throw.

## Sniffer

Returned by `createSniffer`. Methods:

| Method | Description |
|--------|-------------|
| **start()** | Starts capture on the configured interface and ports. Returns a Promise that resolves when the capture handle is open. Rejects (and logs) if capture fails or already running. |
| **stop()** | Stops capture, drains in-flight messages to all outputs, closes the handle. Safe to call when already stopped. Returns a Promise. |
| **isRunning()** | Returns `true` when capture is active (after `start()`, before `stop()`). |

## SnifferConfig

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ports` | `number[]` | Yes | Ports to capture (e.g. `[8080, 8443]`). BPF filter is built from these. |
| `interface` | `string` | No | Capture interface (e.g. `eth0`, `lo`). Default: implementation choice (e.g. first non-loopback). |
| `outputUrl` | `string` | No | URL to POST each reassembled HTTP message. Must be HTTPS in production. |
| `outputStdout` | `boolean` | No | If true, write JSON lines to stdout. |
| `onHttpMessage` | `(msg: HttpMessage) => void` | No | Callback invoked for each reassembled HTTP message. |
| `sampleRate` | `number` | No | 0–1; fraction of connections to process. Default 1. |
| `maxBodySize` | `number` | No | Max HTTP body size (bytes) to include in output. |
| `maxConcurrentConnections` | `number` | No | Cap on concurrent reassembly connections. |
| `connectionIdleTimeoutMs` | `number` | No | Evict connection after this many ms idle. |
| `redactHeaders` | `string[]` | No | Header names to redact (case-insensitive). Default: `['authorization', 'cookie']`. Use `[]` to disable. |

## HttpMessage

Shape of each message delivered to `onHttpMessage`, POST body, and stdout:

| Field | Type | Description |
|-------|------|-------------|
| `receiver` | `Endpoint` | Server side of the connection (port in `ports`). |
| `destination` | `Endpoint` | Peer side of the connection. |
| `direction` | `'request' \| 'response'` | Request = client→server; response = server→client. |
| `headers` | `Record<string, string>` | HTTP headers. |
| `timestamp` | `string` | ISO 8601 UTC. |
| `method` | `string` | For requests (e.g. `GET`, `POST`). |
| `path` | `string` | For requests (path + query). |
| `statusCode` | `number` | For responses. |
| `body` | `string` | UTF-8 when possible. |
| `bodyTruncated` | `boolean` | True when body was cut by `maxBodySize`. |
| `bodyEncoding` | `string` | e.g. `'binary'` when body omitted or not UTF-8. |

## Endpoint

`{ ip: string; port: number }` — used for `receiver` and `destination`.

## Validation and helpers

| Export | Description |
|--------|-------------|
| **validateConfig(config)** | Validates and normalizes config; throws `ValidationError` if invalid. Call before passing config to C++ or at startup. |
| **ValidationError** | Error class (message, optional `field`). |
| **hasOutputConfigured(config)** | Returns true if at least one of outputUrl, outputStdout, or onHttpMessage is set. |

## Constants

| Export | Description |
|--------|-------------|
| `CONTRACT_DEFAULTS` | Default values for engine config (sampleRate, maxBodySize, etc.). |
| `MIN_PORT`, `MAX_PORT` | Valid port range (1–65535). |
| `MIN_SAMPLE_RATE`, `MAX_SAMPLE_RATE` | Valid sample rate range (0–1). |

## Engine errors (internal / advanced)

- **ENGINE_ERROR_CODES** — Fatal error codes from the C++ engine (e.g. `CAPTURE_OPEN_FAILED`, `INVALID_INTERFACE`, `UNRECOVERABLE`).
- **EngineError**, **EngineErrorCode** — Types for engine error reporting. The library handles these and logs or exits; they are exported for type or test use.
