# Fixed Smartphone Mic Realtime Implementation

## Data Flow

The fixed smartphone microphones use OpenAI Realtime transcription.

1. PC opens `/session` and activates the current DB-backed fixed mic session.
2. Smartphones open `/mic/elder` and `/mic/caregiver` over the HTTPS Tailscale URL.
3. Each smartphone requests `/api/remote-mic/realtime/session`.
4. The server creates a short-lived OpenAI Realtime client secret. The API key remains server-side.
5. Each smartphone connects directly to OpenAI Realtime over WebRTC.
6. OpenAI emits `conversation.item.input_audio_transcription.delta`; the smartphone publishes cumulative partial text to `/api/ai/speech-state/control`.
7. The PC subscribes to `/api/ai/speech-state/stream` and updates the same live bubble by `sessionId + role + streamId + transcriptId`.
8. OpenAI emits `conversation.item.input_audio_transcription.completed`; the smartphone publishes final text immediately to the PC and stores the final in its pending queue.
9. The smartphone posts final-only data to `/api/remote-mic/realtime/transcript`.
10. The transcript API saves idempotently with `remoteStreamId`, `remoteTranscriptId`, `sourceGroupId`, and `asrProvider = openai-realtime`.
11. The PC keeps 3 second DB polling for reconciliation and replaces saved live finals by identifier.

Audio data is sent only from the smartphone browser to OpenAI Realtime. The app event stream carries text and control events only.

## Environment Variables

- `OPENAI_API_KEY`: required on the Next.js server to create Realtime client secrets.
- `OPENAI_REALTIME_TRANSCRIBE_MODEL`: optional, defaults to `gpt-4o-transcribe`.
- `OPENAI_REALTIME_TRANSCRIBE_PROMPT`: optional prompt override.
- `OPENAI_REALTIME_VAD_SILENCE_MS`: optional server VAD silence duration, default `700`.
- `OPENAI_REALTIME_VAD_THRESHOLD`: optional server VAD threshold, default `0.5`.
- `OPENAI_TRANSCRIBE_MODEL` / `OPENAI_TRANSCRIBE_PROMPT`: still used by the separate PC built-in microphone transcription path.
- `NEXT_PUBLIC_BROWSER_SPEECH_ENABLED`: optional browser speech synthesis toggle.
- `NEXT_PUBLIC_AUDIO_TRANSCRIPTION`: optional PC built-in microphone transcription toggle.

## Runtime Constraints

The control stream is an in-memory Server-Sent Events fanout in the current Next.js process. It is intended for the current local experiment where the PC and smartphones use the same PC-hosted Next.js server through Tailscale Serve. It is not multi-instance safe as-is.

The active fixed mic session is stored in the database. The in-memory role state is a runtime cache for heartbeats, UI status, and low-latency event routing.

## OpenAI Realtime

The session endpoint creates a transcription session and returns only the short-lived client secret to the smartphone. The browser connects to OpenAI via WebRTC and listens for:

- `input_audio_buffer.speech_started`
- `conversation.item.input_audio_transcription.delta`
- `conversation.item.input_audio_transcription.completed`
- `error`

The app does not enable OpenAI audio responses for the smartphone mic path. AI voice playback is handled by browser `speechSynthesis` on the PC.

## Partial And Final Handling

- Partial text is display-only and is not written to the database.
- Partial updates are keyed by `sessionId + role + streamId + transcriptId`.
- Older revisions are ignored.
- Final text updates the same live bubble and is then saved asynchronously.
- Final save uses `source = remote_realtime:${streamId}:${transcriptId}` and `sourceGroupId = transcriptId`.
- Re-sending the same final is idempotent.
- Realtime remote utterances are not merged into prior same-speaker utterances.

## AI Speech Mute Flow

Before PC speech playback:

1. PC waits for any active human speech to finalize.
2. PC publishes `speech.prepare`.
3. Elder and caregiver phones disable their audio track and ACK `mic.suppressed`.
4. PC starts browser speech only after both ACKs arrive.
5. `SpeechSynthesisUtterance.onstart` records actual playback start.
6. `onend` or `onerror` records actual playback end.
7. PC publishes `speech.ended` or `speech.cancelled`.
8. Phones wait for the echo guard, re-enable live audio tracks, and ACK `mic.resumed`.
9. The topic timer resumes only after both resume ACKs arrive.

AI speech temporary mute does not close the DataChannel, RTCPeerConnection, MediaStreamTrack, MediaStream, or OpenAI Realtime connection.

## Reconnection And Stream Identity

Every Realtime connection gets a new `streamId`. Reconnection keeps pending final transcripts from old streams. Old-stream finals can still be saved, while old-stream partial updates do not overwrite current-stream partials.

Reconnect is attempted for actual transport failures such as failed peer state, closed data channel, timed-out disconnected state, or ended tracks. Session end and manual stop do not auto-reconnect.

## Question Generation Boundary

Question generation uses only DB-persisted final utterances.

Before generating or displaying a prepared question, the PC:

1. Waits up to 5 seconds for active human speech to finalize.
2. Commits PC-local pending utterances.
3. Sends `transcript.flush_request` to both smartphones.
4. Requires elder and caregiver `transcript.flush_ack` with `outcome = complete` and `pendingCount = 0`.
5. Refetches the session detail from the database.
6. Rejects stale prepared questions whose `basedOnUtteranceId` or slot revision no longer matches.

The same persisted-conversation preparation is used before slot updates, topic transitions, and final minutes generation.

## Migration

The Realtime utterance identity migration adds nullable columns to `utterances`:

- `remote_stream_id`
- `remote_transcript_id`
- `capture_epoch`
- `captured_during_ai_speech`
- `ai_playback_id_at_capture`
- `first_partial_at`
- `finalized_at`

It also adds indexes and a unique key on `session_id, speaker, remote_stream_id, remote_transcript_id`. Existing data is not deleted. Apply migrations with the normal Prisma deployment process for the target environment; do not use `prisma migrate reset`.

## Device Test Procedure

1. Start the Next.js dev server.
2. Open `/session` on the PC.
3. Open `/mic/elder` and `/mic/caregiver` on two smartphones using the HTTPS `.ts.net` URL.
4. Confirm both phones show Realtime connected and the PC shows both mics connected.
5. Start the session from the PC.
6. Speak from the elder phone and confirm partial appears within about 1 second.
7. Speak from the caregiver phone and confirm role separation.
8. Speak short acknowledgements such as "はい", "うん", and "ん".
9. Speak slowly and with a correction mid-utterance.
10. Overlap speech briefly and confirm crosstalk suppression only affects DB final saving.
11. Press question generation immediately after speech and confirm final flush occurs before generation.
12. Confirm AI playback mutes both phones before speech starts.
13. Speak during AI playback and confirm it is not saved.
14. Speak immediately after playback and confirm recognition resumes without a new Realtime connection in the normal case.
15. Temporarily disconnect one phone network and confirm reconnect status.
16. Disconnect one phone during AI playback and confirm the PC reports the missing ACK.
17. Reload a phone page and confirm it reconnects without changing `dialogueStartedAt`.
18. Disconnect during final save and confirm pending final retry or flush preserves it.
19. End the session and confirm phones do not reconnect or continue recognition.
20. Check DB rows for role, timestamps, `remote_stream_id`, `remote_transcript_id`, and duplicate count.

## Known Limits

- The SSE fanout is in-memory and local-experiment oriented.
- Browser `speechSynthesis` timing depends on the PC browser and OS voice engine.
- There is no per-device authentication beyond the current active session and role checks.
- Real-world latency and partial timing must be measured on the actual phones and network.
