# TCP Sniffer — Overview

## Summary

TCP Sniffer is a TypeScript library with a C++ engine that passively captures TCP traffic, reassembles streams, and reconstructs HTTP messages. It does not proxy traffic and does not bind the target port. It always runs in a Linux container and uses libpcap to get a copy of packets, then reassembles TCP, parses HTTP, and outputs receiver IP/port, destination IP/port, and the reconstructed HTTP. The library is **only** for the case when you do not own the pod spec: the sniffer is added exclusively by a **mutating admission webhook** (sidecar injector). The application's pod spec is never edited; the webhook injects the sniffer container at admission time. The sniffer runs as a Kubernetes sidecar in the same pod as the target (shared network namespace). The host OS is irrelevant—any host that runs Linux containers can run the sniffer. The engine is implemented in C++ for performance; the public API is TypeScript so it can be used as a normal Node/TS library.

---

## What it does (and doesn't)

**In scope**

- **Packet capture only** — Uses libpcap to capture copies of packets inside a Linux container. Does not bind the target port; does not proxy. The target service keeps its port; the sniffer only observes.
- **TCP reassembly** — Orders segments by sequence number, deduplicates retransmits, and produces ordered byte streams per connection (both directions).
- **HTTP assembly** — Parses HTTP request/response from each stream; extracts method, path, status, headers, and body (with configurable max size).
- **Output** — For each connection/message: receiver IP and port, destination IP and port (from the 4-tuple), direction (request/response), and reconstructed HTTP. Output can be sent to a callback/event, POSTed to a URL, and/or written as JSON to stdout. The TS layer wraps callbacks so a thrown `onHttpMessage` is logged and does not kill the process; stdout is line-buffered so JSON lines are not lost.
- **Deployment** — Only via mutating admission webhook: the sniffer runs as a Kubernetes sidecar in the same pod as the target (shared network namespace). You do not own the pod spec; the webhook adds the sniffer container at admission time. No dependency on the target's OS; host OS is agnostic (any host that runs Linux containers).
- **Public API** — TypeScript library: `createSniffer(config)`, `sniffer.start()`, `sniffer.stop()`, and callbacks or events for reassembled HTTP. Engine implemented in C++, exposed via N-API addon (or optional subprocess IPC).

**Out of scope**

- Running outside a Linux container (e.g. native Windows or macOS process, Windows container).
- Deployment when you own the pod spec (e.g. manually adding the sniffer as a second container).
- Running the sniffer outside Kubernetes (e.g. Docker with shared network namespace).
- Acting as a proxy or binding the target port.
- Protocol-specific parsing beyond HTTP (e.g. Postgres, Redis).
- Built-in auth, metrics UI, or TLS decryption (HTTPS appears as ciphertext unless decrypted elsewhere). Observability is limited to structured logs and optional capture/reassembly stats rather than a full metrics UI.

---

## Key concepts

