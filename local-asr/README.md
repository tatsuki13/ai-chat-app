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
LOCAL_ASR_END_SILENCE_MS=1200
LOCAL_ASR_MIN_SPEECH_MS=200
LOCAL_ASR_SPEECH_THRESHOLD=0.015
LOCAL_ASR_STREAM_TTL_MS=300000
```

Next.js talks to `http://127.0.0.1:8765` by default. Override with:

```env
LOCAL_ASR_BASE_URL=http://127.0.0.1:8765
```
