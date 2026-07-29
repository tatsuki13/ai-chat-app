# Secure Remote Smartphone Microphone Setup

This project keeps the Next.js dev server bound to `localhost` and exposes it
only through Tailscale Serve. Do not use Tailscale Funnel, Cloudflare Quick
Tunnel, or `next dev --hostname 0.0.0.0` for research sessions that contain
sensitive conversation data.

## Environment

Set these values on the PC that runs Next.js:

```env
REMOTE_MIC_ENABLED=true
REMOTE_MIC_BASE_URL=https://YOUR-PC-NAME.YOUR-TAILNET.ts.net
REMOTE_MIC_TOKEN_TTL_SECONDS=300
REMOTE_MIC_STORE_RAW_AUDIO=false
REMOTE_MIC_DEDUP_ENABLED=true
REMOTE_MIC_COOKIE_SECRET=replace-with-a-long-random-secret
```

In production or public hosting, leave `REMOTE_MIC_ENABLED` unset or set it to
`false`.

## PC Setup

1. Install Tailscale on Windows.
2. Sign in to the same tailnet that will be used by the two smartphones.
3. Start the Next.js app locally:

```powershell
npm run dev
```

4. Configure Tailscale Serve to forward HTTPS traffic to local Next.js.

The exact Tailscale CLI syntax depends on the installed version. Check it on
the PC:

```powershell
tailscale serve --help
```

Use the command form documented by that output to serve `http://localhost:3000`
over the device's `https://*.ts.net` address.

## Smartphone Setup

1. Install Tailscale on both smartphones.
2. Sign in to the same tailnet as the PC.
3. Open the PC app from the Tailscale HTTPS URL.
4. Create the experiment session.
5. Scan the "本人用マイク" QR with the older adult's phone.
6. Scan the "介護者用マイク" QR with the caregiver's phone.
7. On each phone, confirm the displayed role and tap "マイク開始".

The QR token is one-time use and expires quickly. If a scan fails, use "QRを再発行"
on the PC screen.

## Safety Notes

- QR URLs contain a one-time token, not the raw session ID.
- Tokens are stored only as SHA-256 hashes in the database.
- The token is exchanged for an HttpOnly, Secure, SameSite=Strict cookie.
- After exchange, `/mic/join` removes the token from the browser address bar.
- Raw audio is not stored when `REMOTE_MIC_STORE_RAW_AUDIO=false`.
- Smartphone microphone APIs are disabled unless `REMOTE_MIC_ENABLED=true`.
- The health endpoint is `/api/remote-mic/health`; it does not return API keys,
  tokens, session IDs, participant names, or conversation text.

## Troubleshooting

- If the phone says HTTPS is required, make sure the page is opened through the
  `https://*.ts.net` Tailscale Serve URL.
- If the QR is expired or already used, reissue QR codes on the PC screen.
- If audio stops arriving, confirm both devices are still connected to Tailscale.
- If WSL is used for Next.js and Windows runs Tailscale, first confirm that
  Windows can open `http://localhost:3000`. If not, fix WSL localhost forwarding
  before configuring Serve.
