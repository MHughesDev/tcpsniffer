# TCP Sniffer — Production Readiness: Implementation Deep-Dive

This document describes **how to implement** each production-ready gap identified against the architecture and overview. For each gap we cover: current state, desired behavior, where code lives, data flow, and concrete implementation steps.

---

## 1. outputUrl HTTPS enforcement (production)

### Current state

- [docs/OVERVIEW.md](docs/OVERVIEW.md) and [docs/specs/DEPLOYMENT_OPS.md](docs/specs/DEPLOYMENT_OPS.md) require: *in production, `outputUrl` must use HTTPS*.
- [src/validation.ts](src/validation.ts) validates ports, sampleRate, limits, interface—**no check on `outputUrl`**.
- [src/output.ts](src/output.ts) `postToUrl()` uses whatever URL is passed; no protocol check.

### Desired behavior

- When the process is considered “production” (see below), if `outputUrl` is set and its protocol is not `https:`, validation must fail with a clear error so the container exits at startup instead of posting to HTTP.
- In non-production (e.g. local/dev), allow `http` for `outputUrl` so tests and local runs still work.

### How “production” is determined

Two practical options:

1. **Environment variable**  
   Use something like `NODE_ENV=production` or a dedicated `TCP_SNIFFER_PRODUCTION=1`.  
   - Pros: explicit, no dependency on Kubernetes.  
   - Cons: operators must set it in the injector/deployment (e.g. add `NODE_ENV: "production"` or `TCP_SNIFFER_PRODUCTION: "1"` to the sniffer container env).

2. **Presence of placement env**  
   If `POD_NAME` or `NAMESPACE` is set, treat as production (we’re in a pod).  
   - Pros: no extra env to configure.  
   - Cons: slightly implicit; any local run that sets those env vars would also enforce HTTPS.

Recommendation: use an **explicit env** (e.g. `NODE_ENV=production` or `TCP_SNIFFER_PRODUCTION=1`) so intent is clear and the injector can set it once for all injected pods.

### Where to implement

- **Validation layer**  
  Add a small helper used only when `outputUrl` is present, and only when “production” is true:
  - Parse URL with `new URL(outputUrl)` (throws if invalid).
  - Require `url.protocol === 'https:'`.
  - On failure: throw `ValidationError` with a message like `outputUrl must use HTTPS in production` and `field: 'outputUrl'`.
- **Call site**  
  Call this helper **inside `validateConfig()`** after existing asserts: if `config.outputUrl` is non-empty and production env is set, run the HTTPS check; otherwise skip.  
  That way both the library entrypoint and the container entrypoint (which calls `validateConfig(config)` in [src/entrypoint.ts](src/entrypoint.ts)) get the same behavior without duplicating logic.

### Data flow

```
configFromEnv() (entrypoint)
  → config.outputUrl = process.env.OUTPUT_URL
  → validateConfig(config)
       → existing asserts (ports, sampleRate, …)
       → if production && config.outputUrl: assert https
  → createSniffer(config) → start()
```

If HTTPS check fails, `validateConfig` throws → entrypoint catches `ValidationError`, logs, sets `process.exitCode = 1`, returns (no start). Same for library callers: `start()` will throw after `validateConfig()`.

### Edge cases

- **Empty or missing outputUrl**  
  Do not run the HTTPS check (no URL to validate).
- **Invalid URL**  
  `new URL(outputUrl)` will throw; catch and rethrow as `ValidationError` with a clear message so we don’t leak a generic TypeError.
- **Case and normalization**  
  `url.protocol` is normalized (e.g. `HTTPS:` → `https:`); no extra normalization needed.

---

## 2. Header redaction (Authorization, Cookie)

### Current state

- Docs ([docs/OVERVIEW.md](docs/OVERVIEW.md), [docs/plans/PLAN_OPS_RELIABILITY.md](docs/plans/PLAN_OPS_RELIABILITY.md)) say: optional redaction of sensitive headers (e.g. `Authorization`, `Cookie`) in logs and output.
- Today, [src/output.ts](src/output.ts) sends the full `HttpMessage` (including `headers`) to callback, `outputUrl` POST, and stdout. [src/logger.ts](src/logger.ts) does not log HTTP messages; the C++ engine and TS layer do not redact headers anywhere.

### Desired behavior

- Before delivering an `HttpMessage` to any output (callback, outputUrl, stdout), optionally replace values of sensitive header names with a placeholder (e.g. `[REDACTED]`) so that logs and downstream consumers never see raw tokens.
- Headers to redact should be configurable (default: at least `authorization`, `cookie`; case-insensitive match).

### Where to implement

