import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { gatewayConfig } from '@/lib/config';
import { forwardWebhook } from '@/lib/forwarder';
import { logError, logInfo, redactBodyIfNeeded } from '@/lib/logging';
import { verifyMetaChallenge } from '@/lib/meta-verify';
import { MetaProvider } from '@/lib/types';

const META_PROVIDERS: MetaProvider[] = ['messenger', 'instagram', 'whatsapp'];

function isMetaProvider(provider: string): provider is MetaProvider {
  return META_PROVIDERS.includes(provider as MetaProvider);
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
): Promise<NextResponse> {
  const { provider } = await context.params;

  if (!isMetaProvider(provider)) {
    return NextResponse.json({ error: 'Unsupported meta provider' }, { status: 400 });
  }

  const challenge = verifyMetaChallenge(provider, request.nextUrl.searchParams);

  if (!challenge) {
    return new NextResponse('Verification failed', { status: 403 });
  }

  return new NextResponse(challenge, { status: 200 });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
): Promise<NextResponse> {
  const { provider } = await context.params;

  if (!isMetaProvider(provider)) {
    return NextResponse.json({ error: 'Unsupported meta provider' }, { status: 400 });
  }

  const requestId = randomUUID();
  const receivedAt = new Date().toISOString();
  const queryString = request.nextUrl.searchParams.toString();
  const rawBody = await request.arrayBuffer();

  logInfo('webhook.meta.received', {
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
    return NextResponse.json({ error: 'All forwarding targets failed', requestId }, { status: 502 });
  }

  if (result.targetCount === 0) {
    logError('webhook.meta.no_targets', { requestId, provider });
  }

  return NextResponse.json({ status: 'EVENT_RECEIVED', requestId }, { status: 200 });
}
