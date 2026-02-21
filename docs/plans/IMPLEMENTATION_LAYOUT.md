# TCP Sniffer — Parallel Implementation Layout

## Purpose

Lay out what can be implemented **in parallel** from the plans, with clear dependencies and handoff points. Use this to split work across TS, C++, injector, and ops without blocking each other.

---

## Phase 0 — Do first (single stream)

**Must complete before parallel work.** Establishes the contract and validation rules.

| Task | Owner | Output |
|------|--------|--------|
| Define TS↔C++ contract | Shared | `docs/specs/TS_CPP_CONTRACT.md`: message shape, config passing, lifecycle (start/stop/drain), error reporting |
| Specify config validation rules & defaults | Shared | Same doc + referenced in TS and C++ plans |

**Milestone:** Contract and validation rules are documented; TS and C++ can implement against the contract.

---

## Parallel workstreams (after Phase 0)

Once the contract exists, these streams can progress **in parallel** (different people or same person in sequence).

### Stream A — C++ engine

| Phase | Tasks | Depends on | Can run in parallel with |
|-------|--------|------------|---------------------------|
| **A1** | libpcap open, BPF from `ports`, decode Ethernet/IP/TCP | Phase 0 contract | B1, C1, D1 |
| **A2** | 4-tuple connection tracking, TCP reassembly, receiver/destination, eviction | A1 | B2, C1, C2, D1 |
| **A3** | HTTP/1.x parsing, chunked, maxBodySize, message struct | A2 | B2, B3, C2, D1 |
| **A4** | Emit messages to TS (per contract), stop/drain | A3, TS addon/subprocess interface | B3, B4, C2, D2 |
| **A5** | Capture stats, drop counts, startup logs | A4 | B4, B5, C3, D2 |

**Deliverable:** C++ addon or subprocess that accepts config, captures/reassembles/parses, and delivers messages per `TS_CPP_CONTRACT.md`.

---

### Stream B — TypeScript library

| Phase | Tasks | Depends on | Can run in parallel with |
|-------|--------|------------|---------------------------|
| **B1** | `createSniffer(config)`, `Sniffer` interface, config validation | Phase 0 contract | A1, C1, D1 |
| **B2** | Load N-API addon or spawn subprocess; pass config; start/stop lifecycle | B1, contract | A2, A3, C1, D1 |
| **B3** | Output pipeline: callback, outputUrl (retries), stdout JSON | B2, contract message shape | A3, A4, C2, D1 |
| **B4** | SIGTERM/SIGINT → stop(), drain, isRunning() | B2 | A4, A5, C2, D2 |
| **B5** | Structured logging, placement metadata from env | B3, B4 | A5, C3, D2 |

**Deliverable:** TS package with public API that uses C++ (stub or real) and outputs to callback/URL/stdout per spec.

**Note:** B2 can start with a **stub/mock** C++ layer that emits fixture messages; swap in real C++ when A4 is ready.

---

### Stream C — Injector (mutating webhook)

| Phase | Tasks | Depends on | Can run in parallel with |
|-------|--------|------------|---------------------------|
| **C1** | Parse AdmissionReview, label-based eligibility, return AdmissionReview response | None (K8s API only) | A1, A2, B1, B2, D1 |
| **C2** | Patch: sidecar container, NET_RAW, volumes, env (PORTS, INTERFACE, OUTPUT_*), downward API | C1, container env spec from Phase 0/ops | A3, A4, B3, B4, D1 |
| **C3** | Webhook TLS, failure policy, deployment wiring (per ops doc) | C2 | A5, B5, D2 |

**Deliverable:** Webhook service that mutates eligible pods with sniffer sidecar; can be tested with a dummy image until Stream D has a real image.

**Note:** C2 only needs the **env var names and container spec** (from contract/ops); it does not depend on the sniffer binary being built.

---

### Stream D — Container image & ops

| Phase | Tasks | Depends on | Can run in parallel with |
|-------|--------|------------|---------------------------|
| **D1** | Dockerfile: Linux, libpcap, Node, TS entrypoint; entrypoint reads env → `createSniffer(config)` | Phase 0 (env vars), B1 (config shape) | A1–A3, B2, C1, C2 |
| **D2** | Image runs and logs placement/interface/ports; document resource limits, HTTPS, NET_RAW | D1, B4, B5 (entrypoint behavior) | A4, A5, B5, C3 |
| **D3** | Deployment guide: cert-manager, failure policy, verification steps | C3, D2 | After C3/D2 |

**Deliverable:** Sniffer container image and deployment/ops documentation.

**Note:** D1 can use a **stub TS app** that only validates env and logs; replace with real TS+C++ when A4 and B3 are ready.

---

## Dependency diagram (simplified)

```
                    Phase 0 (contract + validation)
                                    |
        +---------------------------+---------------------------+
        |                           |                           |
   Stream A (C++)              Stream B (TS)              Stream C (Injector)
   A1 → A2 → A3 → A4 → A5      B1 → B2 → B3 → B4 → B5     C1 → C2 → C3
        |                           |                           |
        |                     (B2/B3 integrate with A4)         |
        +---------------------------+---------------------------+
                                    |
                            Stream D (Image & Ops)
                            D1 (can start after B1) → D2 → D3
```

- **A ↔ B:** Integration at A4/B2–B3 (message delivery and lifecycle). B can use a mock until A4 is done.
- **C ↔ D:** C2 defines the container spec and env; D1 builds the image that satisfies that spec.
- **E2E:** Requires A4, B4, C2, D2 (running pod with real sniffer and webhook).

---

## What to implement in parallel (summary)

| From the start (after Phase 0) | After first milestones |
|--------------------------------|------------------------|
| **C++** capture + reassembly (A1, A2) | **C++** HTTP parsing + message emit (A3, A4) |
| **TS** API + config validation (B1) | **TS** output pipeline + shutdown (B3, B4) |
| **TS** addon/subprocess interface + stub (B2) | **Injector** patch composition (C2) |
| **Injector** AdmissionReview flow (C1) | **Container** image that runs entrypoint (D1 → D2) |
| **Ops** doc outline / env list (D1 spec only) | **Tests** per plan (unit: reassembly, HTTP, config; webhook: schema, patch) |

---

## Suggested order to start

1. **Phase 0** — Write `TS_CPP_CONTRACT.md` (message shape, config fields, lifecycle, errors).
2. **Kick off in parallel:**
   - **Stream A:** C++ capture foundation (A1).
   - **Stream B:** TS `createSniffer` + config validation (B1); then B2 with a **mock** C++ that emits a few fixture messages.
   - **Stream C:** Injector request/response + label check (C1).
   - **Stream D:** Dockerfile + entrypoint that reads env and calls `createSniffer` (stub or real) (D1).
3. **Integration:** When A4 and B2/B3 are ready, wire real C++ into TS and test message flow.
4. **E2E:** When C2 and D2 are ready, deploy webhook + image and run verification from `OVERVIEW.md`.

This layout keeps TS, C++, injector, and container work independent until integration points, so you can implement in parallel from the plans.
