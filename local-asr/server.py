from fastapi import FastAPI

from audio_stream import AudioStreamRegistry
from config import COMPUTE_TYPE, DEVICE, MODEL_NAME
from crosstalk import remember, should_suppress
from models import FlushRequest, FrameRequest, TranscriptResult
from partial_vosk import get_vosk_partial_status
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
        "voskPartial": get_vosk_partial_status(),
    }


@app.post("/frame")
def frame(request: FrameRequest):
    segment, partial = streams.push(request)
    if segment is None:
        transcripts = []
        if partial:
            timing = streams.current_partial_timing(request.sessionId, request.role, request.streamId)
            transcripts.append(
                TranscriptResult(
                    status="partial",
                    sessionId=request.sessionId,
                    role=request.role,
                    streamId=request.streamId,
                    segmentId=f"{request.sessionId}:{request.role}:{request.streamId}:{request.sequence}:partial",
                    utteranceGroupId=streams.current_group_id(request.sessionId, request.role, request.streamId),
                    text=partial,
                    finalized=False,
                    asrProvider="vosk",
                    asrModel="vosk-model-small-ja",
                    audioCapturedAt=timing.get("audioCapturedAt"),
                    speechStartedAt=timing.get("speechStartedAt"),
                    firstPartialAt=timing.get("firstPartialAt"),
                ).model_dump()
            )
        return {"ok": True, "worker": "connected", "transcripts": transcripts}

    return process_segment(request.sessionId, request.role, request.streamId, segment)


@app.post("/flush")
def flush(request: FlushRequest):
    segment = streams.flush(request)
    if segment is None:
        return {"ok": True, "worker": "connected", "transcripts": []}

    return process_segment(request.sessionId, request.role, request.streamId, segment)


def process_segment(session_id: str, role: str, stream_id: str, segment):
    try:
        text = transcribe_pcm16(segment.pcm)
        transcribed_at = utc_now_iso()
    except Exception as error:
        return {
            "ok": True,
            "worker": "connected",
            "transcripts": [
                TranscriptResult(
                    status="error",
                    sessionId=session_id,
                    role=role,
                    streamId=stream_id,
                    segmentId=segment.segment_id,
                    utteranceGroupId=segment.group_id,
                    startMs=segment.start_ms,
                    endMs=segment.end_ms,
                    startedAt=segment.started_at,
                    endedAt=segment.ended_at,
                    asrModel=MODEL_NAME,
                    reason=str(error),
                    audioCapturedAt=segment.audio_captured_at,
                    speechStartedAt=segment.speech_started_at,
                    firstPartialAt=segment.first_partial_at,
                    speechEndedDetectedAt=segment.speech_ended_detected_at,
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
                    sessionId=session_id,
                    role=role,
                    streamId=stream_id,
                    segmentId=segment.segment_id,
                    utteranceGroupId=segment.group_id,
                    startMs=segment.start_ms,
                    endMs=segment.end_ms,
                    startedAt=segment.started_at,
                    endedAt=segment.ended_at,
                    asrModel=MODEL_NAME,
                    audioCapturedAt=segment.audio_captured_at,
                    speechStartedAt=segment.speech_started_at,
                    firstPartialAt=segment.first_partial_at,
                    speechEndedDetectedAt=segment.speech_ended_detected_at,
                    transcribedAt=transcribed_at,
                ).model_dump()
            ],
        }

    suppressed, source_segment_id = should_suppress(
        session_id,
        role,
        text,
        segment.absolute_start_ms,
        segment.absolute_end_ms,
    )
    if suppressed:
        return {
            "ok": True,
            "worker": "connected",
            "transcripts": [
                TranscriptResult(
                    status="suppressed_crosstalk",
                    sessionId=session_id,
                    role=role,
                    streamId=stream_id,
                    segmentId=segment.segment_id,
                    utteranceGroupId=segment.group_id,
                    text=text,
                    startMs=segment.start_ms,
                    endMs=segment.end_ms,
                    startedAt=segment.started_at,
                    endedAt=segment.ended_at,
                    asrModel=MODEL_NAME,
                    reason=source_segment_id,
                    audioCapturedAt=segment.audio_captured_at,
                    speechStartedAt=segment.speech_started_at,
                    firstPartialAt=segment.first_partial_at,
                    speechEndedDetectedAt=segment.speech_ended_detected_at,
                    transcribedAt=transcribed_at,
                ).model_dump()
            ],
        }

    remember(
        session_id,
        role,
        text,
        segment.absolute_start_ms,
        segment.absolute_end_ms,
        segment.segment_id,
    )
    return {
        "ok": True,
        "worker": "connected",
        "transcripts": [
            TranscriptResult(
                status="accepted",
                sessionId=session_id,
                role=role,
                streamId=stream_id,
                segmentId=segment.segment_id,
                utteranceGroupId=segment.group_id,
                text=text,
                startMs=segment.start_ms,
                endMs=segment.end_ms,
                startedAt=segment.started_at,
                endedAt=segment.ended_at,
                asrModel=MODEL_NAME,
                audioCapturedAt=segment.audio_captured_at,
                speechStartedAt=segment.speech_started_at,
                firstPartialAt=segment.first_partial_at,
                speechEndedDetectedAt=segment.speech_ended_detected_at,
                transcribedAt=transcribed_at,
            ).model_dump()
        ],
    }


def utc_now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
