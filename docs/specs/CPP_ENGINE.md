# TCP Sniffer — C++ Engine Spec

## Purpose

Define the C++ engine behavior for packet capture, TCP reassembly, and HTTP parsing as described in `docs/ARCHITECTURE.md` and `docs/OVERVIEW.md`.

## Scope

In scope:
- libpcap capture, BPF filter, and packet decoding.
- TCP reassembly, connection management, and eviction.
- HTTP/1.x parsing and message construction.
- Delivery of structured messages to the TS layer.

Out of scope:
- Public API and output destinations (TS layer).
- Deployment/injector behavior.

## Inputs

Config values passed from the TS layer:
- `interface`
- `ports`
- `sampleRate`
- `maxBodySize`
- `maxConcurrentConnections`
- `connectionIdleTimeoutMs`

Packets are received from libpcap on the configured interface.

## Capture

- Open libpcap on the configured interface.
- Apply BPF filter: `tcp port P1 or tcp port P2 ...` from `ports`.
- Decode Ethernet/IP/TCP headers and payload.
- If no packets are received for a configured period, log once to assist operators.
- When libpcap exposes drop counts, log or report capture stats periodically or on stop.

## Connection management and reassembly

- Key connections by 4-tuple (src IP/port, dst IP/port).
- Identify **receiver** as the side whose port matches `ports`; the other side is **destination**.
- Order TCP segments by sequence number and deduplicate retransmits.
- Produce two ordered byte streams per connection (client→server, server→client).
- Enforce `maxConcurrentConnections`; when at cap, evict the oldest connection and log.
- Evict idle connections after `connectionIdleTimeoutMs`.
- Log reassembly gaps or incomplete streams once per affected connection.

## HTTP parsing

- Detect HTTP by leading tokens on each stream.
- Parse HTTP/1.x requests and responses, including common cases:
  - Chunked transfer encoding.
  - Multiple requests/responses on a single connection.
- Cap bodies at `maxBodySize`; set `bodyTruncated: true` when truncated.
- If payload is not valid UTF-8, omit or flag the body (e.g. `bodyEncoding: 'binary'`), consistent with the overview.
- Log parse failures or non-HTTP streams once per stream (optionally with a small sample).

## Message delivery to TS

For each reconstructed HTTP message, emit to the TS layer:
- `receiver` `{ ip, port }`
- `destination` `{ ip, port }`
- `direction` `'request' | 'response'`
- `method?`, `path?`, `statusCode?`, `headers`, `body?`, `bodyTruncated?`, `timestamp`

## Shutdown

- On stop, stop accepting new packets.
- Drain in-flight messages to the TS layer.
- Close the libpcap handle and clean up reassembly state.
