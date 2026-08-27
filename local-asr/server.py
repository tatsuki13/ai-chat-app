from fastapi import FastAPI

from audio_stream import AudioStreamRegistry
from config import COMPUTE_TYPE, DEVICE, MODEL_NAME
from crosstalk import remember, should_suppress
from models import FrameRequest, TranscriptResult
from transcriber import transcribe_pcm16

app = FastAPI(title="Local ASR Worker")
streams = AudioStreamRegistry()


@app.get("/health")
def health():
    return {
        "ok": True,
        "worker": "connected",
        "model": MODEL_NAME,
        "device": DEVICE,
        "computeType": COMPUTE_TYPE,
    }


@app.post("/frame")
def frame(request: FrameRequest):
    segment = streams.push(request)
    if segment is None:
        return {"ok": True, "worker": "connected", "transcripts": []}

    try:
        text = transcribe_pcm16(segment.pcm)
    except Exception as error:
        return {
            "ok": True,
            "worker": "connected",
            "transcripts": [
                TranscriptResult(
                    status="error",
                    sessionId=request.sessionId,
                    role=request.role,
                    streamId=request.streamId,
                    segmentId=segment.segment_id,
                    utteranceGroupId=segment.group_id,
                    startMs=segment.start_ms,
                    endMs=segment.end_ms,
                    asrModel=MODEL_NAME,
                    reason=str(error),
                ).model_dump()
            ],
        }

    if not text:
        return {
            "ok": True,
            "worker": "connected",
            "transcripts": [
                TranscriptResult(
                    status="empty",
                    sessionId=request.sessionId,
                    role=request.role,
                    streamId=request.streamId,
                    segmentId=segment.segment_id,
                    utteranceGroupId=segment.group_id,
                    startMs=segment.start_ms,
                    endMs=segment.end_ms,
                    asrModel=MODEL_NAME,
                ).model_dump()
            ],
        }

    suppressed, source_segment_id = should_suppress(
        request.sessionId,
        request.role,
        text,
        segment.start_ms,
        segment.end_ms,
    )
    if suppressed:
        return {
            "ok": True,
            "worker": "connected",
            "transcripts": [
                TranscriptResult(
                    status="suppressed_crosstalk",
                    sessionId=request.sessionId,
                    role=request.role,
                    streamId=request.streamId,
                    segmentId=segment.segment_id,
                    utteranceGroupId=segment.group_id,
                    text=text,
                    startMs=segment.start_ms,
                    endMs=segment.end_ms,
                    asrModel=MODEL_NAME,
                    reason=source_segment_id,
                ).model_dump()
            ],
        }

    remember(
        request.sessionId,
        request.role,
        text,
        segment.start_ms,
        segment.end_ms,
        segment.segment_id,
    )
    return {
        "ok": True,
        "worker": "connected",
        "transcripts": [
            TranscriptResult(
                status="accepted",
                sessionId=request.sessionId,
                role=request.role,
                streamId=request.streamId,
                segmentId=segment.segment_id,
                utteranceGroupId=segment.group_id,
                text=text,
                startMs=segment.start_ms,
                endMs=segment.end_ms,
                asrModel=MODEL_NAME,
            ).model_dump()
        ],
    }
