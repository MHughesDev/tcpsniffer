# TCP Sniffer — Deployment Guide

This guide covers deploying the mutating webhook (injector) and the sniffer container image in Kubernetes. It assumes the injector (Stream C) and container image (Stream D) are built and available.

## Prerequisites

- Kubernetes cluster (1.20+)
- `kubectl` configured for the cluster
- Container registry access to push/pull the sniffer image
- (For TLS) cert-manager or another mechanism to provision TLS certificates for the webhook

## 1. Sniffer container image

### Build and push

From the repo root:

```bash
docker build -t <your-registry>/tcp-sniffer:0.1.0 .
docker push <your-registry>/tcp-sniffer:0.1.0
```

### Run locally (optional)

To verify the image starts and logs:

```bash
docker run --rm -e PORTS=8080,8443 <your-registry>/tcp-sniffer:0.1.0
```

You should see JSON log lines with `Sniffer entrypoint starting`, `interface`, and `ports`. Send SIGTERM to stop gracefully.

## 2. Webhook TLS (cert-manager)

The mutating webhook must be served over HTTPS. Two common approaches:

### Option A: cert-manager with a Certificate resource

1. Install cert-manager if not already present:

   ```bash
   kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml
   ```

2. Create an `Issuer` or `ClusterIssuer` (e.g. `ClusterIssuer` for Let’s Encrypt or a CA).

3. Create a `Certificate` for the webhook service (e.g. in the same namespace as the webhook):

   ```yaml
   apiVersion: cert-manager.io/v1
   kind: Certificate
   metadata:
     name: tcp-sniffer-webhook-tls
     namespace: tcp-sniffer
   spec:
     secretName: tcp-sniffer-webhook-tls
     issuerRef:
       name: your-issuer
       kind: ClusterIssuer
     dnsNames:
       - tcp-sniffer-webhook.tcp-sniffer.svc
       - tcp-sniffer-webhook.tcp-sniffer.svc.cluster.local
   ```

4. Mount the secret `tcp-sniffer-webhook-tls` into the webhook pod and configure the HTTPS server to use it.

### Option B: Internal CA and self-signed cert

For development or internal clusters, generate a cert for the webhook service DNS name and create a Secret; document the CA or cert so cluster admins can configure the `MutatingWebhookConfiguration` `caBundle` accordingly.

## 3. Failure policy

The `MutatingWebhookConfiguration` includes a `failurePolicy`:

- **Fail closed (`Fail`):** If the webhook is unreachable or errors, the API server rejects the admission request (e.g. Pod create fails). Use when injection must not be skipped.
- **Fail open (`Ignore`):** If the webhook is unreachable or errors, the API server allows the request without mutation. Pods are created but without the sniffer sidecar.

Choose based on risk: fail closed for strict “inject when eligible” behavior; fail open to avoid blocking pod creation when the webhook is down.

Example:

```yaml
failurePolicy: Fail   # or Ignore
```

## 4. OUTPUT_URL_AUTH_TOKEN from Secret (production)

When the sniffer posts to `OUTPUT_URL`, it can send a Bearer token from the `OUTPUT_URL_AUTH_TOKEN` environment variable. In production, provide the token via a Kubernetes Secret so it is not stored in annotations or config.

1. **Create a Secret** in the same namespace as the pods that will run the sniffer (or a namespace the injector can reference):

   ```bash
   kubectl create secret generic tcp-sniffer-output-auth --from-literal=token='YOUR_AUTH_TOKEN'
   ```

2. **Configure the injector** with `outputUrlAuthTokenSecret: { name: 'tcp-sniffer-output-auth', key: 'token' }` when starting the webhook (e.g. via the injector’s config file or env that maps to `InjectorOptions`). The injector does not read the secret value; it only emits a patch that references the Secret. At runtime, Kubernetes injects the secret into the sniffer container’s env.

3. The sniffer reads `process.env.OUTPUT_URL_AUTH_TOKEN` and uses it as the Bearer token when POSTing to `outputUrl`. See `docs/specs/DEPLOYMENT_OPS.md` for env details.

## 5. Verification steps

### 5.1 Webhook and injection

1. Deploy the injector and ensure the webhook endpoint is HTTPS and the `MutatingWebhookConfiguration` points to it with the correct `caBundle`.
2. Create a namespace (or use an existing one) and add the injector’s opt-in label (e.g. `tcp-sniffer/inject: "true"`). Exact label is defined by the injector implementation.
3. Create a test Pod in that namespace (e.g. a simple `nginx` or `sleep` pod).
4. Verify the Pod was mutated:
   - `kubectl get pod <name> -o jsonpath='{.spec.containers[*].name}'` — should include the sniffer sidecar name.
   - `kubectl get pod <name> -o yaml` — inspect `spec.containers` for the sniffer container with env (`PORTS`, `INTERFACE`, etc.), `securityContext.capabilities.add: ["NET_RAW"]`, and image.

### 5.2 Sniffer container startup and logs

1. After injection, check that the sniffer container starts:
   - `kubectl logs <pod> -c <sniffer-container-name>`
2. Expect structured (JSON) logs including placement (pod/namespace/node when downward API is set), interface, and ports.
3. If `PORTS` is missing or invalid, the entrypoint should log an error and exit with a non-zero code.

### 5.3 Shutdown

1. Delete the test Pod or scale down the Deployment.
2. Confirm the sniffer container receives SIGTERM and exits within the pod’s `terminationGracePeriodSeconds` (e.g. log line indicating “stopping” or “stopped” before the container disappears).

## 6. Reference

- Container and env: `docs/specs/DEPLOYMENT_OPS.md`
- Exit codes (0 success, 1 config/validation, 2 runtime): `docs/specs/DEPLOYMENT_OPS.md` § Failure handling and exit codes
- Injector contract: `docs/specs/INJECTOR.md`
- Overview and verification: `docs/OVERVIEW.md` (Verification section)
- Production checklist: `docs/deployment/PRODUCTION_CHECKLIST.md`
