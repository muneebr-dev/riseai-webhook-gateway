import { gatewayConfig } from './config';
import { logError, logInfo } from './logging';
import { resolveTargets } from './targets';
import { ForwardBatchResult, ForwardResult, Provider } from './types';

function buildForwardUrl(targetBaseUrl: string, provider: Provider, queryString: string): string {
  const routeProvider = provider;
  const targetPath =
    provider === 'google_calendar' ||
    provider === 'outlook_calendar' ||
    provider === 'calendly' ||
    provider === 'square_appointments'
      ? `/api/bookings/webhook/${routeProvider}`
      : `/api/channels/webhook/${routeProvider}`;
  const base = `${targetBaseUrl}${targetPath}`;
  return queryString ? `${base}?${queryString}` : base;
}

function createTimeoutSignal(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

function buildForwardHeaders(
  incomingHeaders: Headers,
  provider: Provider,
  requestId: string,
  receivedAt: string,
): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const [key, value] of incomingHeaders.entries()) {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey === 'host' ||
      normalizedKey === 'content-length' ||
      normalizedKey === 'connection'
    ) {
      continue;
    }
    headers[normalizedKey] = value;
  }

  headers['content-type'] = incomingHeaders.get('content-type') ?? 'application/json';
  headers['user-agent'] = incomingHeaders.get('user-agent') ?? 'webhook-gateway';
  headers['x-webhook-gateway-secret'] = gatewayConfig.forwardSharedSecret;
  headers['x-webhook-gateway-provider'] = provider;
  headers['x-webhook-gateway-request-id'] = requestId;
  headers['x-webhook-gateway-received-at'] = receivedAt;
  headers['x-forwarded-for'] = incomingHeaders.get('x-forwarded-for') ?? '';

  return headers;
}

export async function forwardWebhook(params: {
  provider: Provider;
  method: 'POST';
  queryString: string;
  rawBody: ArrayBuffer;
  incomingHeaders: Headers;
  requestId: string;
  receivedAt: string;
}): Promise<ForwardBatchResult> {
  const { provider, method, queryString, rawBody, incomingHeaders, requestId, receivedAt } = params;
  const targets = resolveTargets(provider);
  const forwardedHeaders = buildForwardHeaders(
    incomingHeaders,
    provider,
    requestId,
    receivedAt,
  );

  const jobs = targets.map(async (targetBaseUrl): Promise<ForwardResult> => {
    const url = buildForwardUrl(targetBaseUrl, provider, queryString);
    const started = Date.now();

    try {
      const response = await fetch(url, {
        method,
        headers: forwardedHeaders,
        body: rawBody,
        signal: createTimeoutSignal(gatewayConfig.forwardTimeoutMs),
      });

      return {
        target: targetBaseUrl,
        ok: response.ok,
        status: response.status,
        durationMs: Date.now() - started,
      };
    } catch (error) {
      return {
        target: targetBaseUrl,
        ok: false,
        durationMs: Date.now() - started,
        error: error instanceof Error ? error.message : 'Unknown forward error',
      };
    }
  });

  const settled = await Promise.allSettled(jobs);
  const results: ForwardResult[] = settled.map((entry, index) => {
    if (entry.status === 'fulfilled') return entry.value;
    return {
      target: targets[index] ?? 'unknown-target',
      ok: false,
      durationMs: 0,
      error: entry.reason instanceof Error ? entry.reason.message : 'Unhandled promise rejection',
    };
  });

  const successCount = results.filter((result) => result.ok).length;
  const failureCount = results.length - successCount;

  const summary: ForwardBatchResult = {
    requestId,
    provider,
    targetCount: targets.length,
    results,
    successCount,
    failureCount,
  };

  if (failureCount > 0) {
    logError('webhook.forward.partial_or_total_failure', summary);
  } else {
    logInfo('webhook.forward.success', summary);
  }

  return summary;
}
