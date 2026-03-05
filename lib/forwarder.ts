import { gatewayConfig } from './config';
import { logError, logInfo } from './logging';
import { resolveTargets } from './targets';
import { ForwardBatchResult, ForwardResult, Provider } from './types';

function buildForwardUrl(targetBaseUrl: string, provider: Provider, queryString: string): string {
  const routeProvider = provider;
  const targetPath = `/api/channels/webhook/${routeProvider}`;
  const base = `${targetBaseUrl}${targetPath}`;
  return queryString ? `${base}?${queryString}` : base;
}

function createTimeoutSignal(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
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

  const forwardedContentType = incomingHeaders.get('content-type') ?? 'application/json';
  const forwardedUserAgent = incomingHeaders.get('user-agent') ?? 'webhook-gateway';

  const jobs = targets.map(async (targetBaseUrl): Promise<ForwardResult> => {
    const url = buildForwardUrl(targetBaseUrl, provider, queryString);
    const started = Date.now();

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'content-type': forwardedContentType,
          'user-agent': forwardedUserAgent,
          'x-webhook-gateway-secret': gatewayConfig.forwardSharedSecret,
          'x-webhook-gateway-provider': provider,
          'x-webhook-gateway-request-id': requestId,
          'x-webhook-gateway-received-at': receivedAt,
          'x-forwarded-for': incomingHeaders.get('x-forwarded-for') ?? '',
        },
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
