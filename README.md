# Webhook Gateway (Dev Only)

A Next.js API-only service that receives platform webhooks on one public URL and forwards them to one or more local/Nest webhook endpoints.

## Architecture

```text
Meta / Gmail PubSub / Outlook / Booking Providers
            |
            v
      Vercel Webhook Gateway
            |
            +--> http://localhost:3000/api/channels/webhook/:provider
            +--> http://localhost:3001/api/channels/webhook/:provider
            +--> http://localhost:3000/api/bookings/webhook/:provider
            +--> http://localhost:3001/api/bookings/webhook/:provider
```

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

## Forwarding Contract

The gateway forwards to:

- `GET|POST {TARGET_BASE_URL}/api/channels/webhook/:provider`
- `GET|POST {TARGET_BASE_URL}/api/bookings/webhook/:provider`

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
- `TARGET_URLS_GMAIL`
- `TARGET_URLS_OUTLOOK`
- `TARGET_URLS_MESSENGER`
- `TARGET_URLS_INSTAGRAM`
- `TARGET_URLS_WHATSAPP`
- `TARGET_URLS_GOOGLE_CALENDAR`
- `TARGET_URLS_OUTLOOK_CALENDAR`
- `TARGET_URLS_CALENDLY`
- `TARGET_URLS_SQUARE_APPOINTMENTS`
- `REQUIRE_AT_LEAST_ONE_TARGET`
- `REDACT_LOG_BODIES`

Target precedence:

1. Provider specific (`TARGET_URLS_MESSENGER`, `TARGET_URLS_GOOGLE_CALENDAR`, etc.)
2. Group specific (`TARGET_URLS_META`, `TARGET_URLS_BOOKINGS`, `TARGET_URLS_GMAIL`, `TARGET_URLS_OUTLOOK`)
3. Global (`TARGET_URLS`)

## Local Run

```bash
pnpm install
pnpm dev
```

## Troubleshooting

- `403` on Meta verify: check provider verify token env values.
- Google Calendar/Square webhook issues: make sure provider headers like `x-goog-*` and `x-square-*` are reaching the gateway unchanged.
- `All forwarding targets failed`: verify local servers are online and reachable.
- Outlook validation issues: ensure `validationToken` is returned as plain text for both messaging and outlook calendar routes.
