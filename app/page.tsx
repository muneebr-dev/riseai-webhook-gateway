export default function HomePage() {
  return (
    <main
      style={{
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        padding: "24px",
        lineHeight: 1.6,
      }}
    >
      <h1 style={{ marginBottom: "12px" }}>Webhook Gateway (Dev)</h1>
      <p style={{ marginBottom: "16px" }}>
        This service receives public webhooks and forwards them to local/Nest
        targets.
      </p>

      <h2 style={{ marginTop: "16px", marginBottom: "8px" }}>
        Available Routes
      </h2>
      <ul>
        <li>
          <code>GET /api/health</code>
        </li>
        <li>
          <code>GET|POST /api/webhooks/meta/:provider</code> where provider is{" "}
          <code>messenger|instagram|whatsapp</code>
        </li>
        <li>
          <code>POST /api/webhooks/gmail</code>
        </li>
        <li>
          <code>GET|POST /api/webhooks/outlook</code>
        </li>
      </ul>

      <h2 style={{ marginTop: "16px", marginBottom: "8px" }}>Quick Start</h2>
      <ol>
        <li>
          Set <code>TARGET_URLS</code> and <code>FORWARD_SHARED_SECRET</code> in{" "}
          <code>webhook-gateway/.env</code>.
        </li>
        <li>
          Set <code>WEBHOOK_GATEWAY_SHARED_SECRET</code> in{" "}
          <code>api/.env</code> to the same value.
        </li>
        <li>
          Run gateway: <code>pnpm dev</code>
        </li>
        <li>
          Run API: <code>npm run start:dev</code>
        </li>
      </ol>

      <h2 style={{ marginTop: "16px", marginBottom: "8px" }}>
        Verification Examples
      </h2>
      <pre
        style={{ background: "#f5f5f5", padding: "12px", overflowX: "auto" }}
      >
        {`curl -i "http://localhost:3000/api/webhooks/meta/messenger?hub.mode=subscribe&hub.verify_token=msg-token&hub.challenge=12345"

curl -i "http://localhost:3000/api/webhooks/outlook?validationToken=abc123"`}
      </pre>

      <p style={{ marginTop: "16px" }}>
        See <code>README.md</code> for full env and troubleshooting details.
      </p>
    </main>
  );
}
