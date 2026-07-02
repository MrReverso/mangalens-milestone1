import math
import pytest

from result_parser import (
    is_genuine_empty_recognition_result,
    parse_recognition_result,
)


@pytest.mark.parametrize("value", [
    [[("MANGALENS OCR TEST", 0.93)]],
    [("MANGALENS OCR TEST", 0.93)],
    ("MANGALENS OCR TEST", 0.93),
])
def test_valid_shapes(value):
    assert parse_recognition_result(value) == ("MANGALENS OCR TEST", 0.93)


@pytest.mark.parametrize("value", [
    None,
    [],
    [[]],
    [[()]],
    [[("text",)]],
    [[("", 0.93)]],
    [[("text", "not-a-number")]],
    [[("text", True)]],
    [[("text", float("nan"))]],
    [[("text", -0.1)]],
    [[("text", 1.1)]],
    {"text": "unexpected"},
])
def test_invalid_shapes_raise(value):
    with pytest.raises(ValueError, match=r".+"):
        parse_recognition_result(value)


def test_paddle_2_8_1_explicit_empty_sentinel():
    result = [[["", 0.0]]]
    assert is_genuine_empty_recognition_result(result)
    with pytest.raises(ValueError):
        parse_recognition_result(result)


@pytest.mark.parametrize("value", [
    None,
    [],
    [[]],
    [[("", 0.0)]],
    [[["", 0.1]]],
    [[[" ", 0.0]]],
    [[["", False]]],
])
def test_only_explicit_paddle_empty_sentinel_is_accepted(value):
    assert not is_genuine_empty_recognition_result(value)
