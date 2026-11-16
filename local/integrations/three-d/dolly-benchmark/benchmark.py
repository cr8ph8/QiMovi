"""Score a candidate against a Blender reference or run the validator controls."""

import argparse
import hashlib
import io
import json
import platform
import sys
import zipfile
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
RGB_SHAPE = (50, 288, 384, 3)
DEPTH_SHAPE = RGB_SHAPE[:-1]
MIDDLE = slice(1, -1)
TARGET, OCCLUDER = 1, 2
LIMITS = {
    "endpoint_mae_max": 0.04,
    "silhouette_iou_min": 0.65,
    "silhouette_iou_median_min": 0.84,
    "centroid_shift_max_px": 8.0,
    "occluder_coverage_min": 0.87,
    "target_leakage_max": 0.05,
    "depth_coverage_min": 0.98,
    "depth_median_rel_error_max": 0.08,
    "depth_p95_rel_error_max": 0.25,
}


def load_arrays(path):
    data = path.read_bytes()
    with np.load(io.BytesIO(data), allow_pickle=False) as arrays:
        return {key: arrays[key] for key in arrays.files}, hashlib.sha256(data).hexdigest()


def load_candidate(data):
    expected_shapes = {"rgb.npy": RGB_SHAPE, "depth.npy": DEPTH_SHAPE}
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        names = {entry.filename for entry in entries}
        if len(entries) != len(names) or not {"rgb.npy"} <= names <= expected_shapes.keys():
            raise ValueError("Candidate NPZ must contain RGB and may contain depth")
        for entry in entries:
            shape = expected_shapes[entry.filename]
            item_size = 1 if entry.filename == "rgb.npy" else 8
            if entry.file_size > int(np.prod(shape)) * item_size + 10_000:
                raise ValueError("Candidate contains an oversized array")
            with archive.open(entry) as stream:
                version = np.lib.format.read_magic(stream)
                if version == (1, 0):
                    array_shape, _, dtype = np.lib.format.read_array_header_1_0(stream)
                elif version == (2, 0):
                    array_shape, _, dtype = np.lib.format.read_array_header_2_0(stream)
                else:
                    raise ValueError("Unsupported candidate array format")
                valid_dtype = dtype == np.uint8 if entry.filename == "rgb.npy" else dtype.kind == "f" and dtype.itemsize <= 8
                if (array_shape != shape or not valid_dtype
                        or entry.file_size != stream.tell() + int(np.prod(shape)) * dtype.itemsize):
                    raise ValueError(f"Invalid shape, type, or byte count for {entry.filename[:-4]}")
    with np.load(io.BytesIO(data), allow_pickle=False) as arrays:
        return {key: arrays[key] for key in arrays.files}


def check_reference(arrays):
    expected = {
        "rgb": (RGB_SHAPE, np.dtype("uint8")),
        "depth": (DEPTH_SHAPE, np.dtype("float32")),
        "ids": (DEPTH_SHAPE, np.dtype("uint8")),
        "occluded": (DEPTH_SHAPE, np.dtype("bool")),
    }
    for name, (shape, dtype) in expected.items():
        if name not in arrays or arrays[name].shape != shape or arrays[name].dtype != dtype:
            raise ValueError(f"Reference {name} must have shape {shape} and dtype {dtype}")
    if not np.isfinite(arrays["depth"]).all() or (arrays["depth"] < 0).any():
        raise ValueError("Reference depth must contain finite nonnegative values")


def assess(passes, **measurements):
    return {"status": "PASS" if passes else "FAIL", **measurements}


def color_masks(rgb):
    red, green, blue = np.moveaxis(rgb.astype(np.int16), -1, 0)
    target = (red > 90) & (red - green > 34) & (red - blue > 28)
    column = (green > 56) & (green - red > 28) & (blue - red > 20) & (green - blue >= -5)
    return target, column


def silhouette_score(predicted, expected):
    axes = (1, 2)
    intersection = (predicted & expected).sum(axis=axes)
    union = (predicted | expected).sum(axis=axes)
    iou = intersection / np.maximum(union, 1)
    shifts = []
    for candidate_mask, reference_mask in zip(predicted, expected):
        if not candidate_mask.any() or not reference_mask.any():
            continue
        candidate_center = np.mean(np.nonzero(candidate_mask), axis=1)
        reference_center = np.mean(np.nonzero(reference_mask), axis=1)
        shifts.append(float(np.linalg.norm(candidate_center - reference_center)))

    min_iou = float(iou.min())
    median_iou = float(np.median(iou))
    max_shift = max(shifts, default=None)
    return assess(
        min_iou >= LIMITS["silhouette_iou_min"]
        and median_iou >= LIMITS["silhouette_iou_median_min"]
        and len(shifts) == len(iou)
        and max_shift <= LIMITS["centroid_shift_max_px"],
        minimum_iou=round(min_iou, 5),
        median_iou=round(median_iou, 5),
        worst_iou_frame=int(iou.argmin()) + 2,
        max_centroid_shift_px=round(max_shift, 4) if max_shift is not None else None,
        comparable_frames=len(shifts),
    )


