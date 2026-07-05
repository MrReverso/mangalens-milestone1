from authentic_benchmark import (
    aggregate_scores,
    ground_truth_coverage,
    review_result,
    text_similarity,
)


def region(text="HELLO", points=None):
    return {
        "id": "region_1",
        "text": text,
        "polygon": {"points": points or [
            {"x": 10, "y": 10}, {"x": 90, "y": 10},
            {"x": 90, "y": 40}, {"x": 10, "y": 40},
        ]},
    }


def truth(text="HELLO"):
    return {
        "id": "ground_truth_1",
        "text": text,
        "polygon": [[10, 10], [90, 10], [90, 40], [10, 40]],
    }


def test_review_records_matches_text_errors_and_false_positives():
    result = {
        "regions": [region("WRONG"), {**region("NOISE"), "id": "region_2"}],
        "errors": ["one runtime error"],
    }
    review = review_result(result, [truth()])
    assert review["matchedBubbles"] == 1
    assert review["missedBubbles"] == 0
    assert review["falsePositiveRegions"] == 1
    assert review["runtimeFailures"] == ["one runtime error"]
    assert review["unreadableOrIncorrectText"]


def test_review_records_missed_bubble():
    review = review_result({"regions": [], "errors": []}, [truth()])
    assert review["missedBubbles"] == 1
    assert review["falsePositiveRegions"] == 0


def test_geometry_and_unicode_text_similarity():
    assert ground_truth_coverage(region()["polygon"]["points"], truth()["polygon"]) == 1
    assert text_similarity("こんにちは", "こんにちは") == 1
    assert text_similarity("", "HELLO") == 0


def test_ranking_rewards_detection_and_ocr_accuracy():
    sample = {"language": "en", "pipelines": {}}
    for label in (
        "manga-image-translator-default",
        "manga-image-translator-ctd",
        "dbnet-mangaocr-paddleocr",
        "paddleocr-standalone",
    ):
        correct = label == "paddleocr-standalone"
        sample["pipelines"][label] = {
            "status": "success",
            "detectorInferenceRan": True,
            "processingTimeMs": 100,
            "review": {
                "expectedBubbles": 1,
                "matchedBubbles": int(correct),
                "falsePositiveRegions": 0,
                "runtimeFailures": [],
                "matches": [{"correct": True}] if correct else [],
            },
        }
    ranking = aggregate_scores({"samples": [sample]})
    assert ranking[0]["pipeline"] == "paddleocr-standalone"
