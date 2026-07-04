import math


def is_genuine_empty_recognition_result(result) -> bool:
    """Recognize PaddleOCR 2.8.1's explicit rec-only empty sentinel.

    The pinned PaddleOCR 2.8.1 runtime returns ``[[("", 0.0)]]`` for the
    single blank-image recognition-only probe: one page list containing one
    ``(text, confidence)`` tuple.
    """
    if not isinstance(result, list) or len(result) != 1:
        return False
    batch = result[0]
    if not isinstance(batch, list) or len(batch) != 1:
        return False
    item = batch[0]
    return (
        isinstance(item, tuple)
        and len(item) == 2
        and item[0] == ""
        and isinstance(item[1], (int, float))
        and not isinstance(item[1], bool)
        and float(item[1]) == 0.0
    )


def describe_result_shape(result) -> str:
    if result is None:
        return "None"
    if isinstance(result, tuple):
        return f"tuple[{len(result)}]"
    if isinstance(result, list):
        if not result:
            return "list[0]"
        first = result[0]
        if isinstance(first, list):
            inner = first[0] if first else None
            return f"list[{len(result)}] -> list[{len(first)}] -> {type(inner).__name__}"
        return f"list[{len(result)}] -> {type(first).__name__}"
    return type(result).__name__


def parse_recognition_result(result) -> tuple[str, float]:
    candidate = result
    if isinstance(candidate, list):
        if len(candidate) != 1:
            raise ValueError(f"Expected one recognition item; observed {describe_result_shape(result)}")
        candidate = candidate[0]
        if isinstance(candidate, list):
            if len(candidate) != 1:
                raise ValueError(f"Expected one nested recognition item; observed {describe_result_shape(result)}")
            candidate = candidate[0]

    if not isinstance(candidate, tuple) or len(candidate) != 2:
        raise ValueError(f"Expected a (text, confidence) tuple; observed {describe_result_shape(result)}")

    text, confidence = candidate
    if not isinstance(text, str):
        raise ValueError("Recognition text must be a string")
    text = text.strip()
    if not text:
        raise ValueError("Recognition text must be non-empty")
    if isinstance(confidence, bool) or not isinstance(confidence, (int, float)):
        raise ValueError("Recognition confidence must be a number, not bool")
    confidence = float(confidence)
    if not math.isfinite(confidence):
        raise ValueError("Recognition confidence must be finite")
    if confidence < 0.0 or confidence > 1.0:
        raise ValueError("Recognition confidence must be between 0.0 and 1.0")
    return text, confidence
