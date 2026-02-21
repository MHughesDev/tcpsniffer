/**
 * Quick demo: run the sniffer and send/receive HTTP traffic on port 8080.
 * - Sniffer captures HTTP (mock engine emits fixtures; real C++ engine would capture live traffic).
 * - Tiny HTTP server echoes requests so you can hit it with GET/POST.
 * - Demo client sends a few requests so you see the full flow.
 *
 * Run: npm run build && npm run demo
 */

import { createSniffer } from './sniffer.js';
import type { HttpMessage } from './types.js';
import { createServer } from 'http';

const PORT = 8080;

function prettyMsg(msg: HttpMessage): string {
  const dir = msg.direction === 'request' ? '→' : '←';
  const summary =
    msg.direction === 'request'
      ? `${msg.method ?? '?'} ${msg.path ?? '?'}`
      : `HTTP ${msg.statusCode ?? '?'}`;
  const body = msg.body ? ` | body: ${msg.body.slice(0, 80)}${msg.body.length > 80 ? '...' : ''}` : '';
  return `[${dir}] ${summary} (${msg.receiver.ip}:${msg.receiver.port} ↔ ${msg.destination.ip}:${msg.destination.port})${body}`;
}

async function runDemo(): Promise<void> {
  const received: HttpMessage[] = [];

  const sniffer = createSniffer({
    ports: [PORT],
    onHttpMessage: (msg: HttpMessage) => {
      received.push(msg);
      console.log('[Sniffer] ' + prettyMsg(msg));
    },
    outputStdout: false, // we use callback for clearer demo output
  });

  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk.toString()));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          method: req.method,
          url: req.url,
          body: body || undefined,
          message: 'Request received by demo server',
        })
      );
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(PORT, () => resolve()).on('error', reject);
  });
  console.log(`Demo server listening on http://localhost:${PORT}`);

  await sniffer.start();
  console.log('Sniffer started (mock engine emits fixture messages; real engine would capture live traffic)\n');

  // Give mock engine time to emit its fixture messages
  await new Promise((r) => setTimeout(r, 100));

  // Send real HTTP requests to our server
  const base = `http://127.0.0.1:${PORT}`;
  const requests = [
    fetch(`${base}/`),
    fetch(`${base}/demo`),
    fetch(`${base}/echo`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'Hello TCP' }),
  ];
  await Promise.all(requests);
  console.log('Sent 3 HTTP requests to local server\n');

  await new Promise((r) => setTimeout(r, 300));
  await sniffer.stop();
  server.close();

  console.log(`\nDemo done. Sniffer received ${received.length} HTTP message(s).`);
  console.log('(With the real C++ engine on Linux, you would see the 3 requests above in the sniffer output.)');
}

runDemo().catch((err) => {
  console.error(err);
  process.exit(1);
});
