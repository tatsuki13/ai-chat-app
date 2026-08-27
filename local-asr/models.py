from pydantic import BaseModel


class FrameRequest(BaseModel):
    sessionId: str
    role: str
    streamId: str
    sequence: int
    capturedAt: str
    durationMs: int
    sampleRate: int
    averageLevel: float | None = None
    peakLevel: float | None = None
    pcmBase64: str


class TranscriptResult(BaseModel):
    status: str
    sessionId: str
    role: str
    streamId: str
    segmentId: str
    utteranceGroupId: str
    text: str = ""
    startMs: int | None = None
    endMs: int | None = None
    finalized: bool = True
    asrProvider: str = "local-asr"
    asrModel: str | None = None
    reason: str | None = None