- **Single place: one function that returns a “safe” message**  
  Redaction should happen in **one** place so all outputs see the same data. The natural place is the **output pipeline** in [src/output.ts](src/output.ts), right before any use of `msg`:
  - Add a function, e.g. `redactSensitiveHeaders(msg: HttpMessage, headerNamesToRedact: string[]): HttpMessage`.
  - Input: the message and a list of header names (e.g. `['authorization', 'cookie']`).
  - Logic: clone `msg` (or at least `msg.headers`), then for each key in `msg.headers` that matches any of `headerNamesToRedact` (case-insensitive), set the value to `'[REDACTED]'`.
  - Return the cloned message; callers use this for callback, POST body, and stdout.
- **Config**  
  Add to [src/types.ts](src/types.ts) `SnifferConfig` an optional field, e.g. `redactHeaders?: string[]`. If absent, use a default list (e.g. `['authorization', 'cookie']`) so that by default we redact. If the user passes `redactHeaders: []`, no redaction.
- **Entrypoint**  
  [src/entrypoint.ts](src/entrypoint.ts) builds config from env only; it does not currently support redact list from env. For MVP we can:
  - Either add an env var, e.g. `REDACT_HEADERS=Authorization,Cookie` (optional; default behavior = redact those two).
  - Or leave entrypoint with no env for redaction and use the default list when creating the sniffer (so container always redacts the default set).

### Data flow

```
C++ → onMessage(msg) → deliverMessage(config, msg)
  → redacted = redactSensitiveHeaders(msg, config.redactHeaders ?? DEFAULT_REDACT_HEADERS)
  → emitCallback(config, redacted)
  → writeStdout(config, redacted)
  → postToUrl(config, redacted)
```

All three sinks receive the same redacted message; no need to redact in logger because we don’t log full messages.

### Implementation details

- **Cloning**  
  Shallow copy of `msg` and `msg.headers` is enough: `{ ...msg, headers: { ...msg.headers } }`. Then overwrite redacted keys in the new `headers` object.
- **Case-insensitivity**  
  Normalize header name to lower case for comparison: e.g. `Object.keys(headers).forEach(k => { if (headerNamesToRedact.map(h => h.toLowerCase()).includes(k.toLowerCase())) … })`.
- **C++**  
  No change: C++ continues to send full headers; redaction is a TS-only concern at the boundary to outputs.

---

## 3. terminationGracePeriodSeconds (injector)

### Current state

- [docs/specs/DEPLOYMENT_OPS.md](docs/specs/DEPLOYMENT_OPS.md) and [docs/deployment/DEPLOYMENT_GUIDE.md](docs/deployment/DEPLOYMENT_GUIDE.md) say: set the pod’s `terminationGracePeriodSeconds` (e.g. 30) so the sniffer can drain in-flight messages on SIGTERM.
- [injector/src/patch.ts](injector/src/patch.ts) `buildPatch()` only adds the sidecar container; it does **not** touch `spec.terminationGracePeriodSeconds`.

### Desired behavior

- When we inject the sniffer sidecar, the pod should have a termination grace period long enough for the sniffer to drain (e.g. 30 seconds). Options:
  1. **Patch only if missing**  
     If `pod.spec.terminationGracePeriodSeconds` is already set, leave it. If missing, add it (e.g. 30) via JSON patch.
  2. **Always set or raise**  
     Always set to at least 30 (or a configurable value); if the pod already has a larger value, we could leave it or set to max(existing, 30). Simpler for operators: they don’t have to remember to set it on the base pod.

### Where to implement

- **Injector patch**  
  In [injector/src/patch.ts](injector/src/patch.ts), `buildPatch()` returns an array of JSON Patch operations. Add one more operation:
  - If `pod.spec.terminationGracePeriodSeconds == null` (or undefined): add `{ op: 'add', path: '/spec/terminationGracePeriodSeconds', value: 30 }` (or a value from injector options).
  - If the spec already has a value, either skip or (if we want “at least 30”) use `replace` only when current value < 30. Recommendation: **only add when missing** to avoid overriding app-specific larger values.
- **Injector options**  
  In [injector/src/types.ts](injector/src/types.ts), add to `InjectorOptions` an optional field, e.g. `terminationGracePeriodSeconds?: number` (default 30). In `buildPatch()`, use this value when adding the field.
- **JSON Patch path**  
  Path is `/spec/terminationGracePeriodSeconds`. Order of operations: add container first, then add or replace grace period, so the patch array becomes e.g. `[{ op: 'add', path: '/spec/containers/-', value: container }, { op: 'add', path: '/spec/terminationGracePeriodSeconds', value: 30 }]` when needed.

### Edge cases

- **Pod has no spec**  
  Unlikely in practice; if `pod.spec` is missing, adding `/spec/terminationGracePeriodSeconds` might create `spec`. In Kubernetes, patch semantics typically allow this. If the injector only runs on Pod create, spec is usually present.
