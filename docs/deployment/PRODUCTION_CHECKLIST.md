# TCP Sniffer — Production Checklist

Use this checklist when deploying the sniffer and injector to production. It ties together TLS, failure policy, HTTPS for output, resources, grace period, and auth.

## Webhook (injector)

- [ ] **TLS** — The mutating webhook is served over **HTTPS**. The `MutatingWebhookConfiguration` has a valid `caBundle` so the API server trusts the webhook’s certificate. See [Deployment Guide §2](DEPLOYMENT_GUIDE.md#2-webhook-tls-cert-manager).
- [ ] **Failure policy** — Choose `Fail` (reject Pod create if webhook is down) or `Ignore` (allow Pod create without injection). Document the choice. See [Deployment Guide §3](DEPLOYMENT_GUIDE.md#3-failure-policy).

## Sniffer container

- [ ] **outputUrl must be HTTPS in production** — When `NODE_ENV=production` (or your production marker) is set, the sniffer validates that `outputUrl` uses the `https:` protocol. Configure the injector so the sniffer container gets `NODE_ENV=production` (or equivalent) when you want this enforced. See [Deployment Guide](DEPLOYMENT_GUIDE.md) and [DEPLOYMENT_OPS](../specs/DEPLOYMENT_OPS.md) (Security).
- [ ] **Resource limits** — The injector should set sidecar `resources.requests` and `resources.limits` (e.g. 256Mi/512Mi memory, 100m/500m CPU). Default injector options include these; verify they are applied in the mutated Pod. See [DEPLOYMENT_OPS § Resource limits](../specs/DEPLOYMENT_OPS.md).
- [ ] **terminationGracePeriodSeconds** — The injector adds `spec.terminationGracePeriodSeconds` (e.g. 30) when the pod does not have it, so the sniffer can drain in-flight messages on SIGTERM. See [DEPLOYMENT_OPS](../specs/DEPLOYMENT_OPS.md) and [Deployment Guide](DEPLOYMENT_GUIDE.md).
- [ ] **OUTPUT_URL_AUTH_TOKEN from Secret** — For production, provide the output URL Bearer token via a Kubernetes Secret and configure the injector with `outputUrlAuthTokenSecret: { name, key }`. Do not put secrets in annotations. See [Deployment Guide §4](DEPLOYMENT_GUIDE.md#4-output_url_auth_token-from-secret-production).

## Verification

- [ ] **Injection** — Create a test Pod in a labeled namespace; confirm the Pod has the sniffer sidecar with env (PORTS, INTERFACE, OUTPUT_URL, etc.), `NET_RAW`, and (if configured) resources and terminationGracePeriodSeconds. See [Deployment Guide §5.1](DEPLOYMENT_GUIDE.md#51-webhook-and-injection).
- [ ] **Startup and logs** — Check sniffer container logs for placement, interface, and ports. See [Deployment Guide §5.2](DEPLOYMENT_GUIDE.md#52-sniffer-container-startup-and-logs).
- [ ] **Shutdown** — Delete a test Pod; confirm the sniffer logs “Stopping sniffer” / “Sniffer stopped” and exits with code 0 within the grace period. See [Deployment Guide §5.3](DEPLOYMENT_GUIDE.md#53-shutdown).
- [ ] **Exit codes** — Use exit code **1** for config/validation failures and **2** for runtime/start/stop failures when alerting or runbooks. See [DEPLOYMENT_OPS § Failure handling and exit codes](../specs/DEPLOYMENT_OPS.md).

## Reference

- Full deployment steps: [Deployment Guide](DEPLOYMENT_GUIDE.md)
- Container and env spec: [DEPLOYMENT_OPS](../specs/DEPLOYMENT_OPS.md)
- Implementation details: [PRODUCTION_READINESS_IMPLEMENTATION](../PRODUCTION_READINESS_IMPLEMENTATION.md)
