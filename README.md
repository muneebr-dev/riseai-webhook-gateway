# Webhook Gateway

Receives platform webhooks on one public host per environment and forwards them to that environment's API, adding the `x-webhook-gateway-secret` header the API requires (the API rejects webhook POSTs without it).

| Environment | Host | Forwards to |
| --- | --- | --- |
| production | `https://hooks.riseai.ai` | `https://riseai.ai` |
| staging | `https://stg-hooks.riseai.ai` | `https://stg.riseai.ai` |
| local | your tunnel URL (ngrok / VS Code) | `http://localhost:3000` |

## Architecture

```text
Meta / Gmail Pub/Sub / Outlook / Shopify / Stripe / SES / booking providers
            |
            v
  API Gateway (HTTP API) -> Lambda (src/lambda.ts)      one per environment
            |
            +--> {TARGET_URL}/api/channels/webhook/:provider
            +--> {TARGET_URL}/api/bookings/webhook/:provider
            +--> {TARGET_URL}/api/commerce/webhook/:provider
            +--> {TARGET_URL}/api/webhooks/stripe | ses
```

The AWS resources (Lambda, API Gateway, custom domain, settings secret, deploy role) are in `riseai-infra` (`modules/webhook-gateway`). This repo builds and deploys the code.

## Settings

The Lambda reads `riseai/<env>/webhook-gateway` from Secrets Manager on cold start: `KEY=value` lines with the variables listed under [Environment Variables](#environment-variables). Locally the same keys come from `.env`. After changing the secret, redeploy (or wait for new Lambda instances) to pick it up.

## Deploy

- **staging:** push to the `staging` branch.
- **production:** merge `staging` into `main`, then publish a GitHub release (`vX.Y.Z` on `main`).
- **rollback:** Actions > Deploy webhook gateway > Run workflow, pick a tag and the target.

Each GitHub Environment (`staging`, `production`) needs vars `AWS_DEPLOY_ROLE_ARN`, `LAMBDA_FUNCTION_NAME` and `GATEWAY_URL` (from the `webhook_gateway` Terraform output).

## Testing webhooks locally

Providers need a public HTTPS URL, so run the gateway on your machine and expose it with a tunnel:

1. Copy `.env.example` to `.env`. Set `TARGET_URLS=http://localhost:3000`, `FORWARD_SHARED_SECRET` to the same value as `WEBHOOK_GATEWAY_SHARED_SECRET` in your local `api/.env`, and the Meta verify tokens if you test Meta.
2. Start the API (`npm run start:dev` in `api`) and the gateway:
   ```bash
   pnpm install
   pnpm dev            # http://localhost:8787
   ```
3. Expose port 8787:
   - **ngrok:** `ngrok http 8787` (a free static domain keeps the URL stable between runs: `ngrok http --url=<your-name>.ngrok-free.app 8787`).
   - **VS Code:** Ports panel > Forward a Port > `8787`, then right-click > Port Visibility > **Public**.
4. Use the tunnel URL in place of `https://hooks.riseai.ai` in the provider's **dev/test app** (never the production app), e.g. `https://<tunnel>/api/webhooks/meta/instagram`. For webhooks the API registers itself (Outlook, Google Calendar, Square, Calendly, Shopify, WooCommerce), set the matching `*_WEBHOOK_URL` in your local `api/.env` to the tunnel URL.

The gateway prints `METHOD path -> status` per request; set `REDACT_LOG_BODIES=false` in `.env` to log bodies.

## Routes

- `GET /api/health`
- `GET /api/webhooks/meta/:provider` (`messenger | instagram | whatsapp`)
- `POST /api/webhooks/meta/:provider`
- `POST /api/webhooks/gmail`
- `GET /api/webhooks/outlook`
- `POST /api/webhooks/outlook`
- `POST /api/webhooks/bookings/google-calendar`
- `GET|POST /api/webhooks/bookings/outlook-calendar`
- `POST /api/webhooks/bookings/calendly`
- `POST /api/webhooks/bookings/square`
- `POST /api/webhooks/bookings/:provider` (`google_calendar | outlook_calendar | calendly | square_appointments`)
- `POST /api/webhooks/commerce/shopify`
- `POST /api/webhooks/commerce/wix`
- `POST /api/webhooks/commerce/woocommerce`
- `POST /api/webhooks/commerce/:provider` (`shopify | wix | woocommerce`)
- `POST /api/webhooks/ses` (AWS SNS: SES bounce/complaint/delivery + subscription confirmations)

## Forwarding Contract

The gateway forwards to:

- `GET|POST {TARGET_BASE_URL}/api/channels/webhook/:provider`
- `GET|POST {TARGET_BASE_URL}/api/bookings/webhook/:provider`
- `POST {TARGET_BASE_URL}/api/commerce/webhook/:provider`
- `POST {TARGET_BASE_URL}/api/webhooks/stripe`
- `POST {TARGET_BASE_URL}/api/webhooks/ses`

Headers added to forwarded requests:

- `x-webhook-gateway-secret`
- `x-webhook-gateway-provider`
- `x-webhook-gateway-received-at`
- `x-webhook-gateway-request-id`

## Environment Variables

Copy `.env.example` to `.env` and update values.

- `TARGET_URLS`
- `FORWARD_SHARED_SECRET`
- `FORWARD_TIMEOUT_MS`
- `LOG_LEVEL`
- `MESSENGER_VERIFY_TOKEN`
- `INSTAGRAM_VERIFY_TOKEN`
- `WHATSAPP_VERIFY_TOKEN`
- `TARGET_URLS_META`
- `TARGET_URLS_BOOKINGS`
- `TARGET_URLS_COMMERCE`
- `TARGET_URLS_GMAIL`
- `TARGET_URLS_OUTLOOK`
- `TARGET_URLS_MESSENGER`
- `TARGET_URLS_INSTAGRAM`
- `TARGET_URLS_WHATSAPP`
- `TARGET_URLS_GOOGLE_CALENDAR`
- `TARGET_URLS_OUTLOOK_CALENDAR`
- `TARGET_URLS_CALENDLY`
- `TARGET_URLS_SQUARE_APPOINTMENTS`
- `TARGET_URLS_SHOPIFY`
- `TARGET_URLS_WIX`
- `TARGET_URLS_WOOCOMMERCE`
- `TARGET_URLS_STRIPE`
- `TARGET_URLS_SES`
- `REQUIRE_AT_LEAST_ONE_TARGET`
- `REDACT_LOG_BODIES`

Target precedence:

1. Provider specific (`TARGET_URLS_MESSENGER`, `TARGET_URLS_GOOGLE_CALENDAR`, etc.)
2. Group specific (`TARGET_URLS_META`, `TARGET_URLS_BOOKINGS`, `TARGET_URLS_COMMERCE`, `TARGET_URLS_GMAIL`, `TARGET_URLS_OUTLOOK`)
3. Global (`TARGET_URLS`)

## Troubleshooting

- `403` on Meta verify: check provider verify token env values.
- Google Calendar/Square webhook issues: make sure provider headers like `x-goog-*` and `x-square-*` are reaching the gateway unchanged.
- `All forwarding targets failed`: verify local servers are online and reachable.
- Outlook validation issues: ensure `validationToken` is returned as plain text for both messaging and outlook calendar routes.