- **Existing value**  
  If we only “add when missing,” we never reduce an existing 60 to 30, which is safe.

---

## 4. Resource limits on the sidecar (injector)

### Current state

- [docs/specs/DEPLOYMENT_OPS.md](docs/specs/DEPLOYMENT_OPS.md) recommends memory/CPU (e.g. 256Mi/512Mi, 100m/500m) and says memory scales with connection count and maxBodySize.
- [injector/src/patch.ts](injector/src/patch.ts) `buildSnifferContainer()` does not set `resources` on the container.

### Desired behavior

- The injected sniffer container should have `resources.requests` and `resources.limits` so the scheduler and kubelet can reserve and cap CPU/memory. This avoids noisy-neighbour and OOM without operators having to patch every Deployment.

### Where to implement

- **Injector options**  
  In [injector/src/types.ts](injector/src/types.ts), add to `InjectorOptions` something like:
  - `resources?: { requests?: { memory?: string; cpu?: string }; limits?: { memory?: string; cpu?: string } }`
  - Or a flatter shape: `memoryRequest`, `memoryLimit`, `cpuRequest`, `cpuLimit` (all optional strings).
- **Default values**  
  In `DEFAULT_INJECTOR_OPTIONS`, set sensible defaults per DEPLOYMENT_OPS, e.g. `memory: 256Mi` request, `512Mi` limit; `cpu: 100m` request, `500m` limit.
- **buildSnifferContainer**  
  In [injector/src/patch.ts](injector/src/patch.ts), when building the container object, if `options.resources` (or the chosen shape) is present, set `container.resources = options.resources`. If not set, the container has no resources (current behaviour); when set (e.g. from defaults), the mutated pod will have the sidecar resource block.

### Data flow

```
MutatingWebhook receives Pod
  → buildPatch(pod, options)
  → buildSnifferContainer(pod, options)
       → container = { name, image, securityContext, env, resources?: options.resources }
  → patch adds container (and optionally terminationGracePeriodSeconds)
```

Operators can override by passing custom `InjectorOptions` when starting the webhook (e.g. from a config file or env).

---

## 5. OUTPUT_URL_AUTH_TOKEN from Secret (injector)

### Current state

- The sniffer reads `OUTPUT_URL_AUTH_TOKEN` from the process environment ([src/output.ts](src/output.ts)); the injector does not set it. The comment in [injector/src/patch.ts](injector/src/patch.ts) says it’s not set from annotation in MVP to avoid putting secrets in annotations.
- For production, the token should come from a Kubernetes Secret and be mounted as env via `valueFrom.secretKeyRef`.

### Desired behavior

- Allow the injector to add an env var `OUTPUT_URL_AUTH_TOKEN` whose value comes from a Secret (e.g. `secretName` + `secretKey`). So the **deployment** creates a Secret (e.g. `tcp-sniffer-output-auth`) with a key (e.g. `token`); the injector, when building env for the sniffer container, appends `{ name: 'OUTPUT_URL_AUTH_TOKEN', valueFrom: { secretKeyRef: { name: secretName, key: secretKey } } }` when configured.

### Where to implement

- **Injector options**  
  In [injector/src/types.ts](injector/src/types.ts), add to `InjectorOptions`:
  - `outputUrlAuthTokenSecret?: { name: string; key: string }`  
  If present, `buildEnv()` in [injector/src/patch.ts](injector/src/patch.ts) pushes the env entry with `valueFrom: { secretKeyRef: { name: options.outputUrlAuthTokenSecret.name, key: options.outputUrlAuthTokenSecret.key } }`. If absent, no `OUTPUT_URL_AUTH_TOKEN` is set (current behaviour).
- **Deployment guide**  
  Document that operators must create a Secret and configure the injector with that secret name/key (e.g. via injector’s config file or env that maps to `InjectorOptions`). The injector itself does not need to read the secret value; it only emits the patch that references the Secret.

### Data flow

```
Injector starts with options.outputUrlAuthTokenSecret = { name: 'tcp-sniffer-output-auth', key: 'token' }
  → buildEnv() adds { name: 'OUTPUT_URL_AUTH_TOKEN', valueFrom: { secretKeyRef: { name, key } } }
  → Mutated pod has sniffer container with that env
  → At runtime, Kubernetes injects the secret value into the container env
  → Sniffer entrypoint runs; process.env.OUTPUT_URL_AUTH_TOKEN is set
  → postToUrl() uses it as Bearer token
```

No code change in the sniffer library; only injector and deployment docs.

---

## 6. Integration tests (TS pipeline, contract, failure handling)

### Current state

