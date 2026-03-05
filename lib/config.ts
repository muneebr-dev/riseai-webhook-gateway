const DEFAULT_FORWARD_TIMEOUT_MS = 5000;

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true';
}

function parseUrls(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean)
    .map((url) => url.replace(/\/$/, ''));
}

function parseNumber(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return parsed;
}

export const gatewayConfig = {
  targetUrls: parseUrls(process.env.TARGET_URLS),
  targetUrlsMeta: parseUrls(process.env.TARGET_URLS_META),
  targetUrlsGmail: parseUrls(process.env.TARGET_URLS_GMAIL),
  targetUrlsOutlook: parseUrls(process.env.TARGET_URLS_OUTLOOK),
  targetUrlsMessenger: parseUrls(process.env.TARGET_URLS_MESSENGER),
  targetUrlsInstagram: parseUrls(process.env.TARGET_URLS_INSTAGRAM),
  targetUrlsWhatsapp: parseUrls(process.env.TARGET_URLS_WHATSAPP),
  forwardSharedSecret: process.env.FORWARD_SHARED_SECRET ?? '',
  forwardTimeoutMs: parseNumber(
    process.env.FORWARD_TIMEOUT_MS,
    DEFAULT_FORWARD_TIMEOUT_MS,
  ),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  requireAtLeastOneTarget: parseBoolean(
    process.env.REQUIRE_AT_LEAST_ONE_TARGET,
    false,
  ),
  redactLogBodies: parseBoolean(process.env.REDACT_LOG_BODIES, true),
  messengerVerifyToken: process.env.MESSENGER_VERIFY_TOKEN ?? '',
  instagramVerifyToken: process.env.INSTAGRAM_VERIFY_TOKEN ?? '',
  whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? '',
};
