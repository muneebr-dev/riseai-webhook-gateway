import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { forwardWebhook } from '@/lib/forwarder';
import { logError, logInfo } from '@/lib/logging';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = randomUUID();
  const receivedAt = new Date().toISOString();
  const queryString = request.nextUrl.searchParams.toString();
  const rawBody = await request.arrayBuffer();

  // Stripe signature verification happens in the API against these exact
  // bytes, so forward the raw body untouched and never re-serialize it.
  logInfo('webhook.stripe.received', {
    requestId,
    signaturePresent: request.headers.has('stripe-signature'),
    contentType: request.headers.get('content-type') ?? null,
    contentLength: request.headers.get('content-length') ?? null,
  });

  const result = await forwardWebhook({
    provider: 'stripe',
    method: 'POST',
    queryString,
    rawBody,
    incomingHeaders: request.headers,
    requestId,
    receivedAt,
  });

  if (result.targetCount === 0) {
    logError('webhook.stripe.no_targets', { requestId });
    return NextResponse.json(
      { error: 'No targets configured', requestId },
      { status: 503 },
    );
  }

  // Stripe retries non-2xx deliveries; the API dedupes by stripe_event_id,
  // so failing loudly is safer than swallowing billing events with a 200.
  if (result.successCount === 0) {
    logError('webhook.stripe.all_targets_failed', {
      requestId,
      results: result.results,
    });
    return NextResponse.json(
      { error: 'All forwarding targets failed', requestId },
      { status: 502 },
    );
  }

  return NextResponse.json(
    { status: 'EVENT_RECEIVED', requestId },
    { status: 200 },
  );
}