- [docs/plans/PLAN_TESTING_VALIDATION.md](docs/plans/PLAN_TESTING_VALIDATION.md) calls for integration tests: C++→TS message shape, output pipeline (callback, stdout, outputUrl retries), failure handling (missing interface, invalid config).
- Repo has unit tests ([src/validation.test.ts](src/validation.test.ts), [src/sniffer.test.ts](src/sniffer.test.ts), [injector/src/handler.test.ts](injector/src/handler.test.ts)) but no integration tests that run the full TS pipeline or use a mock engine to assert message shape and output behaviour.

### Desired behaviour

- **Contract / message shape**  
  A test that feeds a known `HttpMessage` (fixture) into the output pipeline and asserts that:
  - Callback is invoked with the same object (or redacted copy).
  - Stdout receives one JSON line that parses to an object with required fields (`receiver`, `destination`, `direction`, `headers`, `timestamp`) and optional HTTP fields.
- **Output pipeline**  
  - Callback: invoke with fixture message; assert callback was called with correct shape; assert that if callback throws, error is logged and process does not throw (already in [src/output.ts](src/output.ts) try/catch).
  - Stdout: enable `outputStdout`, deliver message, capture `process.stdout.write` (or spawn process and read stdout), parse JSON, assert shape.
  - outputUrl: mock `fetch` (or use a small local HTTP server that records POST body); deliver message; assert POST body matches message shape and retries occur on 5xx (e.g. return 500 twice then 200; assert three requests).
- **Failure handling**  
  - Invalid config: call `validateConfig()` with invalid input (e.g. empty ports, invalid sampleRate); assert `ValidationError` and message.
  - Production HTTPS: with production env set, `validateConfig({ ports: [8080], outputUrl: 'http://example.com' })` throws with message about HTTPS.

### Where to implement

- New test files under `src/`, e.g.:
  - `src/output.integration.test.ts`: message shape, callback, stdout, and optionally outputUrl with mocked fetch or local server.
  - `src/validation.integration.test.ts` or extend `validation.test.ts`: production HTTPS check, invalid config.
- Use Node’s built-in test runner (`node --test`); mock by dependency injection or by replacing `fetch` / stdout in the test. Sniffer tests already use a mock engine ([src/engine-mock.ts](src/engine-mock.ts)); integration tests can use the same mock to emit fixture messages and assert `deliverMessage` and validation behaviour.

### Flow (example: output pipeline)

```
Test: create output config with onHttpMessage + outputStdout; capture stdout; call deliverMessage(fixture)
  → emitCallback runs, writeStdout runs
  → Assert callback called with fixture (or redacted copy)
  → Assert one line on stdout; JSON.parse(line) has receiver, destination, direction, headers, timestamp
```

---

## 7. E2E and shutdown tests

### Current state

- [docs/OVERVIEW.md](docs/OVERVIEW.md) verification: run HTTP server in a pod, generate traffic, validate reconstructed output; send SIGTERM and verify drain and exit within grace period.
- No automated E2E or shutdown tests in the repo.

### Desired behaviour

- **E2E (in-cluster or kind/minikube)**  
  - Deploy injector (with TLS) and a test namespace with inject label.
  - Deploy a Deployment that runs a simple HTTP server (e.g. echo server) and gets the sniffer sidecar.
  - Generate HTTP traffic to the service (e.g. curl from another pod or from the host).
  - Read sniffer output (e.g. logs or an output URL collector); assert that at least one reassembled HTTP request/response has expected method, path, status, and optionally body.
- **Shutdown**  
  - Start sniffer with mock or real engine that enqueues a few messages; call `stop()` (or send SIGTERM to the process); assert that all enqueued messages are delivered to the output(s) before the process exits, and that exit code is 0. This can be a Node test that starts the sniffer, triggers messages, then calls `stop()` and asserts on a captured callback or stdout buffer—no real cluster needed. A second variant: run the real entrypoint in a subprocess, send SIGTERM, read stdout/stderr and assert “stopping”/“stopped” and exit code 0.

### Where to implement

- **Shutdown (no cluster)**  
  - In `src/` or `tests/`: test that creates sniffer with engine-mock that pushes N messages, calls `stop()`, and asserts N messages were received by the callback (or written to a stream). Optionally: spawn `node dist/entrypoint.js` with env that makes the sniffer start then immediately receive SIGTERM; assert exit 0 and log line.
- **E2E (cluster)**  
  - A separate dir, e.g. `e2e/` or `tests/e2e/`, with a script or Make target that: applies manifests (namespace, injector, certificate, test Deployment), waits for pods ready, runs traffic, scrapes logs or collector, runs assertions, then cleans up. Can be shell + kubectl or a small Node script. Document in [docs/deployment/DEPLOYMENT_GUIDE.md](docs/deployment/DEPLOYMENT_GUIDE.md) or a new `docs/testing/E2E.md` that E2E requires a cluster and how to run it.

