import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { gatewayConfig } from '@/lib/config';
import { forwardWebhook } from '@/lib/forwarder';
import { logError, logInfo, redactBodyIfNeeded } from '@/lib/logging';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = randomUUID();
  const receivedAt = new Date().toISOString();
  const queryString = request.nextUrl.searchParams.toString();
  const rawBody = await request.arrayBuffer();

  logInfo('webhook.gmail.received', {
    requestId,
    provider: 'gmail',
    queryString,
    contentType: request.headers.get('content-type') ?? null,
    body: redactBodyIfNeeded(Buffer.from(rawBody).toString('utf-8')),
  });

  const result = await forwardWebhook({
    provider: 'gmail',
    method: 'POST',
    queryString,
    rawBody,
    incomingHeaders: request.headers,
    requestId,
    receivedAt,
  });

  const allFailed = result.targetCount > 0 && result.successCount === 0;

  if (gatewayConfig.requireAtLeastOneTarget && allFailed) {
    return NextResponse.json({ error: 'All forwarding targets failed', requestId }, { status: 502 });
  }

  if (result.targetCount === 0) {
    logError('webhook.gmail.no_targets', { requestId });
  }

  return NextResponse.json({ status: 'EVENT_RECEIVED', requestId }, { status: 200 });
}
