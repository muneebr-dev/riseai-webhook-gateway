import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { handleRequest } from './app';
import { parseEnvFile } from './env-file';

/** The parts of an API Gateway HTTP API (payload 2.0) event the gateway uses. */
type HttpApiEvent = {
  rawPath: string;
  rawQueryString?: string;
  headers?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
  requestContext: { http: { method: string } };
};

type HttpApiResult = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

let configLoaded: Promise<void> | null = null;

/**
 * Load riseai/<env>/webhook-gateway (KEY=value lines, like the API's env
 * secret) into process.env once per cold start. Values already set on the
 * function win, so a key can be overridden without touching the secret.
 */
const loadConfig = async (): Promise<void> => {
  const secretId = process.env.CONFIG_SECRET_ID;
  if (!secretId) return;

  const client = new SecretsManagerClient({});
  const { SecretString } = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  for (const [key, value] of Object.entries(parseEnvFile(SecretString ?? ''))) {
    process.env[key] ??= value;
  }
};

export const handler = async (event: HttpApiEvent): Promise<HttpApiResult> => {
  configLoaded ??= loadConfig().catch((error: unknown) => {
    configLoaded = null; // retry on the next request instead of caching the failure
    throw error;
  });
  await configLoaded;

  const headers = new Headers();
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    if (value !== undefined) headers.set(key, value);
  }

  const body = event.body
    ? Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf-8')
    : Buffer.alloc(0);

  const response = await handleRequest({
    method: event.requestContext.http.method.toUpperCase(),
    path: event.rawPath,
    query: new URLSearchParams(event.rawQueryString ?? ''),
    headers,
    body,
  });

  return { statusCode: response.status, headers: response.headers, body: response.body };
};
