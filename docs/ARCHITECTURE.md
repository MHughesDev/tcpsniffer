# TCP Sniffer — Architecture

## Purpose and relationship

This architecture implements the system described in `docs/OVERVIEW.md`. It defines components and their interfaces so that individual specs (TypeScript API, C++ engine, injector, deployment/ops) can be generated without conflicting scope.

Design principles (derived from the overview):
- Capture-only: observe traffic via libpcap; never bind the target port or proxy.
- Webhook-only deployment: the sniffer is added exclusively by a mutating admission webhook.
- Fail-fast validation: invalid config or capture failures produce clear logs and exit.

## High-level architecture

TCP Sniffer is a TypeScript library backed by a C++ capture/reassembly engine, always running in a Linux container. Deployment is exclusively via a mutating admission webhook that injects a sidecar into pods at admission time. The application pod spec is never edited; the injector adds the sniffer container.

Control plane:
- **Kubernetes API server ↔ mutating webhook (injector)**: AdmissionReview requests/ responses drive sidecar injection.

Data plane per pod:
- **Sniffer container** runs a Node/TypeScript process.
- The **TS layer** loads a **C++ addon (N-API) or subprocess**.
- The **C++ engine** uses **libpcap** to capture packets, reassemble TCP, parse HTTP, and send structured messages back to TypeScript.
- The **TS layer** emits output to callback/event, POSTs to `outputUrl`, and/or writes JSON lines to stdout.

Key boundaries:
- **Kubernetes ↔ injector**: AdmissionReview request/response.
- **TS ↔ C++**: config, lifecycle, and HTTP message delivery.
- **Sniffer ↔ output URL**: HTTP POST contract, auth, and retries.

## Component list and responsibilities

### TypeScript library
- **Responsibility**: Public API (`createSniffer`, `start`, `stop`) and output handling (callback/event, POST, stdout). Validates config and manages lifecycle and shutdown. It does not capture packets or parse TCP/HTTP.
- **Inputs**: Config object; optional env-derived values; HTTP message stream from C++.
- **Outputs**: User callback/event, HTTP POST to `outputUrl`, JSON lines to stdout, structured logs.
- **Spec(s) to generate**: → TS API & lifecycle spec

### C++ engine
- **Responsibility**: Packet capture via libpcap, TCP reassembly, HTTP parsing, and message construction. It does not decide deployment or output destinations beyond delivering messages to TS.
- **Inputs**: Config values (interface, ports, limits); packets from libpcap.
- **Outputs**: Structured HTTP messages to TS; capture/parse logs/stats.
- **Spec(s) to generate**: → C++ engine spec

### Sidecar injector (mutating webhook)
- **Responsibility**: Injects the sniffer container into pods at admission time based on labels/selectors. It does not run the sniffer or parse traffic.
- **Inputs**: AdmissionReview request from Kubernetes API server.
- **Outputs**: AdmissionReview response with JSON patch or full object including sniffer container, volumes, security context, and env.
- **Spec(s) to generate**: → Injector spec

### Sniffer container image / deployment
- **Responsibility**: Linux image that runs the TS entrypoint and C++ engine with libpcap dependencies and required capabilities. It does not change target service config.
- **Inputs**: Env vars (e.g. `PORTS`, `INTERFACE`, `OUTPUT_URL`, `OUTPUT_URL_AUTH_TOKEN`); downward API values for placement logs.
- **Outputs**: Running sidecar container that emits logs and outputs configured messages.
- **Spec(s) to generate**: → Deployment/ops spec

## Interfaces

### TS ↔ C++
- **Config passing**: TS validates and passes interface, ports, sample rate, max body size, connection cap, idle timeout, and output settings to the C++ addon or subprocess at start.
- **Message delivery**: C++ sends structured HTTP messages (receiver/destination, direction, headers/body, flags) to TS. TS forwards to callback/event, `outputUrl`, and/or stdout.
- **Lifecycle**: TS calls start/stop; C++ opens/closes libpcap handle, drains in-flight messages, and reports errors. C++ reports fatal errors to TS; TS logs and exits.

### Injector ↔ Kubernetes
- **AdmissionReview**: Kubernetes API server POSTs an AdmissionReview with the pod object; injector returns an AdmissionReview response.
- **Patch contents**: Adds sniffer container, required volumes, securityContext (NET_RAW), and env sources (ports, interface, output settings, downward API fields).

### Sniffer ↔ output URL
- **POST body**: Must match the overview's output message shape: receiver/destination, direction, headers/body, and timestamp. Body is UTF-8 when possible; otherwise a flag indicates binary/incomplete content.
- **Auth**: Optional Bearer token (e.g. `OUTPUT_URL_AUTH_TOKEN`) when set.
- **Retries**: Up to 3 retries with exponential backoff (1s, 2s, 4s); failures are logged and messages dropped.

## Data flow (refined from overview)

1. **Start** — TS validates config and logs startup info; TS loads C++ and passes config; C++ opens libpcap and applies BPF filter.
2. **Capture** — C++ receives packets from libpcap and decodes TCP/IP headers and payloads.
3. **Reassembly** — C++ orders segments, deduplicates retransmits, and produces ordered streams per connection.
4. **HTTP assembly** — C++ parses HTTP requests/responses and builds structured messages.
5. **Output** — C++ sends messages to TS; TS emits callback/event, POSTs to `outputUrl`, and/or writes JSON lines to stdout.
6. **Stop** — TS handles SIGTERM/SIGINT and calls stop; C++ drains in-flight messages, closes capture handle, and returns; TS exits.

## Configuration and environment

- **Library config**: Passed to `createSniffer(config)` per the overview config table (interface, ports, outputUrl, outputStdout, sampleRate, maxBodySize, maxConcurrentConnections, connectionIdleTimeoutMs, onHttpMessage).
- **Container env**: `PORTS`, `INTERFACE`, `OUTPUT_URL`, `OUTPUT_URL_AUTH_TOKEN`, and placement env (pod/namespace/node) via downward API for logging.
- **Entrypoint behavior**: The TS entrypoint reads env vars, constructs the config object, and calls `createSniffer(config)`.

## Cross-cutting concerns

- **Logging**: Both TS and C++ emit structured logs (JSON recommended) including `timestamp`, `level`, and `message`. Startup logs include interface, ports, and placement (pod/namespace/node) when available.
- **Security**: Container requires NET_RAW; NET_ADMIN is not required by default. Do not log full HTTP bodies by default. In production, `outputUrl` must be HTTPS. Optional header redaction (e.g. `Authorization`, `Cookie`) applies to logs and output.
- **Resource & failure handling**: C++ enforces `maxConcurrentConnections` and `connectionIdleTimeoutMs`, logs evictions and parse gaps, and reports capture drops when available. TS handles retry policy for `outputUrl` and logs config validation failures; shutdown is graceful and drains in-flight messages within the pod's termination grace period.

## Specs to generate (index)

- **TS API & lifecycle spec** ← §Component list (TypeScript library), §Interfaces (TS↔C++), §Data flow (Start/Output/Stop), §Configuration, §Cross-cutting (logging/shutdown)
- **C++ engine spec** ← §Component list (C++ engine), §Interfaces (TS↔C++), §Data flow (Capture/Reassembly/HTTP), §Cross-cutting (resource/failure)
- **Injector spec** ← §Component list (Sidecar injector), §Interfaces (Injector↔Kubernetes)
- **Deployment/ops spec** ← §Component list (Sniffer container image), §Configuration & environment, §Cross-cutting (security/logging), plus `docs/OVERVIEW.md` Deployment and Verification