---

## 8. Webhook patch shape tests

### Current state

- [injector/src/handler.test.ts](injector/src/handler.test.ts) tests handler behaviour (e.g. eligibility, patch presence). The exact **shape** of the patch (containers[].env, securityContext, resources, terminationGracePeriodSeconds) is not fully asserted.

### Desired behaviour

- Tests that decode the base64 patch from the AdmissionReview response and assert:
  - One new container with name from options, image, `securityContext.capabilities.add: ['NET_RAW']`, env containing PORTS, INTERFACE, OUTPUT_URL, POD_NAME, NAMESPACE, NODE_NAME (and optionally OUTPUT_URL_AUTH_TOKEN when secret is configured).
  - If we add terminationGracePeriodSeconds: patch contains an operation that sets it to the expected value.
  - If we add resources: container has `resources.requests` and `resources.limits` as configured.
- This catches regressions when someone changes `buildPatch()` or `buildSnifferContainer()`.

### Where to implement

- Extend [injector/src/handler.test.ts](injector/src/handler.test.ts) (or add `injector/src/patch.test.ts`): build a minimal Pod, call `buildPatch(pod, options)`, decode and apply the patch (or just parse the JSON patch ops), then assert on the resulting `spec.containers` and `spec.terminationGracePeriodSeconds`. Use multiple test cases: default options, with outputUrl annotation, with terminationGracePeriodSeconds, with resources, with outputUrlAuthTokenSecret.

---

## 9. Capture stats / drop counts (C++ and logs)

### Current state

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/specs/CPP_ENGINE.md](docs/specs/CPP_ENGINE.md) say: when libpcap exposes drop counts, log or report capture stats (e.g. received/dropped) periodically or on stop.
- Implementation is in the C++ engine ([native/](native/)); the TS layer does not currently request or log these stats unless the C++ addon already exposes them.

### Desired behaviour

- On stop (and optionally periodically), the C++ engine provides a small stats object (e.g. `packets_received`, `packets_dropped` if available from libpcap). The TS layer logs this at stop (and optionally at interval) so operators can see capture health.

### Where to implement

- **C++**  
  In the capture engine (e.g. [native/capture.cpp](native/capture.cpp) or [native/addon.cpp](native/addon.cpp)): when stopping, call `pcap_stats()` if available, and expose the numbers (e.g. `ps_recv`, `ps_drop`) to TS via the existing N-API boundary (e.g. include in the return value of `stop()` or call an optional “stats” callback once).
- **TS**  
  In [src/sniffer.ts](src/sniffer.ts), when `engine.stop()` resolves, if the engine returns (or previously reported) stats, call `logInfo('Capture stats', { packetsReceived, packetsDropped })` or similar. No new public API required; internal logging only.

### Data flow

```
engine.stop() called
  → C++ drains, closes pcap, calls pcap_stats(), returns (or sends) { packetsReceived, packetsDropped }
  → TS receives result, logInfo('Capture stats', stats)
  → Operators see structured log line in pod logs
```

---

## 10. Distinct exit codes (entrypoint)

### Current state

- [docs/OVERVIEW.md](docs/OVERVIEW.md) suggests: on fatal exit, use a distinct exit code so orchestrator logs are clear.
- [src/entrypoint.ts](src/entrypoint.ts) uses `process.exitCode = 1` for validation failure and start failure; `process.exit(1)` on stop error or entrypoint failure; `process.exit(0)` on graceful shutdown after SIGTERM/SIGINT.

### Desired behaviour

- Use two exit codes so that automation can distinguish “invalid config / bad env” from “capture failed at runtime” (e.g. libpcap open failed). For example:
  - `0`: success (including graceful stop).
  - `1`: configuration / validation error (invalid ports, missing output, non-HTTPS outputUrl in production).
  - `2`: runtime fatal error (start failed, capture open failed, or error during stop).
- The C++ engine already reports fatal errors; the TS layer in [src/sniffer.ts](src/sniffer.ts) calls `process.exit(1)` on engine fatal error. We can change that to `process.exit(2)` and in the entrypoint use `1` for validation and `2` for start/stop failure (or keep engine exit as 2 and have entrypoint use 1 for validation only).

### Where to implement

- **Constants**  
  Define exit code constants (e.g. in [src/constants.ts](src/constants.ts) or entrypoint): `EXIT_CONFIG = 1`, `EXIT_RUNTIME = 2`.
- **Entrypoint**  
  On `ValidationError` from `validateConfig`: set `process.exitCode = EXIT_CONFIG` (1). On `sniffer.start()` throw: set `process.exitCode = EXIT_RUNTIME` (2). On shutdown error in `stop()`: `process.exit(EXIT_RUNTIME)`. On uncaught in main: `process.exit(EXIT_RUNTIME)`.
