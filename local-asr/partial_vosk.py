import json
import os
from functools import lru_cache

import numpy as np

from config import SAMPLE_RATE, VOSK_MODEL_PATH, VOSK_PARTIAL_ENABLED


def get_vosk_partial_status() -> dict:
    if not VOSK_PARTIAL_ENABLED:
        return {
            "enabled": False,
            "available": False,
            "modelPath": VOSK_MODEL_PATH,
            "reason": "disabled",
        }
    if not VOSK_MODEL_PATH or not os.path.isdir(VOSK_MODEL_PATH):
        return {
            "enabled": True,
            "available": False,
            "modelPath": VOSK_MODEL_PATH,
            "reason": "model_not_found",
        }

    return {
        "enabled": True,
        "available": True,
        "modelPath": VOSK_MODEL_PATH,
        "reason": None,
    }


@lru_cache(maxsize=1)
def get_vosk_model():
    if not VOSK_PARTIAL_ENABLED:
        return None
    if not VOSK_MODEL_PATH or not os.path.isdir(VOSK_MODEL_PATH):
        return None

    try:
        from vosk import Model

        return Model(VOSK_MODEL_PATH)
    except Exception as error:
        print(f"[vosk partial disabled] {error}", flush=True)
        return None


class VoskPartialRecognizer:
    def __init__(self) -> None:
        self._recognizer = None
        self._last_partial = ""

    def available(self) -> bool:
        return get_vosk_model() is not None

    def reset(self) -> None:
        self._recognizer = None
        self._last_partial = ""

    def accept_pcm16(self, pcm: np.ndarray) -> str:
        model = get_vosk_model()
        if model is None or pcm.size == 0:
            return ""

        try:
            if self._recognizer is None:
                from vosk import KaldiRecognizer

                self._recognizer = KaldiRecognizer(model, SAMPLE_RATE)

            self._recognizer.AcceptWaveform(pcm.astype("<i2").tobytes())
            raw_result = self._recognizer.PartialResult()
            partial = json.loads(raw_result).get("partial", "")
            if not isinstance(partial, str):
                return ""

            partial = partial.strip()
            if not partial or partial == self._last_partial:
                return ""

            self._last_partial = partial
            return partial
        except Exception as error:
            print(f"[vosk partial stream disabled] {error}", flush=True)
            self.reset()
            return ""
