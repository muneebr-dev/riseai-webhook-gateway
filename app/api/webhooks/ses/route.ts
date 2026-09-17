import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { forwardWebhook } from '@/lib/forwarder';
import { logError, logInfo } from '@/lib/logging';
import { isSnsEnvelopeShape, verifySnsMessage } from '@/lib/sns-verifier';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = randomUUID();
  const receivedAt = new Date().toISOString();
  const queryString = request.nextUrl.searchParams.toString();
  const rawBody = await request.arrayBuffer();

  // Signature verification happens here against the raw bytes the sender
  // produced, so forward the raw body untouched and never re-serialize it.
  logInfo('webhook.ses.received', {
    requestId,
    contentType: request.headers.get('content-type') ?? null,
    contentLength: request.headers.get('content-length') ?? null,
  });

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    logError('webhook.ses.invalid_json', { requestId });
    return NextResponse.json(
      { error: 'Invalid JSON body', requestId },
      { status: 400 },
    );
  }

  if (!isSnsEnvelopeShape(parsedBody)) {
    logError('webhook.ses.invalid_envelope', { requestId });
    return NextResponse.json(
      { error: 'Not a valid SNS envelope', requestId },
      { status: 400 },
    );
  }

  const verified = await verifySnsMessage(parsedBody);
  if (!verified) {
    logError('webhook.ses.invalid_signature', {
      requestId,
      messageId: parsedBody.MessageId,
      topicArn: parsedBody.TopicArn,
    });
    return NextResponse.json(
      { error: 'Invalid SNS signature', requestId },
      { status: 403 },
    );
  }

  logInfo('webhook.ses.verified', {
    requestId,
    messageId: verified.MessageId,
    type: verified.Type,
  });

  const result = await forwardWebhook({
    provider: 'ses',
    method: 'POST',
    queryString,
    rawBody,
    incomingHeaders: request.headers,
    requestId,
    receivedAt,
  });

  if (result.targetCount === 0) {
    logError('webhook.ses.no_targets', { requestId });
    return NextResponse.json(
      { error: 'No targets configured', requestId },
      { status: 503 },
    );
  }

  // SNS retries non-2xx deliveries and the API dedupes by sns_message_id,
  // so failing loudly is safer than swallowing bounce/complaint events.
  if (result.successCount === 0) {
    logError('webhook.ses.all_targets_failed', {
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
