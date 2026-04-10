# Test Suite Layout

This repository uses Node's built-in test runner (`node --test`) with TypeScript compiled to `dist/`.

## Folders

- `tests/unit/` - fast, isolated tests for validation and output helpers.
- `tests/integration/` - higher-level tests for sniffer lifecycle and output pipeline behavior.
- `tests/e2e/` - optional end-to-end scaffolding and smoke checks.

## Commands (root package)

- `npm run test:unit` - compile + run unit tests.
- `npm run test:integration` - compile + run integration tests.
- `npm run test:e2e` - compile + run e2e tests (optional/manual-safe).
- `npm run test:ts` - compile + run all tests under `tests/`.
- `npm test` - run already-compiled tests under `dist/tests/`.

## Native addon note

Real packet capture requires Linux build prerequisites (e.g. `libpcap-dev` and build tools).
If the addon is not available, tests still run using the mock engine for library behavior.
