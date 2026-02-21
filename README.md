# TCP Sniffer

A **capture-only** TCP/HTTP sniffer that uses libpcap to observe traffic (no proxy, no port binding), reassembles TCP streams, parses HTTP, and outputs structured messages to a callback, stdout, and/or a POST URL.

## Two ways to use it

| Mode | Description |
|------|-------------|
| **As a library** | Install the package and use the API in your Node/TS process: `createSniffer(config)`, `start()`, `stop()`, and `onHttpMessage` (or outputUrl/stdout). You run the sniffer in your own process. |
| **As a Kubernetes sidecar** | Deploy via a **mutating admission webhook** that injects the sniffer container into pods at admission time (opt-in by label). The sniffer runs as a sidecar next to your workload. See [Deployment Guide](docs/deployment/DEPLOYMENT_GUIDE.md). |

Both modes use the same TypeScript library and C++ engine; the sidecar mode adds the injector and container image.

## Quick start (library)

```bash
npm install tcp-sniffer
```

```ts
import { createSniffer } from 'tcp-sniffer';

const sniffer = createSniffer({
  ports: [8080, 8443],
  onHttpMessage: (msg) => console.log(msg.method, msg.path, msg.statusCode),
  // optional: outputStdout: true, outputUrl: 'https://...',
});

await sniffer.start();
// ... later:
await sniffer.stop();
```

**Note:** Real packet capture requires the **C++ addon** on **Linux** (see [Installation](#installation)). Without it, the library uses a mock engine (useful for tests and non-Linux dev).

## Installation

- **TypeScript/Node:** `npm install tcp-sniffer` and `npm run build` (or use the built `dist/` from the repo).
- **Native addon (for real capture):** The sniffer uses a C++ N-API addon that depends on **libpcap**. Build it on a **Linux** host with node-gyp and libpcap installed (e.g. `libpcap-dev`). From the repo root: `npm run build:native`. Without this step, the sniffer uses a mock engine and will not capture real traffic. There is no prebuilt binary distribution; consumers on Linux must build the addon (or use the container image for sidecar deployment).

## What it is

- **TypeScript library** with a **C++ engine** (N-API addon) for packet capture, TCP reassembly, and HTTP parsing.
- **Deployment (sidecar):** Only via a **mutating webhook** that adds the sniffer container to pods at admission time (opt-in by label).
- **Output:** Callback, JSON lines to stdout, and/or HTTP POST to a URL (with optional Bearer token and retries).
- **Docs:** [Overview](docs/OVERVIEW.md), [Architecture](docs/ARCHITECTURE.md), [API reference](docs/API.md), [Deployment Guide](docs/deployment/DEPLOYMENT_GUIDE.md), [Production Checklist](docs/deployment/PRODUCTION_CHECKLIST.md).

## Build

From the repo root:

```bash
npm install
npm run build:native   # C++ addon (Linux only; requires node-gyp and libpcap)
npm run build          # TypeScript
```

Without `build:native`, the sniffer falls back to a mock engine (useful for tests and non-Linux dev).

## Test

```bash
npm run test:ts        # Compile and run all tests
npm run test           # Run tests (assumes already built)
```

Tests include unit tests (validation, sniffer lifecycle, output pipeline, injector webhook patch shape), integration tests (message shape, callback/stdout/outputUrl, validation including production HTTPS), and shutdown tests (drain on stop, entrypoint SIGTERM exit 0). Optional E2E against a real cluster is described in [docs/testing/E2E.md](docs/testing/E2E.md).

## Run (container entrypoint)

```bash
npm run start          # Runs node dist/entrypoint.js (reads PORTS, INTERFACE, OUTPUT_URL, etc. from env)
```

For deployment, build the container image and configure the injector and cluster as in [Deployment Guide](docs/deployment/DEPLOYMENT_GUIDE.md).

## Links

| Doc | Description |
|-----|-------------|
| [docs/OVERVIEW.md](docs/OVERVIEW.md) | What it does, key concepts, data flow, verification |
| [docs/API.md](docs/API.md) | Public API reference (createSniffer, Sniffer, config, HttpMessage) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, TS ↔ C++, injector contract |
| [docs/deployment/DEPLOYMENT_GUIDE.md](docs/deployment/DEPLOYMENT_GUIDE.md) | Webhook TLS, failure policy, auth token, verification |
| [docs/deployment/PRODUCTION_CHECKLIST.md](docs/deployment/PRODUCTION_CHECKLIST.md) | Production checklist (TLS, HTTPS, resources, grace period, auth) |
| [docs/testing/E2E.md](docs/testing/E2E.md) | Optional E2E testing with a cluster |
| [docs/specs/DEPLOYMENT_OPS.md](docs/specs/DEPLOYMENT_OPS.md) | Container, env, exit codes, resource sizing |

## Versioning and compatibility

- This project uses [semantic versioning](https://semver.org/). Breaking changes to the documented public API (e.g. `createSniffer`, `Sniffer`, config and message types) will result in a major version bump.
- **Node:** Supported versions are Node 18+ (see `engines` in package.json).
- **Platform:** Real packet capture requires the C++ addon on **Linux**. On other platforms the library runs with a mock engine (no capture).

## Contributing and security

- **Contributing:** See [CONTRIBUTING.md](CONTRIBUTING.md) for how to build, test, and submit changes.
- **Changelog:** See [CHANGELOG.md](CHANGELOG.md) for version history.
- **Security:** To report a vulnerability, see [SECURITY.md](SECURITY.md). Please do not report security issues in public GitHub issues.

## License

MIT — see [LICENSE](LICENSE).
