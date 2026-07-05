#!/usr/bin/env python3
import json
import os
import re
import shutil
from difflib import SequenceMatcher
from pathlib import Path

import cv2

from orchestrator import PipelineRunner, draw_annotations, generate_comparison_html, write_image


SAMPLE_DIR = Path(os.environ.get("OCR_BENCHMARK_SAMPLE_DIR", "/app/samples/benchmark_dataset"))
OUTPUT_DIR = Path(os.environ.get("OCR_BENCHMARK_OUTPUT_DIR", "/app/results/authentic"))
PIPELINES = (
    "manga-image-translator-default",
    "manga-image-translator-ctd",
    "dbnet-mangaocr-paddleocr",
    "paddleocr-standalone",
)
COLORS = {
    "manga-image-translator-default": (0, 200, 0),
    "manga-image-translator-ctd": (200, 200, 0),
    "dbnet-mangaocr-paddleocr": (200, 0, 200),
    "paddleocr-standalone": (0, 128, 255),
}
COMPLEXITY_SCORE = {
    "manga-image-translator-default": 0.8,
    "manga-image-translator-ctd": 0.5,
    "dbnet-mangaocr-paddleocr": 0.5,
    "paddleocr-standalone": 1.0,
}


def normalized_text(value):
    return re.sub(r"[^\w]+", "", str(value), flags=re.UNICODE).casefold()


def text_similarity(actual, expected):
    left, right = normalized_text(actual), normalized_text(expected)
    if not left or not right:
        return 0.0
    return SequenceMatcher(None, left, right).ratio()


def polygon_bounds(points):
    coordinates = [
        (float(point["x"]), float(point["y"])) if isinstance(point, dict)
        else (float(point[0]), float(point[1]))
        for point in points
    ]
    xs, ys = zip(*coordinates)
    return min(xs), min(ys), max(xs), max(ys)


def ground_truth_coverage(detected_points, truth_points):
    dx1, dy1, dx2, dy2 = polygon_bounds(detected_points)
    tx1, ty1, tx2, ty2 = polygon_bounds(truth_points)
    intersection = max(0.0, min(dx2, tx2) - max(dx1, tx1)) * max(
        0.0, min(dy2, ty2) - max(dy1, ty1)
    )
    truth_area = max(1.0, (tx2 - tx1) * (ty2 - ty1))
    return intersection / truth_area


def review_result(result, ground_truth):
    matches = []
    unmatched_detected = set(range(len(result.get("regions", []))))
    for truth in ground_truth:
        best = None
        for index in unmatched_detected:
            region = result["regions"][index]
            coverage = ground_truth_coverage(
                region["polygon"]["points"], truth["polygon"]
            )
            if best is None or coverage > best[0]:
                best = (coverage, index)
        if best and best[0] >= 0.25:
            unmatched_detected.remove(best[1])
            region = result["regions"][best[1]]
            similarity = text_similarity(region.get("text", ""), truth["text"])
            matches.append({
                "groundTruthId": truth["id"],
                "regionId": region["id"],
                "expectedText": truth["text"],
                "recognizedText": region.get("text", ""),
                "coverage": round(best[0], 4),
                "textSimilarity": round(similarity, 4),
                "correct": similarity >= 0.6,
            })

    missed_ids = [
        truth["id"]
        for truth in ground_truth
        if truth["id"] not in {match["groundTruthId"] for match in matches}
    ]
    incorrect = [
        {
            "groundTruthId": match["groundTruthId"],
            "expectedText": match["expectedText"],
            "recognizedText": match["recognizedText"],
            "textSimilarity": match["textSimilarity"],
        }
        for match in matches
        if not match["correct"]
    ]
    return {
        "expectedBubbles": len(ground_truth),
        "matchedBubbles": len(matches),
        "missedBubbles": len(missed_ids),
        "missedBubbleIds": missed_ids,
        "falsePositiveRegions": len(unmatched_detected),
        "falsePositiveRegionIds": [
            result["regions"][index]["id"] for index in sorted(unmatched_detected)
        ],
        "unreadableOrIncorrectText": incorrect,
        "runtimeFailures": list(result.get("errors", [])),
        "matches": matches,
    }


def execute_pipeline(runner, label, image_path, image, language):
    if label == "manga-image-translator-default":
        return runner.execute_pipeline_a(str(image_path), image, language)
    if label == "manga-image-translator-ctd":
        return runner.execute_hybrid_pipeline(
            str(image_path), image, language, "ctd", label
        )
    if label == "dbnet-mangaocr-paddleocr":
        return runner.execute_hybrid_pipeline(
            str(image_path), image, language, "dbconvnext", label
        )
    return runner.execute_pipeline_d(str(image_path), image, language)


