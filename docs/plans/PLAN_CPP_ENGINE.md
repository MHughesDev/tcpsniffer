# TCP Sniffer — C++ Engine Implementation Plan

## Purpose

Define the implementation plan for the C++ capture/reassembly/HTTP engine described in `docs/specs/CPP_ENGINE.md`.

## Phase 1 — Capture foundation

Tasks:
- Implement libpcap open on configured interface.
- Build BPF filter from `ports` (e.g. `tcp port 8080 or tcp port 8443`).
- Decode Ethernet/IP/TCP headers and extract payload and sequence numbers.

Milestone:
- Capture starts successfully on a valid interface.
- Missing interface logs available interfaces and exits.
- Permission errors (missing NET_RAW) are logged clearly and exit.

## Phase 2 — Connection tracking and reassembly

Tasks:
- Key connections by 4-tuple and track both directions.
- Determine receiver vs destination using the configured ports.
- Order TCP segments by sequence number and deduplicate retransmits.
- Enforce `maxConcurrentConnections` and evict oldest; enforce `connectionIdleTimeoutMs`.

Milestone:
- Reassembled streams match ordered bytes from fixtures.
- Evictions and idle timeouts are logged once per event.
- Reassembly gaps are logged once per affected connection.

## Phase 3 — HTTP parsing

Tasks:
- Detect HTTP on each stream using leading tokens.
- Parse HTTP/1.x requests and responses.
- Handle chunked transfer encoding and multiple messages per connection.
- Apply `maxBodySize` and set `bodyTruncated` when truncated.
- Handle non-UTF-8 bodies by omission or flag consistent with overview guidance.

Milestone:
- HTTP fixtures produce expected method/path/status/headers/body.
- Non-HTTP or parse failures are logged once per stream.

## Phase 4 — Message emission to TS

Tasks:
- Define the message struct to match the overview output shape.
- Emit messages to TS with receiver/destination, direction, HTTP fields, and timestamp.
- Provide error reporting and stop/drain semantics to TS.

Milestone:
- TS receives messages with correct field mapping.
- Stop drains in-flight messages before closing capture handle.

## Phase 5 — Stats and operational hooks

Tasks:
- Log capture drop counts when available.
- Log startup details (interface, ports) for operator visibility.
- Optional periodic stats logging (connections, drops) if implemented.

Milestone:
- Operational logs are structured and include required fields.
