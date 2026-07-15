#!/usr/bin/env python3
"""Prepare and run one Code Buddy PanoWorld-LRM reconstruction job.

The Node GPU worker validates the Windows paths before invoking this runner in
WSL. This script performs model-specific validation, converts the request to
the released RealSee3D layout, launches the pinned PanoWorld inference entry
point without a shell, and writes the result manifest atomically.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time
from typing import Any

from PIL import Image


WINDOWS_PATH = re.compile(r"^([A-Za-z]):[\\/](.*)$")
IDENTITY_C2W = [
    1.0,
    0.0,
    0.0,
    0.0,
    0.0,
    1.0,
    0.0,
    0.0,
    0.0,
    0.0,
    1.0,
    0.0,
    0.0,
    0.0,
    0.0,
    1.0,
]


def fail(message: str) -> "NoReturn":
    raise RuntimeError(message)


def linux_path(value: str) -> Path:
    match = WINDOWS_PATH.match(value)
    if match:
        drive, tail = match.groups()
        normalized = tail.replace("\\", "/")
        return Path(f"/mnt/{drive.lower()}/{normalized}")
    return Path(value)


def external_path(path: Path) -> str:
    parts = path.resolve().parts
    if len(parts) >= 4 and parts[1] == "mnt" and len(parts[2]) == 1:
        return f"{parts[2].upper()}:\\" + "\\".join(parts[3:])
    return str(path.resolve())


def required_text(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        fail(f"{label} is required")
    return value.strip()


def load_request(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        fail(f"cannot read request JSON: {error}")
    if not isinstance(data, dict) or data.get("kind") != "panoworld_reconstruct":
        fail("request kind must be panoworld_reconstruct")
    payload = data.get("payload")
    if not isinstance(payload, dict):
        fail("request payload must be an object")
    return data


def validate_matrix(value: Any, required: bool) -> list[float]:
    if value is None:
        if required:
            fail("multi-1024 requires a cameraToWorld matrix for every panorama")
        return IDENTITY_C2W.copy()
    if (
        not isinstance(value, list)
        or len(value) != 16
        or any(not isinstance(item, (int, float)) for item in value)
    ):
        fail("cameraToWorld must contain 16 finite numbers")
    matrix = [float(item) for item in value]
    if any(not (-1e12 < item < 1e12) for item in matrix):
        fail("cameraToWorld contains an invalid number")
    if any(abs(actual - expected) > 1e-4 for actual, expected in zip(matrix[12:], [0, 0, 0, 1])):
        fail("cameraToWorld must have a homogeneous [0, 0, 0, 1] last row")
    return matrix


def write_matrix(path: Path, matrix: list[float]) -> None:
    rows = [matrix[index : index + 4] for index in range(0, 16, 4)]
    path.write_text(
        "\n".join(" ".join(f"{value:.9g}" for value in row) for row in rows) + "\n",
        encoding="utf-8",
    )


def validate_panorama(path: Path) -> None:
    if not path.is_file():
        fail(f"panorama does not exist: {path}")
    try:
        with Image.open(path) as image:
            width, height = image.size
            image.verify()
    except Exception as error:
        fail(f"panorama is unreadable: {path}: {error}")
    if height <= 0 or width != height * 2:
        fail(f"panorama must have an exact 2:1 ratio: {path}")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def prepare_dataset(payload: dict[str, Any], staging: Path, profile: str) -> tuple[Path, Path, int]:
    panoramas = payload.get("panoramas")
    if not isinstance(panoramas, list) or not panoramas:
        fail("panoramas must contain at least one view")
    maximum = 1 if profile == "single-2048" else 6
    if len(panoramas) > maximum:
        fail(f"{profile} accepts at most {maximum} panorama(s)")

    if staging.exists():
        shutil.rmtree(staging)
    scene_dir = staging / "data" / "codebuddy_scene"
    viewpoints = scene_dir / "viewpoints"
    viewpoints.mkdir(parents=True)
    room_views: dict[str, list[str]] = {}

    for index, raw in enumerate(panoramas):
        if not isinstance(raw, dict):
            fail(f"panoramas[{index}] must be an object")
        source = linux_path(required_text(raw.get("imagePath"), f"panoramas[{index}].imagePath"))
        validate_panorama(source)
        room_id = required_text(raw.get("roomId"), f"panoramas[{index}].roomId")
        view_name = f"view_{index:03d}"
        view_dir = viewpoints / view_name
        view_dir.mkdir()
        shutil.copy2(source, view_dir / "panoImage_1600.jpg")
        matrix = validate_matrix(raw.get("cameraToWorld"), profile == "multi-1024")
        write_matrix(view_dir / "extrinsics.txt", matrix)
        room_views.setdefault(room_id, []).append(view_name)

    room_map = {views[0]: views[1:] for views in room_views.values()}
    (scene_dir / "map.json").write_text(
        json.dumps(room_map, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    scene_list = staging / "scenes.txt"
    scene_list.write_text("codebuddy_scene/map.json\n", encoding="utf-8")
    return staging / "data", scene_list, len(panoramas)


def find_outputs(output_dir: Path) -> tuple[Path, Path, list[Path], list[Path]]:
    ply_files = sorted(output_dir.rglob("point_cloud.ply"))
    camera_files = sorted(output_dir.rglob("cameras.json"))
    if not ply_files:
        fail("PanoWorld completed without producing point_cloud.ply")
    if not camera_files:
        fail("PanoWorld completed without producing cameras.json")
    images = sorted(
        path
        for path in output_dir.rglob("*")
        if path.is_file() and path.suffix.lower() in {".png", ".jpg", ".jpeg"}
    )
    rendered = [path for path in images if "depth" not in str(path).lower()]
    depths = [path for path in images if "depth" in str(path).lower()]
    return ply_files[0], camera_files[0], rendered, depths


def atomic_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(path)


def git_commit(root: Path) -> str | None:
    try:
        return subprocess.check_output(
            ["git", "-C", str(root), "rev-parse", "HEAD"], text=True, timeout=5
        ).strip()
    except (OSError, subprocess.SubprocessError):
        return None


def main() -> int:
    if len(sys.argv) != 2:
        fail("usage: panoworld-runner.py REQUEST_JSON")
    request_path = linux_path(sys.argv[1]).resolve()
    request = load_request(request_path)
    job_id = required_text(request.get("id"), "job id")
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,128}", job_id):
        fail("job id contains invalid characters")
    payload = request["payload"]
    profile = payload.get("profile")
    if profile not in {"single-2048", "multi-1024"}:
        fail("profile must be single-2048 or multi-1024")

    result_value = os.environ.get("CODEBUDDY_GPU_JOB_RESULT")
    if not result_value:
        fail("CODEBUDDY_GPU_JOB_RESULT is required")
    result_path = linux_path(result_value).resolve()
    root = linux_path(os.environ.get("CODEBUDDY_PANOWORLD_ROOT", "/mnt/d/DEV/PanoWorld")).resolve()
    if not (root / "inference.py").is_file():
        fail(f"PanoWorld inference.py not found under {root}")

    checkpoint_name = (
        "ckpt_panoworld_lrm_2048_1024.ckpt"
        if profile == "single-2048"
        else "ckpt_panoworld_lrm_1024_512.pt"
    )
    checkpoint_env = (
        "CODEBUDDY_PANOWORLD_2048_CHECKPOINT"
        if profile == "single-2048"
        else "CODEBUDDY_PANOWORLD_1024_CHECKPOINT"
    )
    checkpoint = linux_path(
        os.environ.get(checkpoint_env, str(root / "checkpoints" / checkpoint_name))
    ).resolve()
    if not checkpoint.is_file():
        fail(f"PanoWorld checkpoint not found: {checkpoint}")

    output_dir = linux_path(required_text(payload.get("outputDir"), "outputDir")).resolve()
    if not output_dir.is_dir():
        fail(f"outputDir must already exist: {output_dir}")
    run_output = output_dir / job_id
    if run_output.exists():
        fail(f"job output directory already exists: {run_output}")
    run_output.mkdir()
    staging = result_path.parent / "panoworld-staging"
    data_root, scene_list, view_count = prepare_dataset(payload, staging, profile)
    config = root / "configs" / (
        "inference_2048_1024.yaml" if profile == "single-2048" else "inference_1024_512.yaml"
    )
    if not config.is_file():
        fail(f"PanoWorld config not found: {config}")

    command = [
        sys.executable,
        str(root / "inference.py"),
        "--config",
        str(config),
        f"data.root_data_dir={data_root}",
        f"data.data_path={scene_list}",
        f"data.viewpoint_max_view={view_count}",
        "inference.num_workers=0",
        "inference.prefetch_factor=1",
        f"inference.ckpt_path={checkpoint}",
        f"inference.out_dir={run_output}",
    ]
    started = time.monotonic()
    print(f"CODEBUDDY_PROGRESS 0.10 preparing {view_count} panorama(s)", flush=True)
    process = subprocess.Popen(command, cwd=root, start_new_session=True)

    def stop_child(_signum: int, _frame: Any) -> None:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)

    signal.signal(signal.SIGTERM, stop_child)
    signal.signal(signal.SIGINT, stop_child)
    exit_code = process.wait()
    if exit_code != 0:
        fail(f"PanoWorld inference exited with code {exit_code}")

    print("CODEBUDDY_PROGRESS 0.95 collecting outputs", flush=True)
    ply, cameras, rendered, depths = find_outputs(run_output)
    manifest: dict[str, Any] = {
        "sceneId": required_text(payload.get("sceneId"), "sceneId"),
        "profile": profile,
        "viewCount": view_count,
        "plyPath": external_path(ply),
        "camerasPath": external_path(cameras),
        "renderedPanoramas": [external_path(path) for path in rendered],
        "depthMaps": [external_path(path) for path in depths],
        "checkpointPath": external_path(checkpoint),
        "checkpointSha256": sha256(checkpoint),
        "elapsedMs": round((time.monotonic() - started) * 1000),
    }
    commit = git_commit(root)
    if commit:
        manifest["panoWorldCommit"] = commit
    atomic_json(result_path, manifest)
    print("CODEBUDDY_PROGRESS 1.00 completed", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"PanoWorld runner error: {error}", file=sys.stderr, flush=True)
        raise SystemExit(1)
