# Security

## Reporting a vulnerability

If you believe you have found a security vulnerability in TCP Sniffer, please report it in a **private** way so we can address it before public disclosure.

**Do not** open a public GitHub issue for security-sensitive findings.

### How to report

1. **Preferred:** Open a [GitHub Security Advisory](https://github.com/your-org/tcpsniffer/security/advisories/new) (if this repo has that enabled). This keeps the report private and allows coordinated disclosure.

2. **Alternatively:** If you cannot use GitHub Security Advisories, contact the maintainers privately (e.g. via the email or contact method listed in the repository description or package.json). Include "SECURITY" in the subject line and a clear description of the issue, steps to reproduce, and impact.

We will acknowledge the report and aim to respond within a reasonable time. We may ask for more detail and will work with you on disclosure timing (e.g. after a fix is released).

### Scope

TCP Sniffer is a capture-only TCP/HTTP sniffer that runs as a Kubernetes sidecar. It handles network traffic and optional credentials (e.g. `OUTPUT_URL_AUTH_TOKEN`). We are interested in vulnerabilities in the library, the C++ engine, the injector webhook, or the deployment flow that could lead to privilege escalation, traffic interception or tampering, or credential exposure.

Thank you for helping keep TCP Sniffer secure.
