import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { normalizeBookingProvider } from '@/lib/booking-providers';
import { gatewayConfig } from '@/lib/config';
import { forwardWebhook } from '@/lib/forwarder';
import { logError, logInfo, redactBodyIfNeeded } from '@/lib/logging';

function validationResponse(token: string): NextResponse {
  return new NextResponse(token, {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
    },
  });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
): Promise<NextResponse> {
  const { provider: providerSlug } = await context.params;
  const provider = normalizeBookingProvider(providerSlug);

  if (!provider) {
    return NextResponse.json(
      { error: 'Unsupported booking provider' },
      { status: 400 },
    );
  }

  if (provider === 'outlook_calendar') {
    const validationToken =
      request.nextUrl.searchParams.get('validationToken');
    if (!validationToken) {
      return NextResponse.json(
        { error: 'Missing validationToken' },
        { status: 400 },
      );
    }
    return validationResponse(validationToken);
  }

  return NextResponse.json(
    { error: 'GET not supported for this booking provider' },
    { status: 405 },
  );
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
): Promise<NextResponse> {
  const { provider: providerSlug } = await context.params;
  const provider = normalizeBookingProvider(providerSlug);

  if (!provider) {
    return NextResponse.json(
      { error: 'Unsupported booking provider' },
      { status: 400 },
    );
  }

  const validationToken = request.nextUrl.searchParams.get('validationToken');
  if (provider === 'outlook_calendar' && validationToken) {
    return validationResponse(validationToken);
  }

  const requestId = randomUUID();
  const receivedAt = new Date().toISOString();
  const queryString = request.nextUrl.searchParams.toString();
  const rawBody = await request.arrayBuffer();

  logInfo('webhook.bookings.received', {
    requestId,
    provider,
    queryString,
    contentType: request.headers.get('content-type') ?? null,
    body: redactBodyIfNeeded(Buffer.from(rawBody).toString('utf-8')),
  });

  const result = await forwardWebhook({
    provider,
    method: 'POST',
    queryString,
    rawBody,
    incomingHeaders: request.headers,
    requestId,
    receivedAt,
  });

  const allFailed = result.targetCount > 0 && result.successCount === 0;

  if (gatewayConfig.requireAtLeastOneTarget && allFailed) {
    return NextResponse.json(
      { error: 'All forwarding targets failed', requestId },
      { status: 502 },
    );
  }

  if (result.targetCount === 0) {
    logError('webhook.bookings.no_targets', { requestId, provider });
  }

  return NextResponse.json({ status: 'EVENT_RECEIVED', requestId }, { status: 200 });
}
