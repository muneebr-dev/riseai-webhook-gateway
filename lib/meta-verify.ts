import { gatewayConfig } from './config';
import { MetaProvider } from './types';

export function verifyMetaChallenge(
  provider: MetaProvider,
  query: URLSearchParams,
): string | null {
  const mode = query.get('hub.mode');
  const token = query.get('hub.verify_token');
  const challenge = query.get('hub.challenge');

  if (!challenge || mode !== 'subscribe') {
    return null;
  }

  const expectedToken =
    provider === 'messenger'
      ? gatewayConfig.messengerVerifyToken
      : provider === 'instagram'
        ? gatewayConfig.instagramVerifyToken
        : gatewayConfig.whatsappVerifyToken;

  if (!expectedToken || token !== expectedToken) {
    return null;
  }

  return challenge;
}
