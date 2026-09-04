import os

SAMPLE_RATE = 16000
MODEL_NAME = os.getenv("LOCAL_ASR_MODEL", "small")
DEVICE = os.getenv("LOCAL_ASR_DEVICE", "cpu")
COMPUTE_TYPE = os.getenv("LOCAL_ASR_COMPUTE_TYPE", "int8")
MIN_SPEECH_MS = int(os.getenv("LOCAL_ASR_MIN_SPEECH_MS", "80"))
END_SILENCE_MS = int(os.getenv("LOCAL_ASR_END_SILENCE_MS", "700"))
SPEECH_THRESHOLD = float(os.getenv("LOCAL_ASR_SPEECH_THRESHOLD", "0.015"))
CROSSTALK_WINDOW_MS = int(os.getenv("LOCAL_ASR_CROSSTALK_WINDOW_MS", "900"))
CROSSTALK_SIMILARITY = float(os.getenv("LOCAL_ASR_CROSSTALK_SIMILARITY", "0.82"))
STREAM_TTL_MS = int(os.getenv("LOCAL_ASR_STREAM_TTL_MS", "300000"))
PREROLL_MS = int(os.getenv("LOCAL_ASR_PREROLL_MS", "200"))
VOSK_PARTIAL_ENABLED = os.getenv("LOCAL_ASR_VOSK_PARTIAL_ENABLED", "true").lower() not in {
    "0",
    "false",
    "no",
}
VOSK_MODEL_PATH = os.getenv("LOCAL_ASR_VOSK_MODEL_PATH", "models/vosk-model-small-ja-0.22")
