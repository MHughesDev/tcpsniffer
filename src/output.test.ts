/**
 * Output pipeline: redaction and delivery.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  redactSensitiveHeaders,
  deliverMessage,
  DEFAULT_REDACT_HEADERS,
} from './output.js';
import type { HttpMessage } from './types.js';

const fixtureMessage: HttpMessage = {
  receiver: { ip: '10.0.0.1', port: 8080 },
  destination: { ip: '10.0.0.2', port: 443 },
  direction: 'request',
  headers: {
    'content-type': 'application/json',
    authorization: 'Bearer secret-token',
    cookie: 'session=abc123',
    'x-custom': 'ok',
  },
  timestamp: '2025-01-01T00:00:00.000Z',
  method: 'GET',
  path: '/api',
};

describe('redactSensitiveHeaders', () => {
  it('redacts default header names (authorization, cookie) case-insensitively', () => {
    const out = redactSensitiveHeaders(fixtureMessage, DEFAULT_REDACT_HEADERS);
    assert.equal(out.headers['authorization'], '[REDACTED]');
    assert.equal(out.headers['cookie'], '[REDACTED]');
    assert.equal(out.headers['content-type'], 'application/json');
    assert.equal(out.headers['x-custom'], 'ok');
    assert.notEqual(out, fixtureMessage);
    assert.notEqual(out.headers, fixtureMessage.headers);
  });

  it('matches header names case-insensitively', () => {
    const msg: HttpMessage = {
      ...fixtureMessage,
      headers: { Authorization: 'Bearer x', COOKIE: 'y' },
    };
    const out = redactSensitiveHeaders(msg, ['authorization', 'cookie']);
    assert.equal(out.headers['Authorization'], '[REDACTED]');
    assert.equal(out.headers['COOKIE'], '[REDACTED]');
  });

  it('returns cloned message with no redaction when list is empty', () => {
    const out = redactSensitiveHeaders(fixtureMessage, []);
    assert.deepEqual(out.headers, fixtureMessage.headers);
    assert.notEqual(out, fixtureMessage);
    assert.notEqual(out.headers, fixtureMessage.headers);
  });

  it('leaves other fields unchanged', () => {
    const out = redactSensitiveHeaders(fixtureMessage, ['authorization']);
    assert.equal(out.receiver.ip, fixtureMessage.receiver.ip);
    assert.equal(out.direction, fixtureMessage.direction);
    assert.equal(out.timestamp, fixtureMessage.timestamp);
  });
});

describe('deliverMessage with redaction', () => {
  it('delivers redacted message to callback (default redact list)', () => {
    const onHttpMessage = mock.fn();
    deliverMessage(
      { onHttpMessage, redactHeaders: undefined },
      fixtureMessage
    );
    assert.equal(onHttpMessage.mock.calls.length, 1);
    const delivered = onHttpMessage.mock.calls[0].arguments[0] as HttpMessage;
    assert.equal(delivered.headers['authorization'], '[REDACTED]');
    assert.equal(delivered.headers['cookie'], '[REDACTED]');
    assert.equal(delivered.headers['content-type'], 'application/json');
  });

  it('delivers redacted message when redactHeaders is empty (no redaction)', () => {
    const onHttpMessage = mock.fn();
    deliverMessage({ onHttpMessage, redactHeaders: [] }, fixtureMessage);
    assert.equal(onHttpMessage.mock.calls.length, 1);
    const delivered = onHttpMessage.mock.calls[0].arguments[0] as HttpMessage;
    assert.equal(delivered.headers['authorization'], 'Bearer secret-token');
    assert.equal(delivered.headers['cookie'], 'session=abc123');
  });

  it('delivers message redacting only custom header names', () => {
    const onHttpMessage = mock.fn();
    deliverMessage(
      { onHttpMessage, redactHeaders: ['x-custom'] },
      fixtureMessage
    );
    assert.equal(onHttpMessage.mock.calls.length, 1);
    const delivered = onHttpMessage.mock.calls[0].arguments[0] as HttpMessage;
    assert.equal(delivered.headers['authorization'], 'Bearer secret-token');
    assert.equal(delivered.headers['x-custom'], '[REDACTED]');
  });
});
