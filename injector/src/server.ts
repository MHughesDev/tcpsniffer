/**
 * HTTP server for the mutating webhook (Stream C).
 * Expects POST with AdmissionReview JSON body; returns AdmissionReview JSON response.
 * In production the endpoint must be HTTPS (see C3 / deployment docs).
 */

import { createServer } from 'http';
import type { InjectorOptions } from './types.js';
import { handleAdmissionReview } from './handler.js';

const DEFAULT_PORT = 8443;

export interface ServerOptions {
  port?: number;
  injectorOptions?: Partial<InjectorOptions>;
}

/**
 * Create and return an HTTP server that handles POST / with AdmissionReview.
 * Does not start listening; call server.listen().
 */
export function createWebhookServer(options: ServerOptions = {}) {
  const port = options.port ?? DEFAULT_PORT;
  const injectorOptions = options.injectorOptions;

  const server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    if (req.method !== 'POST' || (path !== '/' && path !== '/mutate')) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        return;
      }

      const response = handleAdmissionReview(parsed, injectorOptions);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
    });
    req.on('error', () => {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    });
  });

  return { server, port };
}

/**
 * Start the webhook server (for local or in-cluster use).
 * TLS is not included; use a reverse proxy or C3 deployment for HTTPS.
 */
export function startServer(options: ServerOptions = {}) {
  const { server, port } = createWebhookServer(options);
  server.listen(port, () => {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      message: `TCP Sniffer injector listening on port ${port}`,
    }));
  });
  return server;
}
