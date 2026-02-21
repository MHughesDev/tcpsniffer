# TCP Sniffer — E2E Testing

This document describes optional end-to-end tests that run against a real Kubernetes cluster (e.g. kind, minikube, or any cluster where the injector and sniffer can be deployed).

## Prerequisites

- Kubernetes cluster with `kubectl` configured
- Injector built and deployable (with TLS; see [Deployment Guide](../deployment/DEPLOYMENT_GUIDE.md))
- Sniffer container image built and pushed (or loaded into kind/minikube)

## What E2E Covers

1. **Webhook injection** — Deploy injector with TLS and failure policy; create a namespace with inject label; create a Pod; verify the Pod is mutated (sniffer sidecar present, env, NET_RAW, resources, terminationGracePeriodSeconds).
2. **Traffic and logs** — Deploy a simple HTTP server (e.g. echo) that gets the sniffer sidecar; generate HTTP traffic (e.g. `curl` from another pod or host); read sniffer logs or an output URL collector; assert that at least one reassembled HTTP request/response has expected method, path, or status.
3. **Shutdown** — Delete the test Pod; confirm the sniffer container receives SIGTERM and exits with code 0 within the pod’s `terminationGracePeriodSeconds` (e.g. log line “Stopping sniffer” / “Sniffer stopped” before the container disappears).

## How to Run (manual or scripted)

No automated E2E script is required for MVP. You can:

1. Follow [Deployment Guide §5 Verification steps](../deployment/DEPLOYMENT_GUIDE.md#5-verification-steps) to manually verify injection, logs, and shutdown.
2. Optionally add an `e2e/` directory with a shell script or small Node script that:
   - Applies manifests (namespace, injector, Certificate, test Deployment),
   - Waits for pods ready,
   - Runs traffic (e.g. `kubectl run curl --rm -it --image=curlimages/curl -- curl -s http://<svc>:8080/`),
   - Scrapes sniffer logs or collector,
   - Asserts expected log lines or message shape,
   - Cleans up.

Document the script in this file and in the root README once added.

## Shutdown tests (no cluster)

Shutdown behaviour is covered by unit tests that do not require a cluster:

- **Drain on stop:** `src/sniffer.test.ts` — “stop() allows in-flight messages to be delivered before resolving”.
- **SIGTERM exit code:** `src/sniffer.test.ts` — “entrypoint exits 0 on SIGTERM (graceful shutdown)” (spawns entrypoint, sends SIGTERM, asserts exit 0).

Run with: `npm run test` or `npm run test:ts`.
