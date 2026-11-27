import { createServer, IncomingMessage } from 'http';
import { handleRequest } from './app';

/**
 * Local gateway for webhook testing. Expose it with a public tunnel
 * (`ngrok http 8787`, or a public VS Code port forward), register the tunnel
 * URL in the provider's dev app, and it forwards to TARGET_URLS (your local
 * API), adding the shared secret the API requires. Reads `.env`.
 */
const port = Number(process.env.PORT ?? 8787);

const readBody = async (request: IncomingMessage): Promise<Uint8Array<ArrayBuffer>> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return new Uint8Array(Buffer.concat(chunks));
};

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }

  const result = await handleRequest({
    method: (request.method ?? 'GET').toUpperCase(),
    path: url.pathname,
    query: url.searchParams,
    headers,
    body: await readBody(request),
  });

  console.log(`${request.method} ${url.pathname} -> ${result.status}`);
  response.writeHead(result.status, result.headers);
  response.end(result.body);
}).listen(port, () => {
  console.log(`Webhook gateway listening on http://localhost:${port}`);
  console.log('Forwarding to', process.env.TARGET_URLS || '(TARGET_URLS not set)');
});
