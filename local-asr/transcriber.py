import os
import tempfile
import wave
from functools import lru_cache

import numpy as np
from faster_whisper import WhisperModel

from config import COMPUTE_TYPE, DEVICE, MODEL_NAME, SAMPLE_RATE


@lru_cache(maxsize=1)
def get_model() -> WhisperModel:
    return WhisperModel(MODEL_NAME, device=DEVICE, compute_type=COMPUTE_TYPE)


def transcribe_pcm16(pcm: np.ndarray) -> str:
    if pcm.size == 0:
        return ""

    fd, path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)

    try:
        with wave.open(path, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(SAMPLE_RATE)
            wav.writeframes(pcm.astype("<i2").tobytes())

        segments, _info = get_model().transcribe(
            path,
            language="ja",
            task="transcribe",
            vad_filter=False,
            beam_size=1,
        )
        return " ".join(segment.text.strip() for segment in segments).strip()
    finally:
        try:
            os.remove(path)
        except FileNotFoundError:
            pass
