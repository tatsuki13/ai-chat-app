import re
from difflib import SequenceMatcher
from time import time

from config import CROSSTALK_SIMILARITY, CROSSTALK_WINDOW_MS

_recent: dict[str, list[dict]] = {}


def normalize_text(value: str) -> str:
    return re.sub(r"[\s、。,.!?！？「」『』（）()]+", "", value.lower())


def should_suppress(session_id: str, role: str, text: str, start_ms: int | None, end_ms: int | None) -> tuple[bool, str | None]:
    normalized = normalize_text(text)
    if len(normalized) < 8:
        return False, None

    now = time()
    entries = [entry for entry in _recent.get(session_id, []) if now - entry["seen_at"] <= 10]
    _recent[session_id] = entries
    opposite = "caregiver" if role == "elder" else "elder"

    for entry in entries:
        if entry["role"] != opposite:
            continue
        if not ranges_overlap(start_ms, end_ms, entry["start_ms"], entry["end_ms"]):
            continue
        similarity = SequenceMatcher(None, normalized, normalize_text(entry["text"])).ratio()
        if similarity >= CROSSTALK_SIMILARITY:
            return True, entry["segment_id"]

    return False, None


def remember(session_id: str, role: str, text: str, start_ms: int | None, end_ms: int | None, segment_id: str | None = None) -> None:
    _recent.setdefault(session_id, []).append({
        "role": role,
        "text": text,
        "start_ms": start_ms,
        "end_ms": end_ms,
        "segment_id": segment_id,
        "seen_at": time(),
    })


def ranges_overlap(a_start: int | None, a_end: int | None, b_start: int | None, b_end: int | None) -> bool:
    if a_start is None or a_end is None or b_start is None or b_end is None:
        return True
    overlap = min(a_end, b_end) - max(a_start, b_start)
    return overlap >= CROSSTALK_WINDOW_MS or overlap > 0