def occlusion_score(target_mask, column_mask, occluded):
    pixels = occluded.sum(axis=(1, 2))
    selected = np.flatnonzero(pixels >= 100)
    if selected.size == 0:
        return {"status": "ERROR", "detail": "Reference has no measurable target occlusion"}

    coverage = (column_mask & occluded).sum(axis=(1, 2))[selected] / pixels[selected]
    leakage = (target_mask & occluded).sum(axis=(1, 2))[selected] / pixels[selected]
    return assess(
        coverage.min() >= LIMITS["occluder_coverage_min"]
        and leakage.max() <= LIMITS["target_leakage_max"],
        checked_frames=int(selected.size),
        minimum_column_coverage=round(float(coverage.min()), 5),
        maximum_target_leakage=round(float(leakage.max()), 5),
        worst_coverage_frame=int(selected[coverage.argmin()]) + 2,
    )


def depth_score(predicted, expected):
    if predicted is None:
        return {"status": "SKIPPED", "detail": "Candidate depth is absent"}
    if predicted.shape != DEPTH_SHAPE or predicted.dtype.kind != "f":
        return {"status": "ERROR", "detail": f"Depth must be a float array of shape {DEPTH_SHAPE}"}
    if (predicted < 0).any() or not np.isfinite(predicted).all():
        return {"status": "ERROR", "detail": "Depth must contain finite nonnegative values"}

    predicted = predicted.astype(np.float64)
    expected_valid = expected > 0
    comparable = expected_valid & (predicted > 0)
    anchors = [0, -1]
    anchor_mask = comparable[anchors]
    anchor_coverage = anchor_mask.sum(axis=(1, 2)) / np.maximum(expected_valid[anchors].sum(axis=(1, 2)), 1)
    if anchor_coverage.min() < LIMITS["depth_coverage_min"]:
        return {"status": "FAIL", "detail": "Insufficient valid anchor depth to fit a scale",
                "minimum_anchor_coverage": round(float(anchor_coverage.min()), 5)}
    with np.errstate(over="ignore", divide="ignore", invalid="ignore"):
        scale = float(np.median(expected[anchors][anchor_mask] / predicted[anchors][anchor_mask]))
    if not np.isfinite(scale) or scale <= 0:
        return {"status": "FAIL", "detail": "Anchor scale is out of range"}

    coverage = comparable[MIDDLE].sum(axis=(1, 2)) / np.maximum(expected_valid[MIDDLE].sum(axis=(1, 2)), 1)
    if coverage.min() < LIMITS["depth_coverage_min"]:
        return {"status": "FAIL", "detail": "Insufficient valid held-out depth",
                "minimum_coverage": round(float(coverage.min()), 5)}

    medians, p95_scores = [], []
    for candidate, reference, valid in zip(predicted[MIDDLE], expected[MIDDLE], comparable[MIDDLE]):
        with np.errstate(over="ignore", invalid="ignore"):
            relative_error = np.abs(candidate[valid] * scale - reference[valid]) / reference[valid]
        if not np.isfinite(relative_error).all():
            return {"status": "FAIL", "detail": "Scaled depth is out of range"}
        median, p95 = np.percentile(relative_error, [50, 95])
        medians.append(float(median))
        p95_scores.append(float(p95))
    worst_median, worst_p95 = max(medians), max(p95_scores)
    return assess(
        worst_median <= LIMITS["depth_median_rel_error_max"] and worst_p95 <= LIMITS["depth_p95_rel_error_max"],
        scale_from_endpoints=scale,
        minimum_coverage=round(float(coverage.min()), 5),
        worst_frame_median_relative_error=round(worst_median, 5),
        worst_frame_p95_relative_error=round(worst_p95, 5),
        worst_p95_frame=int(np.argmax(p95_scores)) + 2,
    )


def validate(reference, candidate):
    rgb = candidate.get("rgb")
    if rgb is None or rgb.shape != RGB_SHAPE or rgb.dtype != np.uint8:
        checks = {"rgb_format": {"status": "ERROR", "detail": f"RGB must be uint8 with shape {RGB_SHAPE}"}}
    else:
        endpoints = [0, -1]
        endpoint_error = float(np.abs(
            rgb[endpoints].astype(np.int16) - reference["rgb"][endpoints]
        ).mean(axis=(1, 2, 3)).max() / 255.0)
        target, column = color_masks(rgb[MIDDLE])
        checks = {
            "endpoints": assess(endpoint_error <= LIMITS["endpoint_mae_max"],
                                max_mean_absolute_rgb_error=round(endpoint_error, 5)),
            "silhouette": silhouette_score(target, reference["ids"][MIDDLE] == TARGET),
            "occlusion": occlusion_score(target, column, reference["occluded"][MIDDLE]),
            "depth": depth_score(candidate.get("depth"), reference["depth"]),
        }
    statuses = {check["status"] for check in checks.values()}
    overall = next(status for status in ("ERROR", "FAIL", "SKIPPED", "PASS") if status in statuses)
    return {"status": overall, "mode": "DRY-RUN", "eligible_for_review": overall == "PASS", "checks": checks}


