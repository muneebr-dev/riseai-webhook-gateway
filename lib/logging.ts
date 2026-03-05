import { gatewayConfig } from './config';

export function logInfo(event: string, data: Record<string, unknown>): void {
  if (gatewayConfig.logLevel === 'error') return;
  console.log(JSON.stringify({ level: 'info', event, ...data }));
}

export function logError(event: string, data: Record<string, unknown>): void {
  console.error(JSON.stringify({ level: 'error', event, ...data }));
}

export function redactBodyIfNeeded(bodyText: string): string {
  if (gatewayConfig.redactLogBodies) return '[REDACTED]';
  return bodyText;
}
