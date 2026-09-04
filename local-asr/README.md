# Local ASR Worker

Fixed smartphone microphones send 16 kHz mono PCM frames to this worker through
Next.js. The worker performs local speech segmentation, transcription, basic
crosstalk suppression, and returns finalized utterances to Next.js.

## Start

```bash
cd local-asr
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn server:app --host 127.0.0.1 --port 8765
```

## Environment

```env
LOCAL_ASR_MODEL=small
LOCAL_ASR_DEVICE=cpu
LOCAL_ASR_COMPUTE_TYPE=int8
LOCAL_ASR_END_SILENCE_MS=700
LOCAL_ASR_MIN_SPEECH_MS=80
LOCAL_ASR_SPEECH_THRESHOLD=0.015
LOCAL_ASR_STREAM_TTL_MS=300000
LOCAL_ASR_PREROLL_MS=200
LOCAL_ASR_VOSK_PARTIAL_ENABLED=true
LOCAL_ASR_VOSK_MODEL_PATH=models/vosk-model-small-ja-0.22
```

Next.js talks to `http://127.0.0.1:8765` by default. Override with:

```env
LOCAL_ASR_BASE_URL=http://127.0.0.1:8765
```

## Vosk partial transcripts

Vosk is used only for in-progress partial display. Final utterances continue to
come from faster-whisper.

Download the Japanese small model and place the extracted directory here:

```text
local-asr/models/vosk-model-small-ja-0.22
```

If the model is missing, disabled, or cannot be initialized, the worker keeps
running and only partial display is disabled.