def control_cases(reference):
    rgb, depth = reference["rgb"], reference["depth"]
    yield "reference_replay", {"rgb": rgb, "depth": depth * np.float32(0.42)}, "PASS", None

    mix = np.linspace(0, 1, len(rgb), dtype=np.float32)[:, None, None, None]
    dissolve = np.rint(rgb[:1] * (1 - mix) + rgb[-1:] * mix).astype(np.uint8)
    yield "endpoint_dissolve", {"rgb": dissolve}, "FAIL", "silhouette"

    drift = rgb.copy()
    for i in range(4, 9):
        mask = reference["ids"][i] == TARGET
        moved_mask = np.roll(mask, 28, axis=1)
        drift[i, mask] = (85, 105, 130)
        drift[i, moved_mask] = np.roll(rgb[i], 28, axis=1)[moved_mask]
    yield "shifted_character", {"rgb": drift, "depth": depth}, "FAIL", "silhouette"

    bad_overlap = rgb.copy()
    bad_overlap[reference["occluded"]] = (234, 81, 67)
    yield "reversed_occlusion", {"rgb": bad_overlap, "depth": depth}, "FAIL", "occlusion"

    bad_depth = depth.copy()
    bad_depth[20:29] *= np.float32(1.4)
    yield "inconsistent_depth_scale", {"rgb": rgb, "depth": bad_depth}, "FAIL", "depth"
    yield "missing_depth", {"rgb": rgb}, "SKIPPED", "depth"
    yield "missing_frame", {"rgb": rgb[:-1], "depth": depth}, "ERROR", "rgb_format"


def self_test(reference):
    cases = {}
    for name, candidate, expected, check_name in control_cases(reference):
        result = validate(reference, candidate)
        matches = (result["status"] == expected
                   and (check_name is None or result["checks"][check_name]["status"] == expected))
        cases[name] = {
            "expected": expected,
            "control": "PASS" if matches else "FAIL",
            "result": result,
        }
    status = "PASS" if all(case["control"] == "PASS" for case in cases.values()) else "FAIL"
    return {"status": status, "mode": "DRY-RUN", "kind": "validator_controls", "cases": cases}


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["self-test", "validate"])
    parser.add_argument("candidate", type=Path, nargs="?")
    parser.add_argument("--fixture", type=Path, default=ROOT)
    parser.add_argument("--report", type=Path, help="Write evidence to a new file")
    args = parser.parse_args(argv)
    if (args.action == "validate") != (args.candidate is not None):
        parser.error("Supply a candidate path for validate")
    try:
        reference, reference_hash = load_arrays(args.fixture / "reference" / "reference.npz")
        check_reference(reference)
        camera_hash = hashlib.sha256((args.fixture / "inputs" / "cameras.npz").read_bytes()).hexdigest()
        if args.action == "validate":
            data = args.candidate.read_bytes()
            candidate_hash = hashlib.sha256(data).hexdigest()
            try:
                report = validate(reference, load_candidate(data))
            except (ValueError, EOFError, OSError, RuntimeError, zipfile.BadZipFile) as error:
                report = {"status": "ERROR", "mode": "DRY-RUN", "eligible_for_review": False,
                          "checks": {"candidate_format": {"status": "ERROR", "detail": str(error)}}}
            report.update(candidate=args.candidate.name, candidate_sha256=candidate_hash)
        else:
            report = self_test(reference)
        report.update(reference_sha256=reference_hash, camera_inputs_sha256=camera_hash)
    except (OSError, ValueError, KeyError, TypeError, EOFError, zipfile.BadZipFile) as error:
        report = {"status": "ERROR", "mode": "DRY-RUN", "detail": str(error)}
    report.update(
        held_out_frames=[2, 49],
        limits=LIMITS,
        host={"system": platform.system(), "architecture": platform.machine(), "python": platform.python_version()},
    )
    payload = json.dumps(report, indent=2, allow_nan=False)
    if args.report is not None:
        with args.report.open("x", encoding="utf-8") as stream:
            stream.write(payload + "\n")
    print(payload, flush=True)
    return {"PASS": 0, "FAIL": 1, "SKIPPED": 2, "ERROR": 3}[report["status"]]


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    sys.exit(main(args))
