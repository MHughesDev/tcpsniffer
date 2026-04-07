# E2E Tests (Optional)

These tests are intended for a real Kubernetes environment and are **optional** in local development.

## What to verify

1. Injector mutates labeled pods with the sniffer sidecar.
2. Sniffer emits HTTP capture messages when traffic is generated.
3. Graceful shutdown on pod deletion (SIGTERM, exit code 0).

## Suggested execution flow

1. Deploy injector with TLS and webhook configuration.
2. Deploy a labeled test workload (e.g., echo server).
3. Generate HTTP traffic to the workload.
4. Assert logs or output collector receives expected message shape.
5. Delete workload and verify graceful shutdown logs.

For detailed steps, see `docs/testing/E2E.md`.
