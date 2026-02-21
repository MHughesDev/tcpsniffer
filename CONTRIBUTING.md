# Contributing to TCP Sniffer

Thanks for your interest in contributing. This document explains how to get set up, run tests, and submit changes.

## Getting started

1. **Clone the repo** and install dependencies from the repo root:

   ```bash
   git clone <repository-url>
   cd tcpsniffer
   npm install
   ```

2. **Build**

   - TypeScript: `npm run build`
   - C++ addon (Linux only, requires node-gyp and libpcap): `npm run build:native`

   Without the native addon, the sniffer uses a mock engine (fine for TS-only work and tests). For real packet capture you need a Linux environment with libpcap and the addon built.

3. **Run tests**

   ```bash
   npm run test:ts    # Compile and run all tests
   npm run test       # Run tests (assumes already built)
   ```

   Tests cover the main library (validation, sniffer lifecycle, output pipeline), the injector (webhook handler, patch shape), and integration cases (message shape, callback/stdout/outputUrl, production HTTPS). Optional E2E against a cluster is described in [docs/testing/E2E.md](docs/testing/E2E.md).

## Submitting changes

1. Open an issue or discuss in an existing one so the change is aligned with the project.
2. Create a branch, make your changes, and ensure tests pass (`npm run test:ts`).
3. Submit a pull request with a clear description of what changed and why. Reference any related issues.

Code should follow the existing style (TypeScript, existing formatting). The project uses Node’s built-in test runner; keep tests in the same style as the current `*.test.ts` files.

## Scope

- **In scope:** Bug fixes, docs improvements, tests, and features that match the [Overview](docs/OVERVIEW.md) and [Architecture](docs/ARCHITECTURE.md) (capture-only, webhook-only deployment, TS API + C++ engine).
- **Out of scope:** Proxy mode, binding the target port, non-Kubernetes deployment, or protocol parsing beyond HTTP as described in the docs.

## Injector

The mutating webhook lives in `injector/`. To work on it:

```bash
cd injector
npm install
npm run build
npm run test:ts
```

See [injector/README.md](injector/README.md) for behavior and deployment notes.
