import base64
import uuid
from dataclasses import dataclass, field

import numpy as np

from config import END_SILENCE_MS, MIN_SPEECH_MS, SAMPLE_RATE, SPEECH_THRESHOLD
from models import FrameRequest


@dataclass
class SpeechSegment:
    segment_id: str
    group_id: str
    pcm: np.ndarray
    start_ms: int
    end_ms: int


@dataclass
class StreamState:
    role: str
    speech_started: bool = False
    speech_start_ms: int = 0
    last_speech_ms: int = 0
    received_ms: int = 0
    group_id: str = ""
    speech_chunks: list[np.ndarray] = field(default_factory=list)


class AudioStreamRegistry:
    def __init__(self) -> None:
        self._streams: dict[tuple[str, str], StreamState] = {}

    def push(self, frame: FrameRequest) -> SpeechSegment | None:
        key = (frame.sessionId, frame.streamId)
        state = self._streams.setdefault(key, StreamState(role=frame.role))
        pcm = decode_pcm16(frame.pcmBase64)
        level = max(abs(float(frame.peakLevel or 0)), rms_level(pcm))
        frame_start = state.received_ms
        frame_end = state.received_ms + int(frame.durationMs)
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
                segment = SpeechSegment(
                    segment_id=f"{state.group_id}:{frame.sequence}",
                    group_id=state.group_id,
                    pcm=np.concatenate(state.speech_chunks) if state.speech_chunks else np.array([], dtype=np.int16),
                    start_ms=state.speech_start_ms,
                    end_ms=state.last_speech_ms,
                )
                state.speech_started = False
                state.speech_chunks = []
                return segment

        return None


def decode_pcm16(value: str) -> np.ndarray:
    return np.frombuffer(base64.b64decode(value), dtype="<i2").copy()


def rms_level(pcm: np.ndarray) -> float:
    if pcm.size == 0:
        return 0.0
    values = pcm.astype(np.float32) / 32768.0
    return float(np.sqrt(np.mean(values * values)))