def aggregate_scores(report):
    totals = {
        label: {
            "expected": 0, "matched": 0, "correct": 0, "falsePositives": 0,
            "runtimeFailures": 0, "timeMs": 0, "samples": 0, "languages": set(),
        }
        for label in PIPELINES
    }
    for sample in report["samples"]:
        for label, result in sample["pipelines"].items():
            review = result["review"]
            total = totals[label]
            total["expected"] += review["expectedBubbles"]
            total["matched"] += review["matchedBubbles"]
            total["correct"] += sum(match["correct"] for match in review["matches"])
            total["falsePositives"] += review["falsePositiveRegions"]
            total["runtimeFailures"] += len(review["runtimeFailures"])
            total["timeMs"] += result["processingTimeMs"]
            total["samples"] += 1
            if result["status"] in ("success", "no_text") and result.get("detectorInferenceRan"):
                total["languages"].add(sample["language"])

    ranking = []
    for label, total in totals.items():
        expected = max(1, total["expected"])
        detected = total["matched"] + total["falsePositives"]
        precision = total["matched"] / detected if detected else 0.0
        recall = total["matched"] / expected
        detection_f1 = (
            2 * precision * recall / (precision + recall)
            if precision + recall else 0.0
        )
        ocr_accuracy = total["correct"] / expected
        language_support = len(total["languages"]) / 3
        average_time = total["timeMs"] / max(1, total["samples"])
        speed_score = 1 / (1 + average_time / 5000)
        failure_penalty = min(0.5, total["runtimeFailures"] * 0.1)
        score = max(0.0, (
            detection_f1 * 0.40
            + ocr_accuracy * 0.35
            + language_support * 0.10
            + speed_score * 0.10
            + COMPLEXITY_SCORE[label] * 0.05
            - failure_penalty
        ))
        ranking.append({
            "pipeline": label,
            "score": round(score, 4),
            "detectionF1": round(detection_f1, 4),
            "ocrAccuracy": round(ocr_accuracy, 4),
            "languagesCompleted": sorted(total["languages"]),
            "averageInferenceTimeMs": round(average_time),
            "runtimeFailureCount": total["runtimeFailures"],
            "deploymentComplexityScore": COMPLEXITY_SCORE[label],
        })
    return sorted(ranking, key=lambda item: item["score"], reverse=True)


def write_summary(report):
    ranking = report["ranking"]
    lines = [
        "# MangaLens authentic detector benchmark summary",
        "",
        "All detector calls used real model inference; `OCR_BENCHMARK_MOCK_DETECTOR` was disabled.",
        "The pages are self-created synthetic CC0 samples, not commercial manga.",
        "",
        "| Rank | Pipeline | Score | Detection F1 | OCR accuracy | Avg. time | Failures |",
        "|---:|---|---:|---:|---:|---:|---:|",
    ]
    for index, item in enumerate(ranking, start=1):
        lines.append(
            f"| {index} | {item['pipeline']} | {item['score']:.3f} | "
            f"{item['detectionF1']:.3f} | {item['ocrAccuracy']:.3f} | "
            f"{item['averageInferenceTimeMs']} ms | {item['runtimeFailureCount']} |"
        )
    winner = ranking[0]
    lines.extend([
        "",
        "## Recommendation",
        "",
        f"**{winner['pipeline']}** ranks first on the weighted combination of detection "
        "accuracy (40%), OCR accuracy (35%), Japanese/Korean/English completion (10%), "
        "speed (10%), and deployment complexity (5%), with explicit penalties for runtime failures.",
        "",
        "## Limitations",
        "",
        "- This is a small synthetic corpus with two known text bubbles per page.",
        "- Results measure genuine model execution but do not establish production accuracy on published manga.",
        "- A larger, separately licensed human-reviewed corpus remains necessary before a production choice.",
        "",
    ])
    (OUTPUT_DIR / "benchmark-summary.md").write_text("\n".join(lines), encoding="utf-8")


def main():
    if os.environ.get("OCR_BENCHMARK_MOCK_DETECTOR", "false").lower() == "true":
        raise RuntimeError("Authentic benchmark refuses OCR_BENCHMARK_MOCK_DETECTOR=true")
    manifest = json.loads((SAMPLE_DIR / "manifest.json").read_text(encoding="utf-8"))
    fixtures_dir = OUTPUT_DIR / "fixtures"
    annotated_dir = OUTPUT_DIR / "annotated"
    fixtures_dir.mkdir(parents=True, exist_ok=True)
    annotated_dir.mkdir(parents=True, exist_ok=True)
    runner = PipelineRunner()
    report = {"benchmarkVersion": 1, "mockDetector": False, "samples": []}
    html_results = {}

    for sample in manifest["samples"]:
        source = SAMPLE_DIR / sample["filename"]
        fixture = fixtures_dir / sample["filename"]
        shutil.copy2(source, fixture)
        image = cv2.imread(str(fixture))
        if image is None:
            raise RuntimeError(f"Could not read benchmark fixture: {fixture}")
        sample_result = {
            "filename": sample["filename"],
            "fixturePath": f"fixtures/{sample['filename']}",
            "language": sample["language"],
            "license": sample["license"],
            "source": sample["source"],
            "groundTruthRegions": sample["groundTruthRegions"],
            "pipelines": {},
        }
        html_results[sample["filename"]] = {}
        for label in PIPELINES:
            print(f"Running authentic {label} on {sample['filename']}", flush=True)
            result = execute_pipeline(
                runner, label, fixture, image, sample["language"]
            )
            if result.get("detectorMode") == "mock":
                raise RuntimeError(f"{label} unexpectedly reported mock detection")
            result["review"] = review_result(result, sample["groundTruthRegions"])
            annotated_name = f"{label}_{sample['filename']}"
            annotated_path = annotated_dir / annotated_name
            write_image(str(annotated_path), draw_annotations(
                str(fixture), result, COLORS[label]
            ))
            result["annotatedPath"] = f"annotated/{annotated_name}"
            result["fixturePath"] = f"fixtures/{sample['filename']}"
            sample_result["pipelines"][label] = result
            html_results[sample["filename"]][label] = result
        report["samples"].append(sample_result)

    report["ranking"] = aggregate_scores(report)
    (OUTPUT_DIR / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    generate_comparison_html(str(OUTPUT_DIR), html_results, str(fixtures_dir))
    write_summary(report)
    print("Authentic benchmark ranking:", flush=True)
    print(json.dumps(report["ranking"], ensure_ascii=False, indent=2), flush=True)
    print(f"Authentic benchmark complete. Winner: {report['ranking'][0]['pipeline']}")


if __name__ == "__main__":
    main()
