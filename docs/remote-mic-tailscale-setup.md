# Fixed Smartphone Microphone Setup

The current remote microphone path is fixed-phone Local ASR only:

```text
/mic/elder or /mic/caregiver
-> AudioWorklet
-> 16 kHz PCM frames
-> /api/remote-mic/local/frame
-> Local ASR Worker
-> utterances
-> PC /session
```

Retired pairing, browser-to-browser audio transfer, and chunk polling paths are
not part of the current fixed-phone setup.

## Environment

Run Next.js on the PC and expose it through Tailscale Serve. The app talks to
the Local ASR Worker on the same PC by default:

```env
LOCAL_ASR_BASE_URL=http://127.0.0.1:8765
LOCAL_ASR_TIMEOUT_MS=8000
LOCAL_ASR_MODEL=small
LOCAL_ASR_DEVICE=cpu
LOCAL_ASR_COMPUTE_TYPE=int8
LOCAL_ASR_END_SILENCE_MS=1200
LOCAL_ASR_MIN_SPEECH_MS=200
LOCAL_ASR_SPEECH_THRESHOLD=0.015
LOCAL_ASR_STREAM_TTL_MS=300000
```

No pairing-token or raw-audio chunk settings are needed for this path.

## PC Setup

1. Install Tailscale on Windows.
2. Sign in to the same tailnet that will be used by the two smartphones.
3. Start the Local ASR Worker:

```powershell
npm run asr:start
```

4. Start Next.js locally:

```powershell
npm run dev
```

5. Configure Tailscale Serve to forward HTTPS traffic to `http://localhost:3000`.

Check the command form supported by the installed Tailscale version:

```powershell
tailscale serve --help
```

## Smartphone Setup

1. Install Tailscale on both smartphones.
2. Sign in to the same tailnet as the PC.
3. On the PC `/session` screen, set the participant ID and start/connect the session.
4. Open these fixed URLs from the Tailscale HTTPS host:

```text
https://YOUR-PC-NAME.YOUR-TAILNET.ts.net/mic/elder
https://YOUR-PC-NAME.YOUR-TAILNET.ts.net/mic/caregiver
```

5. Tap the connection refresh button if the PC session was changed after the
   phone page was opened.
6. Tap the microphone start button on each phone.

## Runtime State

`RemoteMicActiveSession` in the database is the source of truth for the active
session. The in-process runtime store is only short-lived state for role
connection, mute, transmitting, last seen, and AI speech pause coordination.

## Troubleshooting

- If the phone says HTTPS is required, open the page through the `https://*.ts.net`
  Tailscale Serve URL.
- If the phone says the Local ASR Worker is unavailable, start `npm run asr:start`
  on the PC and check `/api/remote-mic/local/health`.
- If the PC session changes while a phone is streaming, the phone stops the old
  stream, fetches `/api/remote-mic/fixed/current` once, and starts a new stream
  when possible.
- When the microphone is stopped, the phone asks `/api/remote-mic/local/flush`
  to finalize any buffered speech before the stream is closed.
