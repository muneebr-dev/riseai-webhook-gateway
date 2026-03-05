import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
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

export async function GET(request: NextRequest): Promise<NextResponse> {
  const validationToken = request.nextUrl.searchParams.get('validationToken');

  if (!validationToken) {
    return NextResponse.json({ error: 'Missing validationToken' }, { status: 400 });
  }

  return validationResponse(validationToken);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const validationToken = request.nextUrl.searchParams.get('validationToken');
  if (validationToken) {
    return validationResponse(validationToken);
  }

  const requestId = randomUUID();
  const receivedAt = new Date().toISOString();
  const queryString = request.nextUrl.searchParams.toString();
  const rawBody = await request.arrayBuffer();

  logInfo('webhook.outlook.received', {
    requestId,
    provider: 'outlook',
    queryString,
    contentType: request.headers.get('content-type') ?? null,
    body: redactBodyIfNeeded(Buffer.from(rawBody).toString('utf-8')),
  });

  const result = await forwardWebhook({
    provider: 'outlook',
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
    logError('webhook.outlook.no_targets', { requestId });
  }

  return NextResponse.json({ status: 'EVENT_RECEIVED', requestId }, { status: 200 });
}