- **Sniffer**  
  In [src/sniffer.ts](src/sniffer.ts), in the engine `onError` callback where we call `process.exit(1)`, use `process.exit(EXIT_RUNTIME)` (2) instead. Document the exit codes in [docs/specs/DEPLOYMENT_OPS.md](docs/specs/DEPLOYMENT_OPS.md) or deployment guide so operators can alert on exit code 2 (runtime) vs 1 (config).

---

## 11. Root README and production checklist

### Current state

- No root [README.md](README.md) in the repo; [injector/README.md](injector/README.md) and [docs/plans/README.md](docs/plans/README.md) exist.
- No single “production checklist” document that ties together TLS, failure policy, outputUrl HTTPS, resources, grace period, and auth token.

### Desired behaviour

- **Root README**  
  Short overview: what TCP Sniffer is (capture-only, sidecar, webhook-injected), link to [docs/OVERVIEW.md](docs/OVERVIEW.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), how to build (npm install, build:native, build), how to run tests, and pointer to [docs/deployment/DEPLOYMENT_GUIDE.md](docs/deployment/DEPLOYMENT_GUIDE.md). Optionally: table of contents for docs/.
- **Production checklist**  
  A short doc (e.g. [docs/deployment/PRODUCTION_CHECKLIST.md](docs/deployment/PRODUCTION_CHECKLIST.md) or a section in the deployment guide) that lists: webhook TLS (HTTPS + caBundle), failure policy (Fail vs Ignore), outputUrl must be HTTPS and how (env + validation), sidecar resource limits and terminationGracePeriodSeconds, OUTPUT_URL_AUTH_TOKEN from Secret, and where to find verification steps (deployment guide + OVERVIEW verification).

### Where to implement

- Add [README.md](README.md) at repo root with the content above.
- Add [docs/deployment/PRODUCTION_CHECKLIST.md](docs/deployment/PRODUCTION_CHECKLIST.md) (or a subsection in DEPLOYMENT_GUIDE) with bullet items and references to the relevant specs and guides.

---

## 12. LICENSE file

### Current state

- [README.md](README.md) states "License: MIT" but there is **no LICENSE file** at the repo root. npm and GitHub expect a root LICENSE file for legal clarity when distributing as a public library.

### Desired behaviour

- A single **LICENSE** file at the repo root containing the MIT license text. This allows consumers and automated tools to confirm the project's license without ambiguity.

### Where to implement

- Add **LICENSE** at the repo root with the standard MIT license text. Use a placeholder year and copyright holder (e.g. "Copyright (c) 2025") or the actual rightsholder; ensure the text matches the license declared in package.json (`"license": "MIT"`).

---

## 13. CHANGELOG

### Current state

- No CHANGELOG or version-history document exists. Public libraries typically document what changed in each release for consumers and to signal breaking changes.

### Desired behaviour