- **Receiver** — The "server" side of the connection: the IP and port that receive the connection (e.g. the pod's IP and the service port). Derived from the 4-tuple (src IP, src port, dst IP, dst port); the side whose port matches the configured capture port(s) is the receiver.
- **Destination** — The "client" or peer side: the IP and port that initiate or respond. The other half of the 4-tuple.
- **Capture-only** — The sniffer never binds the target port. It receives copies of packets from the OS/NIC; the real traffic still goes to the target. No change to client or server config.
- **Same network namespace** — The sniffer runs as a sidecar in the same pod as the target. Pod containers share one network namespace, so the sniffer sees the same interface and the same traffic as the target. Placement is determined by the injector, not by editing the application's pod spec.
- **Sidecar injector (mutating webhook)** — You do not own the pod spec (e.g. the Deployment is maintained by another team or an operator). The sniffer is added **only** by a **mutating admission webhook**: when a Pod is created or updated, the Kubernetes API server sends the Pod (in an HTTPS POST body) to an injector webhook you run; the webhook returns a modified Pod with the sniffer container appended; the API server stores that modified Pod. No one edits the original YAML; the injector adds the sidecar at admission time. Opt-in is typically by label (e.g. on the namespace or pod).
- **Linux container only** — The sniffer always runs in a Linux container. It never runs natively on Windows or macOS or in a Windows container. The host can be any OS that runs Linux containers (e.g. Linux node, Windows with Docker Desktop).

---

## How it works (data flow)

1. **Start** — User calls `sniffer.start()`. The library validates config (e.g. `ports` required) and fails fast with a clear log if invalid. It loads the C++ addon (or spawns the C++ process) and passes config: interface, ports, output URL, sample rate, max body size, connection cap, idle timeout, etc. The C++ engine opens a capture handle on the configured interface and sets a BPF filter (e.g. `tcp port 8080 or tcp port 8443`). At startup the sniffer logs the chosen interface (and whether it is loopback), capture ports, and—when available—pod/namespace/node (e.g. from env) for placement visibility. If the interface is missing, it logs available interfaces and exits; if libpcap fails (e.g. missing NET_RAW), it logs the exact error and exits.

2. **Capture** — The OS delivers copies of packets that match the filter. The engine decodes Ethernet/IP/TCP and extracts 4-tuple, sequence numbers, and payload. If no packets are received for a configured period (e.g. 30–60 s), the sniffer logs once so operators can check target traffic and port config. When libpcap exposes drop counts, the engine logs or reports capture stats (received/dropped) periodically or on stop.

3. **Reassembly** — Per connection (keyed by 4-tuple), the engine orders TCP segments and produces two ordered byte streams (client→server, server→client). It classifies receiver vs destination (e.g. the side with the capture port is receiver). The number of concurrent connections is capped by `maxConcurrentConnections`; when at cap, the engine evicts the oldest and logs. Connections with no activity for `connectionIdleTimeoutMs` are evicted. Reassembly gaps or incomplete streams are logged once per affected connection. Optionally the first few connections are logged (receiver/destination) for sanity checks.

4. **HTTP assembly** — On each stream, the engine detects HTTP (e.g. by leading tokens), parses request or response (headers, body up to max size), and builds a structured message (method, path, status, headers, body, direction). The implementation must handle common HTTP/1.x cases (e.g. chunked encoding, multiple requests on a connection); detailed parsing requirements are in the architecture or implementation spec. When the body is truncated by `maxBodySize`, the message includes a flag (e.g. `bodyTruncated: true`). Parse failures or non-HTTP streams are logged once per stream (optionally with a small sample) so ciphertext or other protocols are visible in logs.

5. **Output** — For each reassembled HTTP message (or connection summary), the engine sends to the TypeScript layer: receiver IP/port, destination IP/port, direction, and HTTP fields. The TS library invokes the user's callback or emits an event, and optionally POSTs to a URL or writes JSON to stdout. If no output (outputUrl, outputStdout, onHttpMessage) is configured, the sniffer logs a warning at startup. POST failures to `outputUrl` are retried up to 3 times with exponential backoff (e.g. 1s, 2s, 4s); after that, the failure is logged and the message is dropped (no persistent buffer in MVP). Optional env (e.g. `OUTPUT_URL_AUTH_TOKEN`) supplies a Bearer token for the POST when set.

6. **Stop** — User calls `sniffer.stop()`, or the process receives SIGTERM/SIGINT. The engine stops accepting new packets, drains in-flight messages to all outputs (callback, outputUrl, stdout), then closes the capture handle and cleans up reassembly state. Shutdown should complete within the pod's `terminationGracePeriodSeconds` so the container exits cleanly before being killed. The process registers SIGTERM/SIGINT and performs this graceful shutdown (log and call `stop()`).

---

## Configuration

Config is passed to `createSniffer(config)`. All fields that reference "receiver" or "destination" are derived from packets; the user only configures capture and output.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `interface` | string | No | Capture interface (e.g. `eth0`, `lo`). Default: first non-loopback or implementation default. |
| `ports` | number[] | Yes | Ports to capture (e.g. `[8080, 8443]`). BPF: `tcp port P1 or tcp port P2 ...`. |
| `outputUrl` | string | No | URL to POST each reassembled HTTP message (with receiver, destination, HTTP payload). In production, must use HTTPS. |
| `outputStdout` | boolean | No | If true, write JSON lines to stdout. |
| `sampleRate` | number | No | 0–1. Only process this fraction of connections (e.g. `0.1` = 10%). Reduces CPU. |
| `maxBodySize` | number | No | Max HTTP body size (bytes) to include in output. |
| `maxConcurrentConnections` | number | No | Cap on concurrent reassembly connections. When at cap, oldest is evicted. Default: e.g. 10000. |
| `connectionIdleTimeoutMs` | number | No | Evict connection after this many ms with no new data. Default: e.g. 300000 (5 min). |
| `onHttpMessage` | function | No | Callback invoked for each reassembled HTTP message: `(msg) => void` where `msg` includes receiver, destination, direction, HTTP fields. |

**Output message shape (conceptual):**

- `receiver`: `{ ip: string, port: number }`
- `destination`: `{ ip: string, port: number }`
- `direction`: `'request' | 'response'`
- `method?`, `path?`, `statusCode?`, `headers`, `body?`, `bodyTruncated?` (true when body was cut by `maxBodySize`), `timestamp` (ISO)
- `body` is a string (UTF-8). If the payload is not valid UTF-8, the implementation may replace/omit and set a flag (e.g. `bodyEncoding: 'binary'` or omit body and set `bodyTruncated` or similar) so consumers know the body is incomplete or binary.

---

## Public API

- **createSniffer(config)** — Creates a sniffer instance. Config must include `ports`; at least one of `outputUrl`, `outputStdout`, or `onHttpMessage` is typically set. Returns a `Sniffer` instance. Does not capture until `start()`.

- **sniffer.start()** — Starts capture on the configured interface with the port filter. Resolves when the capture handle is open. Rejects (and logs) if capture fails (e.g. permission, invalid interface) or if already running.

- **sniffer.stop()** — Stops capture, drains in-flight messages to outputs, closes the handle, and cleans up reassembly state. Safe to call if already stopped.

- **sniffer.isRunning()** — Returns `true` when capture is active (after `start()`, before `stop()`).

No other public methods for the MVP. The C++ engine is an implementation detail; the library may expose it via an N-API addon or a subprocess.

---

## Deployment

The sniffer is deployed **only** via a mutating admission webhook. There is no supported mode where you manually add the sniffer container or run it outside Kubernetes.

**Injector (webhook)**

- **Trigger** — Injection runs when the Pod (or its namespace) has a label that matches the webhook's selector (e.g. `tcp-sniffer/inject: "true"`). Exact label/annotation names and any per-pod overrides (e.g. ports, output URL) are defined in the deployment or injector documentation.
- **Response** — The webhook returns the standard Kubernetes **AdmissionReview** response with a modified Pod (JSON patch or full object) that includes the sniffer container, required volumes, and security context.
- **Operational** — The webhook endpoint must be HTTPS. Failure policy (fail open vs fail closed when the webhook is unavailable) and certificate provisioning (e.g. cert-manager) are documented in the deployment guide.

**Sniffer container**

- Linux image using libpcap. **Capabilities:** `capabilities.add: ["NET_RAW"]` is required. **NET_ADMIN** is not required for standard capture; if a deployment guide recommends it for a specific scenario, the reason must be documented.
- **Env:** e.g. `PORTS=8080`, `INTERFACE=eth0`, `OUTPUT_URL=...`. Optional: `OUTPUT_URL_AUTH_TOKEN` (or similar) for Bearer token when POSTing to `outputUrl`. Set `POD_NAME`, `NAMESPACE`, `NODE_NAME` (e.g. via downward API) so startup logs identify placement.
- **Resource sizing** — Container memory should be sized for reassembly state: it scales roughly with `maxConcurrentConnections` and `maxBodySize`. Recommended limits and a sizing formula are documented in the deployment guide.

**Receiver/destination**

- No need to configure "receiver IP" manually when in a pod. The engine infers receiver and destination from the 4-tuple; the side whose port is in `ports` is the receiver (e.g. the pod's service); the other is the destination (the peer).

---

## Platform support

- **Sniffer runtime:** Linux container only. The sniffer always runs inside a Linux container and uses **libpcap** for packet capture. No Npcap, no Windows container, no native Windows or macOS process.
- **Host:** Agnostic. Any host that can run Linux containers (e.g. Linux node, Windows with Docker Desktop) can run the sniffer image. The host OS does not affect the sniffer—the container is always Linux. Document in deployment guides that the sniffer requires a Linux container runtime; if the node cannot run the image, the pod will not schedule or will fail at start.

---

## Observability

- **Logging** — Logs are **structured** (JSON recommended). Include at least: `timestamp`, `level`, `message`. Startup and per-connection logs should include placement (pod, namespace, node) when available. This enables operators to query and correlate logs.
- **Optional stats** — The implementation may expose or log periodic stats for operational visibility, e.g. `connections_active`, `packets_dropped`, `http_messages_total`. Exact format (logs vs metrics endpoint) is implementation-defined.

---

## Failure modes and mitigations

Failure modes are addressed with low-cost mitigations: structured logging, config validation, and optional stats. Logs are the primary lever.

- **Deployment/placement** — Log pod name, namespace, and node at startup when provided via env (e.g. downward API). Log chosen interface and whether it is loopback; if the requested interface is missing, log available interfaces and exit. This answers "did we get the container on the host?" and "why can't we see traffic?" (e.g. wrong interface or only loopback).
- **Startup/permissions** — Validate required config (e.g. `ports` non-empty); invalid config yields a clear log and exit. On libpcap open failure, log the exact error (e.g. permission denied → check NET_RAW). Log version or build id at startup; on fatal exit, use a distinct exit code so orchestrator logs are clear.
- **Resource/connection churn** — Cap concurrent reassembly via `maxConcurrentConnections`; when at cap, evict oldest and log the evicted 4-tuple. Evict idle connections after `connectionIdleTimeoutMs`. Optionally log or expose "active connections" so high churn or memory pressure is visible. Container memory scales with connection count and max body size; recommend limits and document in the deployment guide.
- **Security** — HTTP bodies may contain PII. Do not log full bodies by default. Support optional redaction of sensitive headers (e.g. `Authorization`, `Cookie`) in logs and output; headers to redact are implementation-defined or configurable. Do not POST to untrusted URLs; in production, **outputUrl must use HTTPS**. TLS/HTTPS traffic is not decrypted; log once at startup that HTTPS will appear as ciphertext if helpful for operators.

---

## Verification

Implementation is considered complete when the following are covered:

- **Unit** — TCP reassembly and HTTP parsing (e.g. from synthetic segments or pcap fixtures) produce correct ordered streams and message structures.
- **Integration** — Replay pcap or generate live traffic against a test server; assert output shape and key fields (receiver, destination, method, path, status, body handling).
- **Webhook** — Create a Pod with the inject label; verify the pod has the sniffer sidecar with expected image and env; optionally verify the pod runs and captures traffic.
- **Shutdown** — Send SIGTERM to the process; verify it drains in-flight messages to all outputs and exits within the configured grace period.

---

## Tech stack

- **Public API:** TypeScript / Node.js.
- **Engine:** C++ (capture, reassembly, HTTP parsing). Exposed via N-API native addon (recommended) or standalone binary with IPC from the TS library.
- **Capture:** libpcap only (Linux container).
- **Build:** node-gyp or CMake-js for the addon; system deps in the container: libpcap-dev. No Windows or Npcap dependencies.
