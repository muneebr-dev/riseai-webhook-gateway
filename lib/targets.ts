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
            : provider === 'outlook'
              ? cfg.targetUrlsOutlook
              : provider === 'google_calendar'
                ? cfg.targetUrlsGoogleCalendar
                : provider === 'outlook_calendar'
                  ? cfg.targetUrlsOutlookCalendar
                  : provider === 'calendly'
                    ? cfg.targetUrlsCalendly
                    : cfg.targetUrlsSquareAppointments;

  if (providerSpecific.length > 0) return dedupe(providerSpecific);

  if (provider === 'messenger' || provider === 'instagram' || provider === 'whatsapp') {
    if (cfg.targetUrlsMeta.length > 0) return dedupe(cfg.targetUrlsMeta);
  }

  if (
    provider === 'google_calendar' ||
    provider === 'outlook_calendar' ||
    provider === 'calendly' ||
    provider === 'square_appointments'
  ) {
    if (cfg.targetUrlsBookings.length > 0) return dedupe(cfg.targetUrlsBookings);
  }

  return dedupe(cfg.targetUrls);
}
