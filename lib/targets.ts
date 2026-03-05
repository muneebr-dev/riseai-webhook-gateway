import { gatewayConfig } from './config';
import { Provider } from './types';

function dedupe(urls: string[]): string[] {
  return [...new Set(urls)];
}

export function resolveTargets(provider: Provider): string[] {
  const cfg = gatewayConfig;

  const providerSpecific =
    provider === 'messenger'
      ? cfg.targetUrlsMessenger
      : provider === 'instagram'
        ? cfg.targetUrlsInstagram
        : provider === 'whatsapp'
          ? cfg.targetUrlsWhatsapp
          : provider === 'gmail'
            ? cfg.targetUrlsGmail
            : cfg.targetUrlsOutlook;

  if (providerSpecific.length > 0) return dedupe(providerSpecific);

  if (provider === 'messenger' || provider === 'instagram' || provider === 'whatsapp') {
    if (cfg.targetUrlsMeta.length > 0) return dedupe(cfg.targetUrlsMeta);
  }

  return dedupe(cfg.targetUrls);
}
