import { createVerify } from 'crypto';

export type SnsEnvelope = {
  Type: string;
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp?: string;
  Subject?: string;
  Signature?: string;
  SignatureVersion?: string;
  SigningCertURL?: string;
  SubscribeURL?: string;
  Token?: string;
};

const SNS_HOST_PATTERN = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;
const SNS_CERT_PATH_PATTERN =
  /^\/SimpleNotificationService-[A-Za-z0-9_-]+\.pem$/;

export function isSnsEnvelopeShape(value: unknown): value is SnsEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.Type === 'string' &&
    typeof candidate.MessageId === 'string' &&
    typeof candidate.TopicArn === 'string' &&
    typeof candidate.Message === 'string'
  );
}

function parseHttpsSnsUrl(
  raw: string,
  options: { allowQuery: boolean; allowPort443: boolean },
): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const portValid = !url.port || (options.allowPort443 && url.port === '443');
  const queryValid = options.allowQuery || url.search === '';
  if (
    url.protocol !== 'https:' ||
    !portValid ||
    url.username ||
    url.password ||
    !queryValid ||
    !SNS_HOST_PATTERN.test(url.hostname)
  ) {
    return null;
  }
  return url;
}

function canonicalString(envelope: SnsEnvelope): string {
  const fields =
    envelope.Type === 'Notification'
      ? ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type']
      : [
          'Message',
          'MessageId',
          'SubscribeURL',
          'Timestamp',
          'Token',
          'TopicArn',
          'Type',
        ];
  return fields
    .filter((field) => envelope[field as keyof SnsEnvelope] !== undefined)
    .map((field) => `${field}\n${envelope[field as keyof SnsEnvelope]}\n`)
    .join('');
}

/**
 * Verifies the SNS message signature before forwarding. Returns the verified
 * envelope, or null when the message is not authentic SNS traffic.
 */
export async function verifySnsMessage(
  envelope: SnsEnvelope,
): Promise<SnsEnvelope | null> {
  if (
    !envelope.Signature ||
    !envelope.SigningCertURL ||
    !envelope.SignatureVersion ||
    !['1', '2'].includes(envelope.SignatureVersion)
  ) {
    return null;
  }

  const certUrl = parseHttpsSnsUrl(envelope.SigningCertURL, {
    allowQuery: false,
    allowPort443: false,
  });
  if (!certUrl || !SNS_CERT_PATH_PATTERN.test(certUrl.pathname)) {
    return null;
  }

  let certificate: string | null = null;
  try {
    const response = await fetch(certUrl.toString());
    if (!response.ok) return null;
    certificate = await response.text();
  } catch {
    return null;
  }
  if (!certificate) return null;

  const algorithm =
    envelope.SignatureVersion === '1' ? 'RSA-SHA1' : 'RSA-SHA256';
  const verifier = createVerify(algorithm);
  verifier.update(canonicalString(envelope), 'utf8');
  try {
    const valid = verifier.verify(certificate, envelope.Signature, 'base64');
    return valid ? envelope : null;
  } catch {
    return null;
  }
}
