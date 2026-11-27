import assert from 'node:assert/strict';
import { createServer, IncomingHttpHeaders, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import { resetGatewayConfig } from '../lib/config';
import { parseEnvFile } from '../src/env-file';
import { handler } from '../src/lambda';

type Received = { method: string; url: string; headers: IncomingHttpHeaders; body: Buffer };

let target: Server;
let targetUrl = '';
let targetStatus = 200;
const received: Received[] = [];

const event = (
  method: string,
  rawPath: string,
  options: { query?: string; body?: Buffer; headers?: Record<string, string> } = {},
) => ({
  rawPath,
  rawQueryString: options.query ?? '',
  headers: options.headers ?? {},
  // API Gateway base64-encodes bodies it cannot pass as text; exercise that path.
  body: options.body?.toString('base64'),
  isBase64Encoded: options.body !== undefined,
  requestContext: { http: { method } },
});

const setEnv = (values: Record<string, string>) => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('TARGET_URLS') || key.endsWith('_VERIFY_TOKEN')) delete process.env[key];
  }
  Object.assign(process.env, { FORWARD_SHARED_SECRET: 'test-secret', LOG_LEVEL: 'error' }, values);
  resetGatewayConfig();
};

before(async () => {
  target = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      received.push({
        method: request.method ?? '',
        url: request.url ?? '',
        headers: request.headers,
        body: Buffer.concat(chunks),
      });
      response.writeHead(targetStatus).end();
    });
  });
  await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
  targetUrl = `http://127.0.0.1:${(target.address() as AddressInfo).port}`;
});

after(() => target.close());

beforeEach(() => {
  received.length = 0;
  targetStatus = 200;
  setEnv({ TARGET_URLS: targetUrl });
});

describe('routing', () => {
  it('should answer the health check', async () => {
    const result = await handler(event('GET', '/api/health'));
    assert.equal(result.statusCode, 200);
    assert.equal(JSON.parse(result.body).status, 'ok');
  });

  it('should return 404 for an unknown path and 405 for a wrong method', async () => {
    assert.equal((await handler(event('GET', '/nope'))).statusCode, 404);
    assert.equal((await handler(event('GET', '/api/webhooks/stripe'))).statusCode, 405);
  });

  it('should accept a trailing slash', async () => {
    assert.equal((await handler(event('GET', '/api/health/'))).statusCode, 200);
  });
});

describe('verification handshakes', () => {
  it('should echo the Meta challenge only for the right verify token', async () => {
    setEnv({ TARGET_URLS: targetUrl, INSTAGRAM_VERIFY_TOKEN: 'ig-token' });
    const ok = await handler(
      event('GET', '/api/webhooks/meta/instagram', {
        query: 'hub.mode=subscribe&hub.verify_token=ig-token&hub.challenge=12345',
      }),
    );
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.body, '12345');

    const bad = await handler(
      event('GET', '/api/webhooks/meta/instagram', {
        query: 'hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345',
      }),
    );
    assert.equal(bad.statusCode, 403);
  });

  it('should echo the Outlook validationToken as plain text on GET and POST', async () => {
    for (const path of ['/api/webhooks/outlook', '/api/webhooks/bookings/outlook-calendar']) {
      for (const method of ['GET', 'POST']) {
        const result = await handler(event(method, path, { query: 'validationToken=abc%20123' }));
        assert.equal(result.statusCode, 200);
        assert.equal(result.body, 'abc 123');
        assert.match(result.headers['content-type'], /^text\/plain/);
      }
    }
    assert.equal(received.length, 0);
  });
});

describe('forwarding', () => {
  it('should forward the exact body bytes, query and provider headers with the secret', async () => {
    const body = Buffer.from('{"id":1,"note":"café ✓"}');
    const result = await handler(
      event('POST', '/api/webhooks/commerce/shopify', {
        query: 'shop=a.myshopify.com',
        body,
        headers: { 'content-type': 'application/json', 'x-shopify-hmac-sha256': 'sig' },
      }),
    );

    assert.equal(result.statusCode, 200);
    assert.equal(received.length, 1);
    const [delivery] = received;
    assert.equal(delivery.url, '/api/commerce/webhook/shopify?shop=a.myshopify.com');
    assert.deepEqual(delivery.body, body);
    assert.equal(delivery.headers['x-webhook-gateway-secret'], 'test-secret');
    assert.equal(delivery.headers['x-webhook-gateway-provider'], 'shopify');
    assert.equal(delivery.headers['x-shopify-hmac-sha256'], 'sig');
  });

  it('should map each provider group to its API path', async () => {
    const cases: [string, string][] = [
      ['/api/webhooks/meta/messenger', '/api/channels/webhook/messenger'],
      ['/api/webhooks/gmail', '/api/channels/webhook/gmail'],
      ['/api/webhooks/outlook', '/api/channels/webhook/outlook'],
      ['/api/webhooks/bookings/square', '/api/bookings/webhook/square_appointments'],
      ['/api/webhooks/bookings/google-calendar', '/api/bookings/webhook/google_calendar'],
      ['/api/webhooks/commerce/woocommerce', '/api/commerce/webhook/woocommerce'],
      ['/api/webhooks/stripe', '/api/webhooks/stripe'],
    ];
    for (const [path] of cases) {
      await handler(event('POST', path, { body: Buffer.from('{}') }));
    }
    assert.deepEqual(
      received.map((r) => r.url),
      cases.map(([, apiPath]) => apiPath),
    );
  });

  it('should answer 502 so Shopify retries when the API fails, but 200 for Wix', async () => {
    targetStatus = 500;
    const shopify = await handler(event('POST', '/api/webhooks/commerce/shopify', { body: Buffer.from('{}') }));
    const wix = await handler(event('POST', '/api/webhooks/commerce/wix', { body: Buffer.from('{}') }));
    assert.equal(shopify.statusCode, 502);
    assert.equal(wix.statusCode, 200);
  });

  it('should pass a 401 from the API back to the sender', async () => {
    targetStatus = 401;
    const result = await handler(event('POST', '/api/webhooks/gmail', { body: Buffer.from('{}') }));
    assert.equal(result.statusCode, 401);
  });

  it('should answer 503 for Stripe when no target is configured', async () => {
    setEnv({});
    const result = await handler(event('POST', '/api/webhooks/stripe', { body: Buffer.from('{}') }));
    assert.equal(result.statusCode, 503);
  });

  it('should answer 500 instead of forwarding without the shared secret', async () => {
    setEnv({ TARGET_URLS: targetUrl, FORWARD_SHARED_SECRET: '' });
    const result = await handler(event('POST', '/api/webhooks/gmail', { body: Buffer.from('{}') }));
    assert.equal(result.statusCode, 500);
    assert.equal(received.length, 0);
  });

  it('should reject an SES delivery that is not a signed SNS message', async () => {
    const result = await handler(
      event('POST', '/api/webhooks/ses', {
        body: Buffer.from(JSON.stringify({ Type: 'Notification', MessageId: '1', TopicArn: 'x', Message: 'm' })),
      }),
    );
    assert.equal(result.statusCode, 403);
    assert.equal(received.length, 0);
  });
});

describe('parseEnvFile', () => {
  it('should parse KEY=value lines, skipping comments and stripping quotes', () => {
    assert.deepEqual(
      parseEnvFile('# comment\nA=1\n\nB="two=2"\nC=\'3\'\nbad line\n'),
      { A: '1', B: 'two=2', C: '3' },
    );
  });
});
