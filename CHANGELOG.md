# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2025-02-21

### Added

- TypeScript library with public API: `createSniffer(config)`, `sniffer.start()`, `sniffer.stop()`, `sniffer.isRunning()`.
- C++ engine (N-API addon) for packet capture (libpcap), TCP reassembly, and HTTP/1.x parsing.
- Output to callback (`onHttpMessage`), JSON lines to stdout, and/or HTTP POST to `outputUrl` (with retries and optional Bearer token).
- Config validation and production HTTPS enforcement for `outputUrl` when `NODE_ENV=production` or `TCP_SNIFFER_PRODUCTION=1`.
- Optional header redaction (default: Authorization, Cookie) for all outputs.
- Mutating admission webhook (injector) for Kubernetes: injects sniffer sidecar by label; adds NET_RAW, env, resources, terminationGracePeriodSeconds, and optional OUTPUT_URL_AUTH_TOKEN from Secret.
- Distinct exit codes: 0 success, 1 config/validation error, 2 runtime error.
- Capture stats (packets received/dropped) logged on stop when available from libpcap.
- Unit and integration tests; optional E2E documented in docs/testing/E2E.md.
- Documentation: Overview, Architecture, Deployment Guide, Production Checklist, specs (TS API, C++ engine, Injector, Deployment Ops).

[Unreleased]: https://github.com/your-org/tcpsniffer/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/your-org/tcpsniffer/releases/tag/v0.1.0
