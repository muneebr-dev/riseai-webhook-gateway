import { randomUUID } from 'crypto';
import { normalizeBookingProvider } from '../lib/booking-providers';
import { normalizeCommerceProvider } from '../lib/commerce-providers';
import { gatewayConfig } from '../lib/config';
import { allTargetsUnauthorized, forwardWebhook } from '../lib/forwarder';
import { logError, logInfo, redactBodyIfNeeded } from '../lib/logging';
import { verifyMetaChallenge } from '../lib/meta-verify';
import { isSnsEnvelopeShape, verifySnsMessage } from '../lib/sns-verifier';
import { ForwardBatchResult, MetaProvider, Provider } from '../lib/types';

/**
 * One incoming HTTP request, independent of where it arrived (API Gateway in
 * AWS, or the local dev server). `body` holds the exact bytes the sender
 * produced: providers sign those bytes, so they are never re-serialized.
 */
export type GatewayRequest = {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Headers;
  body: Uint8Array<ArrayBuffer>;
};

export type GatewayResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

const json = (status: number, payload: Record<string, unknown>): GatewayResponse => ({
  status,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
});

const text = (status: number, payload: string): GatewayResponse => ({
  status,
  headers: { 'content-type': 'text/plain; charset=utf-8' },
  body: payload,
});

const META_PROVIDERS: MetaProvider[] = ['messenger', 'instagram', 'whatsapp'];

const isMetaProvider = (provider: string): provider is MetaProvider =>
  META_PROVIDERS.includes(provider as MetaProvider);

// Shopify allows 5 seconds for the whole delivery, so the API gets less than
// that and a slow API reads as a failure Shopify will retry.
const SHOPIFY_FORWARD_TIMEOUT_MS = 4000;

type ForwardOptions = {
  provider: Provider;
  logEvent: string;
  /** Answer 502 when every target failed, so the sender retries. */
  retryOnFailure: boolean;
  timeoutMs?: number;
};

/** Forward a provider delivery and turn the result into the sender's answer. */
const forward = async (
  request: GatewayRequest,
  { provider, logEvent, retryOnFailure, timeoutMs }: ForwardOptions,
): Promise<GatewayResponse> => {
  const requestId = randomUUID();
  const receivedAt = new Date().toISOString();
  const queryString = request.query.toString();

  logInfo(`${logEvent}.received`, {
    requestId,
    provider,
    queryString,
    contentType: request.headers.get('content-type') ?? null,
    body: redactBodyIfNeeded(Buffer.from(request.body).toString('utf-8')),
  });

  const result = await forwardWebhook({
    provider,
    method: 'POST',
    queryString,
    rawBody: request.body,
    incomingHeaders: request.headers,
    requestId,
    receivedAt,
    timeoutMs,
  });

  return answerForward(result, { requestId, provider, logEvent, retryOnFailure });
};

const answerForward = (
  result: ForwardBatchResult,
  options: { requestId: string; provider: Provider; logEvent: string; retryOnFailure: boolean },
): GatewayResponse => {
  const { requestId, provider, logEvent, retryOnFailure } = options;
  const allFailed = result.targetCount > 0 && result.successCount === 0;

  if (allTargetsUnauthorized(result)) {
    logError('webhook.forward.all_targets_unauthorized', { requestId, provider });
    return json(401, { error: 'Webhook rejected by target', requestId });
  }

  if ((retryOnFailure || gatewayConfig().requireAtLeastOneTarget) && allFailed) {
    return json(502, { error: 'All forwarding targets failed', requestId });
  }

  if (result.targetCount === 0) {
    logError(`${logEvent}.no_targets`, { requestId, provider });
  }

  return json(200, { status: 'EVENT_RECEIVED', requestId });
};

/**
 * Stripe and SES: the API verifies the signature and dedupes, so a delivery
 * with no target or no successful target fails loudly and the sender retries.
 */
const forwardStrict = async (
  request: GatewayRequest,
  provider: 'stripe' | 'ses',
  requestId: string,
): Promise<GatewayResponse> => {
  const result = await forwardWebhook({
    provider,
    method: 'POST',
    queryString: request.query.toString(),
    rawBody: request.body,
    incomingHeaders: request.headers,
    requestId,
    receivedAt: new Date().toISOString(),
  });

  if (result.targetCount === 0) {
    logError(`webhook.${provider}.no_targets`, { requestId });
    return json(503, { error: 'No targets configured', requestId });
  }
  if (result.successCount === 0) {
    logError(`webhook.${provider}.all_targets_failed`, { requestId, results: result.results });
    return json(502, { error: 'All forwarding targets failed', requestId });
  }
  return json(200, { status: 'EVENT_RECEIVED', requestId });
};

const handleStripe = (request: GatewayRequest): Promise<GatewayResponse> => {
  const requestId = randomUUID();
  logInfo('webhook.stripe.received', {
    requestId,
    signaturePresent: request.headers.has('stripe-signature'),
    contentType: request.headers.get('content-type') ?? null,
    contentLength: request.body.byteLength,
  });
  return forwardStrict(request, 'stripe', requestId);
};