- A **CHANGELOG.md** at the repo root (or linked from README) that lists notable changes per version, following a consistent format (e.g. [Keep a Changelog](https://keepachangelog.com/)). Include at least: version number, date (or "Unreleased"), and sections such as Added, Changed, Fixed, Removed, Security. For the initial release, a single entry (e.g. 0.1.0) with initial features is sufficient; update on each release.

### Where to implement

- Create **CHANGELOG.md** at the repo root. Optionally reference it from README ("See [CHANGELOG](CHANGELOG.md) for version history.").

---

## 14. CONTRIBUTING

### Current state

- No CONTRIBUTING guide. Contributors lack a single place for how to set up the repo, run tests, submit changes, or follow code/style expectations.

### Desired behaviour

- A **CONTRIBUTING.md** at the repo root that covers: how to get the repo and install dependencies, how to build (including native addon requirements for Linux), how to run tests, and how to submit changes (e.g. PRs, branch naming). Optionally: code style (e.g. existing TS/format rules), scope of the project (what contributions are in scope). Keep it concise so it is actually read.

### Where to implement

- Create **CONTRIBUTING.md** at the repo root. Link to it from README (e.g. "Contributing: see [CONTRIBUTING.md](CONTRIBUTING.md).") and optionally from GitHub repo description or PR template.

---

## 15. SECURITY policy

### Current state

- No SECURITY.md or documented process for reporting vulnerabilities. The project handles network traffic and optional credentials (e.g. OUTPUT_URL_AUTH_TOKEN); a clear reporting path is expected for public libraries.

### Desired behaviour

- A **SECURITY.md** at the repo root that explains how to report security vulnerabilities (e.g. private disclosure via email or GitHub Security Advisories, rather than public issues). Optionally: supported versions, expected response timeline. GitHub supports [SECURITY.md](https://docs.github.com/en/code-security/security-advisories/adding-a-security-policy-to-your-repository) and can surface it on the repo.

### Where to implement

- Create **SECURITY.md** at the repo root with a short "Reporting a vulnerability" section and contact or process (e.g. "Open a GitHub Security Advisory" or "Email X with subject line containing SECURITY"). Link from README if desired.

---

## 16. README: quick-start example, library vs sidecar, native addon

### Current state

- README describes what the project is, build, test, and run (container entrypoint), and links to docs. It does **not** include: (1) a minimal **code example** for using the library programmatically (createSniffer, start, stop, onHttpMessage), (2) a clear split between **"Use as a library"** vs **"Deploy as a Kubernetes sidecar"**, or (3) an **Installation / native addon** note (e.g. Linux only, node-gyp and libpcap required, or prebuild expectations).

### Desired behaviour

- **Quick-start / usage example:** Add a short "Usage" or "Quick start" section in README with a copy-paste example: `npm install tcp-sniffer`, then a few lines that call `createSniffer(config)`, `sniffer.start()`, and use `onHttpMessage` (and optionally `sniffer.stop()`). This makes it obvious the package can be used as a normal Node/TS library.
- **Library vs sidecar:** Structure README so two consumption modes are explicit: (a) **As a library** — install the package and use the API in your process (e.g. capture on a given interface/ports, handle messages in code); (b) **As a Kubernetes sidecar** — deploy via the mutating webhook and container image (link to Deployment Guide). A short intro or table at the top can distinguish these.
- **Native addon / installation:** Add an "Installation" or "Building the native addon" subsection that states: the sniffer requires the C++ addon on Linux (libpcap, node-gyp); without `build:native` the mock engine is used (tests, non-Linux). If prebuild or binary distribution is not provided, say so so users know they must build the addon on a Linux environment for real capture.

### Where to implement

- Edit **README.md**: add "Usage" or "Quick start" with a minimal example; add or restructure sections for "As a library" and "As a Kubernetes sidecar"; add "Installation" or "Building" with native addon and platform expectations. Ensure the doc table of contents (if any) is updated.

---

## 17. API reference

### Current state

- The public API is defined in [src/index.ts](src/index.ts) and types; [docs/specs/TS_API_AND_LIFECYCLE.md](docs/specs/TS_API_AND_LIFECYCLE.md) and OVERVIEW describe behaviour. There is no generated **API reference** (e.g. TypeDoc) for the public surface, so consumers must read source or specs to discover options and types.

### Desired behaviour

- Provide an **API reference** for the public library surface: `createSniffer`, `Sniffer` (start, stop, isRunning), config and message types (e.g. SnifferConfig, HttpMessage). Options: (1) Generate from JSDoc/TS with TypeDoc (or similar) and publish the output (e.g. in docs/api/ or GitHub Pages), or (2) Document in a single markdown file that lists exports and main types with short descriptions. Link from README so "API reference" is easy to find.

### Where to implement

- **Option A:** Add TypeDoc (or similar) as a dev dependency, configure it to emit from `src/index.ts` (and relevant types), add a script (e.g. `npm run docs`) and optionally a CI step to build docs. Output to e.g. `docs/api/` or `gh-pages`. Add "API reference" link in README.
- **Option B:** Add a hand-maintained **docs/API.md** (or similar) that lists the public API and main types with one-line descriptions and links to specs. Link from README.

---

## 18. package.json: repository, files, npm publish

### Current state

- [package.json](package.json) has `name`, `version`, `license`, `main`, `types`, and scripts. It does **not** include: **repository** (and optionally **homepage**, **bugs**), or **files** (whitelist of what to publish). For publishing to npm as a public library, repository and files are standard; without **files**, npm publishes everything not in .npmignore, which can accidentally include native build artifacts or unnecessary paths.

### Desired behaviour

- **repository:** Add the `repository` field (e.g. `"repository": { "type": "git", "url": "https://github.com/<org>/<repo>.git" }`). Optionally add **homepage** and **bugs** (e.g. issues URL) so npm and GitHub link correctly.
- **files:** Add a **files** array listing what to include in the published package (e.g. `"dist"`, `"README.md`, or `["dist", "README.md", "LICENSE"]`). Exclude source, tests, native source, and dev-only files so the tarball is small and correct. If the native addon is built at install time (node-gyp), ensure **files** does not ship prebuilt binaries unless intended; if you later add prebuild, adjust **files** accordingly.
- **npm publish:** Document briefly (e.g. in CONTRIBUTING or a separate "Publishing" section) that releases are done via `npm publish` (or similar), and that the native addon is Linux-only so consumers on other platforms get the mock engine unless they build themselves. No code change required beyond **files** and **repository** if the current build already produces a publishable dist/.

### Where to implement

- Edit **package.json**: add `repository` (and optionally `homepage`, `bugs`); add `files` with the list of publishable paths. Update CONTRIBUTING or a release doc with a short "Publishing" note if desired.

---

## 19. Versioning and compatibility policy

### Current state

- [package.json](package.json) specifies `"engines": { "node": ">=18" }`. There is no written **versioning policy** (e.g. semver) or **compatibility** statement (what is considered stable public API, what may change in minor vs major, Node and platform support) for consumers.

### Desired behaviour

- Document **versioning and compatibility** in one place (e.g. README section or [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)): (1) This project follows **semantic versioning** (major.minor.patch); breaking changes to the documented public API (createSniffer, Sniffer, config/message types) require a major bump. (2) **Node:** Supported versions (e.g. Node 18+ as in engines). (3) **Platform:** Sniffer with real capture is Linux only; other platforms use the mock engine. (4) Optionally: injector and container image versioning (e.g. same repo, same version tag). Keep it short so operators and library users know what to expect.

### Where to implement

- Add a short "Versioning" or "Compatibility" subsection in **README**, or create **docs/COMPATIBILITY.md** and link from README and CHANGELOG. Reference it from CONTRIBUTING if contributors need to know how to bump versions.

---

## Summary table

| Gap | Primary location | Behaviour in one line |
|-----|------------------|------------------------|
| outputUrl HTTPS | [src/validation.ts](src/validation.ts) | In production, if outputUrl set, require `new URL(url).protocol === 'https:'` or throw ValidationError. |
| Header redaction | [src/output.ts](src/output.ts), [src/types.ts](src/types.ts) | Before deliverMessage, clone msg and redact configured header names (default Authorization, Cookie); all sinks get redacted copy. |
| terminationGracePeriodSeconds | [injector/src/patch.ts](injector/src/patch.ts), [injector/src/types.ts](injector/src/types.ts) | If pod.spec.terminationGracePeriodSeconds missing, add patch op with default (e.g. 30). |
| Resource limits | [injector/src/patch.ts](injector/src/patch.ts), [injector/src/types.ts](injector/src/types.ts) | Add options.resources to InjectorOptions; buildSnifferContainer sets container.resources when present. |
| OUTPUT_URL_AUTH_TOKEN from Secret | [injector/src/patch.ts](injector/src/patch.ts), [injector/src/types.ts](injector/src/types.ts) | InjectorOptions.outputUrlAuthTokenSecret → buildEnv adds valueFrom.secretKeyRef for OUTPUT_URL_AUTH_TOKEN. |
| Integration tests | New under [src/](src/) | Tests for message shape, callback/stdout/outputUrl delivery, validation (including production HTTPS). |
| E2E / shutdown tests | [src/](src/) or [e2e/](e2e/) | Shutdown: test drain on stop(); E2E: optional cluster test with real traffic and log assertion. |
| Webhook patch shape | [injector/src/handler.test.ts](injector/src/handler.test.ts) or patch.test.ts | Assert decoded patch has container with env, NET_RAW, optional resources and terminationGracePeriodSeconds. |
| Capture stats | [native/](native/) + [src/sniffer.ts](src/sniffer.ts) | C++ exposes pcap_stats on stop; TS logs stats in stop() path. |
| Exit codes | [src/entrypoint.ts](src/entrypoint.ts), [src/sniffer.ts](src/sniffer.ts), constants | 1 = config error, 2 = runtime/start/stop error; document in deployment. |
| README + checklist | Root [README.md](README.md), [docs/deployment/](docs/deployment/) | README: what, build, test, links. Checklist: TLS, failure policy, HTTPS, resources, grace period, auth token. |
| LICENSE file | Root **LICENSE** | MIT license text at repo root; matches package.json "license": "MIT". |
| CHANGELOG | Root **CHANGELOG.md** | Version history (e.g. Keep a Changelog format); update on each release. |
| CONTRIBUTING | Root **CONTRIBUTING.md** | How to build, test, and submit changes; link from README. |
| SECURITY policy | Root **SECURITY.md** | How to report vulnerabilities; private disclosure process. |
| README quick-start & consumption | [README.md](README.md) | Usage example (createSniffer, start, onHttpMessage); "As a library" vs "As a sidecar"; Installation/native addon note. |
| API reference | [docs/api/](docs/api/) or **docs/API.md**, README | TypeDoc or hand-maintained API doc; link from README. |
| package.json repository & files | [package.json](package.json) | Add repository (and optionally homepage, bugs); add files array for npm publish. |
| Versioning and compatibility | README or **docs/COMPATIBILITY.md** | Semver, Node versions, Linux-only for real capture; link from README. |

This document is the single place that describes the **actual implementation** and **how it will work** for each production-ready gap.
