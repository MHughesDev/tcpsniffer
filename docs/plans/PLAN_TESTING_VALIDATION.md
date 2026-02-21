# TCP Sniffer — Testing & Validation Plan

## Purpose

Define the test and validation strategy across the TS library, C++ engine, injector, and deployment, consistent with `docs/OVERVIEW.md` verification goals.

## Unit tests

Tasks:
- **TCP reassembly**: synthetic segment streams and pcap fixtures; verify ordered byte streams and dedupe.
- **HTTP parsing**: request/response parsing, chunked encoding, multiple messages per connection.
- **Config validation**: invalid ports, empty ports, invalid sampleRate, missing outputs.

Milestone:
- Unit test suite covers reassembly, HTTP parsing, and config validation.

## Integration tests

Tasks:
- **C++ → TS contract**: message shape fields and types; receiver/destination correctness.
- **Output pipeline**: callback invocation, stdout JSON lines, `outputUrl` POST with retries.
- **Failure handling**: interface missing, permission errors, invalid config logs.

Milestone:
- Integration suite validates contract, outputs, and failure behavior.

## Webhook tests

Tasks:
- AdmissionReview request/response schema validation.
- Label-based injection behavior.
- Patch contents: container, env, securityContext, volumes.

Milestone:
- Webhook tests confirm schema compliance and correct mutation.

## End-to-end tests

Tasks:
- Run a test HTTP server in a pod; generate traffic; validate reconstructed output.
- Verify receiver/destination mapping and direction.
- Ensure HTTPS traffic appears as ciphertext (no decryption).

Milestone:
- E2E traffic produces expected output with correct direction and mapping.

## Shutdown tests

Tasks:
- Send SIGTERM; verify stop drains outputs and exits within grace period.
- Validate no message loss in drain window.

Milestone:
- Shutdown drain completes within grace period without message loss.

## Milestones (overall)

- All verification items in `docs/OVERVIEW.md` are covered by a test.
- Output message shape matches the overview and architecture documents.