const handleSes = async (request: GatewayRequest): Promise<GatewayResponse> => {
  const requestId = randomUUID();
  logInfo('webhook.ses.received', {
    requestId,
    contentType: request.headers.get('content-type') ?? null,
    contentLength: request.body.byteLength,
  });

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(Buffer.from(request.body).toString('utf-8'));
  } catch {
    logError('webhook.ses.invalid_json', { requestId });
    return json(400, { error: 'Invalid JSON body', requestId });
  }

  if (!isSnsEnvelopeShape(parsedBody)) {
    logError('webhook.ses.invalid_envelope', { requestId });
    return json(400, { error: 'Not a valid SNS envelope', requestId });
  }

  const verified = await verifySnsMessage(parsedBody);
  if (!verified) {
    logError('webhook.ses.invalid_signature', {
      requestId,
      messageId: parsedBody.MessageId,
      topicArn: parsedBody.TopicArn,
    });
    return json(403, { error: 'Invalid SNS signature', requestId });
  }

  logInfo('webhook.ses.verified', { requestId, messageId: verified.MessageId, type: verified.Type });
  return forwardStrict(request, 'ses', requestId);
};

const handleMeta = (request: GatewayRequest, slug: string): Promise<GatewayResponse> | GatewayResponse => {
  if (!isMetaProvider(slug)) {
    return json(400, { error: 'Unsupported meta provider' });
  }
  if (request.method === 'GET') {
    const challenge = verifyMetaChallenge(slug, request.query);
    return challenge ? text(200, challenge) : text(403, 'Verification failed');
  }
  return forward(request, { provider: slug, logEvent: 'webhook.meta', retryOnFailure: false });
};

/** Microsoft Graph confirms a subscription by expecting validationToken back. */
const outlookValidation = (request: GatewayRequest): GatewayResponse | null => {
  const token = request.query.get('validationToken');
  if (token) return text(200, token);
  if (request.method === 'GET') return json(400, { error: 'Missing validationToken' });
  return null;
};

const handleOutlook = (request: GatewayRequest): Promise<GatewayResponse> | GatewayResponse =>
  outlookValidation(request) ??
  forward(request, { provider: 'outlook', logEvent: 'webhook.outlook', retryOnFailure: false });

const handleBookings = (request: GatewayRequest, slug: string): Promise<GatewayResponse> | GatewayResponse => {
  const provider = normalizeBookingProvider(slug);
  if (!provider) {
    return json(400, { error: 'Unsupported booking provider' });
  }
  if (provider === 'outlook_calendar') {
    const validation = outlookValidation(request);
    if (validation) return validation;
  } else if (request.method === 'GET') {
    return json(405, { error: 'GET not supported for this booking provider' });
  }
  return forward(request, { provider, logEvent: 'webhook.bookings', retryOnFailure: false });
};

const handleCommerce = (request: GatewayRequest, slug: string): Promise<GatewayResponse> | GatewayResponse => {
  const provider = normalizeCommerceProvider(slug);
  if (!provider) {
    return json(400, { error: 'Unsupported commerce provider' });
  }
  const isShopify = provider === 'shopify';
  return forward(request, {
    provider,
    logEvent: 'webhook.commerce',
    // Shopify only retries on a non-2xx answer; acknowledging a delivery the
    // API never processed would lose it (including mandatory privacy requests).
    retryOnFailure: isShopify,
    timeoutMs: isShopify ? SHOPIFY_FORWARD_TIMEOUT_MS : undefined,
  });
};

type Route = {
  pattern: RegExp;
  methods: string[];
  run: (request: GatewayRequest, param: string) => Promise<GatewayResponse> | GatewayResponse;
};

// Paths match the old Vercel gateway, so moving a provider is a host change.
const ROUTES: Route[] = [
  {
    pattern: /^\/api\/health$/,
    methods: ['GET'],
    run: () => json(200, { status: 'ok', timestamp: new Date().toISOString() }),
  },
  { pattern: /^\/api\/webhooks\/meta\/([^/]+)$/, methods: ['GET', 'POST'], run: handleMeta },
  {
    pattern: /^\/api\/webhooks\/gmail$/,
    methods: ['POST'],
    run: (request) => forward(request, { provider: 'gmail', logEvent: 'webhook.gmail', retryOnFailure: false }),
  },
  { pattern: /^\/api\/webhooks\/outlook$/, methods: ['GET', 'POST'], run: handleOutlook },
  { pattern: /^\/api\/webhooks\/bookings\/([^/]+)$/, methods: ['GET', 'POST'], run: handleBookings },
  { pattern: /^\/api\/webhooks\/commerce\/([^/]+)$/, methods: ['POST'], run: handleCommerce },
  { pattern: /^\/api\/webhooks\/stripe$/, methods: ['POST'], run: handleStripe },
  { pattern: /^\/api\/webhooks\/ses$/, methods: ['POST'], run: handleSes },
];

export const handleRequest = async (request: GatewayRequest): Promise<GatewayResponse> => {
  const path = request.path.length > 1 ? request.path.replace(/\/+$/, '') : request.path;
  const route = ROUTES.find(({ pattern }) => pattern.test(path));
  if (!route) {
    return json(404, { error: 'Not found' });
  }
  if (!route.methods.includes(request.method)) {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    const param = route.pattern.exec(path)?.[1] ?? '';
    return await route.run(request, decodeURIComponent(param));
  } catch (error) {
    logError('webhook.unhandled_error', {
      path,
      error: error instanceof Error ? error.message : String(error),
    });
    return json(500, { error: 'Gateway error' });
  }
};
