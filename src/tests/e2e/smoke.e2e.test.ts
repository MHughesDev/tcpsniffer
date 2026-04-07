/**
 * Optional smoke checks for local environment readiness.
 * This does NOT require Kubernetes and is safe to run in CI.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');

describe('e2e smoke checks', () => {
  it('repository contains docs/testing/E2E.md guidance', async () => {
    const e2eDoc = path.resolve(repoRoot, 'docs/testing/E2E.md');
    await assert.doesNotReject(access(e2eDoc));
  });

  it('repository has root env example for container runtime variables', async () => {
    const rootEnv = path.resolve(repoRoot, '.env.example');
    await assert.doesNotReject(access(rootEnv));
  });
});
