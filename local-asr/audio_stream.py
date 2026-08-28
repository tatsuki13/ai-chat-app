import base64
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

import numpy as np

from config import END_SILENCE_MS, MIN_SPEECH_MS, SPEECH_THRESHOLD, STREAM_TTL_MS
from models import FlushRequest, FrameRequest


@dataclass
class SpeechSegment:
    segment_id: str
    group_id: str
    pcm: np.ndarray
    start_ms: int
    end_ms: int
    absolute_start_ms: int | None = None
    absolute_end_ms: int | None = None
    started_at: str | None = None
    ended_at: str | None = None


@dataclass
class StreamState:
    role: str
    speech_started: bool = False
    speech_start_ms: int = 0
    last_speech_ms: int = 0
    received_ms: int = 0
    time_base_ms: int | None = None
    last_seen_at_ms: int = 0
    group_id: str = ""
    seen_sequences: set[int] = field(default_factory=set)
    speech_chunks: list[np.ndarray] = field(default_factory=list)


class AudioStreamRegistry:
    def __init__(self) -> None:
        self._streams: dict[tuple[str, str], StreamState] = {}

    def push(self, frame: FrameRequest) -> SpeechSegment | None:
        self.cleanup()
        key = (frame.sessionId, frame.streamId)
        state = self._streams.setdefault(key, StreamState(role=frame.role))
        if frame.sequence in state.seen_sequences:
            return None
        state.seen_sequences.add(frame.sequence)
        pcm = decode_pcm16(frame.pcmBase64)
        level = max(abs(float(frame.peakLevel or 0)), rms_level(pcm))
        frame_start = state.received_ms
        frame_end = state.received_ms + int(frame.durationMs)
        captured_end_ms = parse_timestamp_ms(frame.capturedAt)
        if captured_end_ms is not None:
            state.last_seen_at_ms = captured_end_ms
            if state.time_base_ms is None:
                state.time_base_ms = captured_end_ms - int(frame.durationMs) - frame_start
        state.received_ms = frame_end

        if level >= SPEECH_THRESHOLD:
            if not state.speech_started:
                state.speech_started = True
                state.speech_start_ms = frame_start
                state.group_id = f"{frame.sessionId}:{frame.role}:{uuid.uuid4().hex}"
                state.speech_chunks = []
            state.last_speech_ms = frame_end
            state.speech_chunks.append(pcm)
            return None

        if state.speech_started:
            state.speech_chunks.append(pcm)
            speech_ms = state.last_speech_ms - state.speech_start_ms
            silence_ms = frame_end - state.last_speech_ms
            if speech_ms >= MIN_SPEECH_MS and silence_ms >= END_SILENCE_MS:
                return self._finalize_state(state, frame.sequence)

        return None

    def flush(self, request: FlushRequest) -> SpeechSegment | None:
        key = (request.sessionId, request.streamId)
        state = self._streams.pop(key, None)
        if state is None or not state.speech_started:
            return None

        speech_ms = state.last_speech_ms - state.speech_start_ms
        if speech_ms < MIN_SPEECH_MS:
            return None

        return self._build_segment(state, "flush")

    def cleanup(self) -> None:
        if STREAM_TTL_MS <= 0:
            return
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        expired = [
            key
            for key, state in self._streams.items()
            if state.last_seen_at_ms and now_ms - state.last_seen_at_ms > STREAM_TTL_MS
        ]
        for key in expired:
            self._streams.pop(key, None)

    def _finalize_state(self, state: StreamState, sequence: int) -> SpeechSegment:
        segment = self._build_segment(state, str(sequence))
        state.speech_started = False
        state.speech_chunks = []
        return segment

    def _build_segment(self, state: StreamState, suffix: str) -> SpeechSegment:
        absolute_start_ms = (
            state.time_base_ms + state.speech_start_ms
            if state.time_base_ms is not None
            else None
        )
        absolute_end_ms = (
            state.time_base_ms + state.last_speech_ms
            if state.time_base_ms is not None
            else None
        )
        return SpeechSegment(
            segment_id=f"{state.group_id}:{suffix}",
            group_id=state.group_id,
            pcm=np.concatenate(state.speech_chunks) if state.speech_chunks else np.array([], dtype=np.int16),
            start_ms=state.speech_start_ms,
            end_ms=state.last_speech_ms,
            absolute_start_ms=absolute_start_ms,
            absolute_end_ms=absolute_end_ms,
            started_at=format_timestamp_ms(absolute_start_ms),
            ended_at=format_timestamp_ms(absolute_end_ms),
        )


def decode_pcm16(value: str) -> np.ndarray:
    return np.frombuffer(base64.b64decode(value), dtype="<i2").copy()


def rms_level(pcm: np.ndarray) -> float:
    if pcm.size == 0:
        return 0.0
    values = pcm.astype(np.float32) / 32768.0
    return float(np.sqrt(np.mean(values * values)))


def parse_timestamp_ms(value: str) -> int | None:
    try:
        normalized = value.replace("Z", "+00:00")
        return int(datetime.fromisoformat(normalized).timestamp() * 1000)
    except Exception:
        return None


def format_timestamp_ms(value: int | None) -> str | None:
    if value is None:
        return None
    return datetime.fromtimestamp(value / 1000, timezone.utc).isoformat().replace("+00:00", "Z")
