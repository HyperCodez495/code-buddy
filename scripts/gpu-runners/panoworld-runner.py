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
import threading
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


def configured_allowed_roots() -> list[Path]:
    raw = os.environ.get("CODEBUDDY_GPU_ALLOWED_ROOTS_JSON")
    if not raw:
        fail("CODEBUDDY_GPU_ALLOWED_ROOTS_JSON is required")
    try:
        values = json.loads(raw)
    except json.JSONDecodeError as error:
        fail(f"CODEBUDDY_GPU_ALLOWED_ROOTS_JSON is invalid: {error}")
    if not isinstance(values, list) or not values:
        fail("CODEBUDDY_GPU_ALLOWED_ROOTS_JSON must contain at least one root")
    roots: list[Path] = []
    for index, value in enumerate(values):
        root = linux_path(required_text(value, f"allowedRoots[{index}]")).resolve()
        if not root.is_dir():
            fail(f"allowed root does not exist: {root}")
        roots.append(root)
    return roots


def bounded_path(path: Path, roots: list[Path], label: str) -> Path:
    resolved = path.resolve()
    for root in roots:
        try:
            resolved.relative_to(root)
            return resolved
        except ValueError:
            continue
    fail(f"{label} is outside configured roots: {resolved}")


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


def validate_panorama(path: Path, profile: str) -> tuple[int, int]:
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
    expected = (2048, 1024) if profile == "single-2048" else (1024, 512)
    if (width, height) != expected:
        fail(
            f"{profile} requires a {expected[0]}x{expected[1]} panorama, "
            f"received {width}x{height}: {path}"
        )
    return width, height


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def checkpoint_sha256(path: Path) -> tuple[str, str]:
    """Hash once, then reuse only while strong file metadata remains identical."""
    stat = path.stat()
    cache_path = path.with_name(f"{path.name}.codebuddy-sha256.json")
    try:
        cached = json.loads(cache_path.read_text(encoding="utf-8"))
        cached_hash = cached.get("sha256") if isinstance(cached, dict) else None
        if (
            cached.get("version") == 1
            and cached.get("size") == stat.st_size
            and cached.get("mtimeNs") == stat.st_mtime_ns
            and isinstance(cached_hash, str)
            and re.fullmatch(r"[a-f0-9]{64}", cached_hash)
        ):
            return cached_hash, "stat-cache"
    except (OSError, json.JSONDecodeError, AttributeError):
        pass

    digest = sha256(path)
    try:
        atomic_json(
            cache_path,
            {
                "version": 1,
                "size": stat.st_size,
                "mtimeNs": stat.st_mtime_ns,
                "sha256": digest,
            },
        )
    except OSError:
        # Read-only checkpoint stores remain supported; they simply hash every job.
        pass
    return digest, "computed"


def prepare_dataset(
    payload: dict[str, Any], staging: Path, profile: str, allowed_roots: list[Path]
) -> tuple[Path, Path, int]:
    panoramas = payload.get("panoramas")
    if not isinstance(panoramas, list) or not panoramas:
        fail("panoramas must contain at least one view")
    maximum = 1 if profile == "single-2048" else 5
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
        source = bounded_path(
            linux_path(required_text(raw.get("imagePath"), f"panoramas[{index}].imagePath")),
            allowed_roots,
            f"panoramas[{index}].imagePath",
        )
        validate_panorama(source, profile)
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


def prepare_python_compatibility(staging: Path) -> Path:
    """Bridge the released PyTorch 2.3.1 environment to PanoWorld's import guard.

    PanoWorld implements and uses its own RMSNorm, but model.py also references
    nn.RMSNorm inside an isinstance tuple. PyTorch 2.3.1 does not expose that
    attribute. The alias only makes that type guard importable; it does not
    replace the model's custom RMSNorm implementation.
    """
    compatibility = staging / "python-compat"
    compatibility.mkdir(parents=True, exist_ok=True)
    (compatibility / "sitecustomize.py").write_text(
        "import torch.nn as nn\n"
        "if not hasattr(nn, 'RMSNorm'):\n"
        "    nn.RMSNorm = nn.LayerNorm\n",
        encoding="utf-8",
    )
    return compatibility


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


def required_git_commit(root: Path) -> str:
    commit = git_commit(root) or os.environ.get("CODEBUDDY_PANOWORLD_COMMIT", "").strip()
    if not re.fullmatch(r"[a-fA-F0-9]{40,64}", commit):
        fail("cannot determine the pinned PanoWorld git commit")
    return commit.lower()


def cancellation_grace_seconds() -> float:
    raw = os.environ.get("CODEBUDDY_PANOWORLD_CANCEL_GRACE_SECONDS", "10")
    try:
        value = float(raw)
    except ValueError:
        fail("CODEBUDDY_PANOWORLD_CANCEL_GRACE_SECONDS must be numeric")
    if not 0.1 <= value <= 10:
        fail("CODEBUDDY_PANOWORLD_CANCEL_GRACE_SECONDS must be between 0.1 and 10")
    return value


def main() -> int:
    if len(sys.argv) != 2:
        fail("usage: panoworld-runner.py REQUEST_JSON")
    allowed_roots = configured_allowed_roots()
    request_path = bounded_path(linux_path(sys.argv[1]), allowed_roots, "request JSON")
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
    result_path = bounded_path(linux_path(result_value), allowed_roots, "result manifest")
    if result_path.parent != request_path.parent:
        fail("result manifest must be beside the request JSON")
    root = bounded_path(
        linux_path(os.environ.get("CODEBUDDY_PANOWORLD_ROOT", "/mnt/d/DEV/PanoWorld")),
        allowed_roots,
        "PanoWorld root",
    )
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
    checkpoint = bounded_path(
        linux_path(os.environ.get(checkpoint_env, str(root / "checkpoints" / checkpoint_name))),
        allowed_roots,
        "PanoWorld checkpoint",
    )
    if not checkpoint.is_file():
        fail(f"PanoWorld checkpoint not found: {checkpoint}")

    output_dir = bounded_path(
        linux_path(required_text(payload.get("outputDir"), "outputDir")),
        allowed_roots,
        "outputDir",
    )
    if not output_dir.is_dir():
        fail(f"outputDir must already exist: {output_dir}")
    run_output = output_dir / job_id
    if run_output.exists():
        fail(f"job output directory already exists: {run_output}")
    run_output.mkdir()
    staging = result_path.parent / "panoworld-staging"
    data_root, scene_list, view_count = prepare_dataset(payload, staging, profile, allowed_roots)
    compatibility = prepare_python_compatibility(staging)
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
    print("CODEBUDDY_PROGRESS 0.05 verifying checkpoint", flush=True)
    checkpoint_hash, checkpoint_hash_source = checkpoint_sha256(checkpoint)
    commit = required_git_commit(root)
    base_manifest: dict[str, Any] = {
        "sceneId": required_text(payload.get("sceneId"), "sceneId"),
        "profile": profile,
        "viewCount": view_count,
        "checkpointPath": external_path(checkpoint),
        "checkpointSha256": checkpoint_hash,
        "checkpointHashSource": checkpoint_hash_source,
        "panoWorldCommit": commit,
    }
    print(f"CODEBUDDY_PROGRESS 0.10 preparing {view_count} panorama(s)", flush=True)
    child_environment = os.environ.copy()
    current_python_path = child_environment.get("PYTHONPATH")
    child_environment["PYTHONPATH"] = (
        f"{compatibility}{os.pathsep}{current_python_path}"
        if current_python_path
        else str(compatibility)
    )
    process = subprocess.Popen(
        command,
        cwd=root,
        env=child_environment,
        start_new_session=True,
    )

    cancel_grace = cancellation_grace_seconds()
    cancellation_signal: int | None = None
    force_kill_timer: threading.Timer | None = None

    def stop_child(signum: int, _frame: Any) -> None:
        nonlocal cancellation_signal, force_kill_timer
        cancellation_signal = signum
        if process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                return
            if force_kill_timer is None:
                def force_stop() -> None:
                    if process.poll() is None:
                        try:
                            os.killpg(process.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass

                force_kill_timer = threading.Timer(cancel_grace, force_stop)
                force_kill_timer.daemon = True
                force_kill_timer.start()

    signal.signal(signal.SIGTERM, stop_child)
    signal.signal(signal.SIGINT, stop_child)
    exit_code = process.wait()
    if force_kill_timer is not None:
        force_kill_timer.cancel()
    if cancellation_signal is not None:
        atomic_json(
            result_path,
            {
                **base_manifest,
                "status": "cancelled",
                "signal": signal.Signals(cancellation_signal).name,
                "elapsedMs": round((time.monotonic() - started) * 1000),
            },
        )
        print("CODEBUDDY_PROGRESS 1.00 cancelled", flush=True)
        return 130
    if exit_code != 0:
        fail(f"PanoWorld inference exited with code {exit_code}")

    print("CODEBUDDY_PROGRESS 0.95 collecting outputs", flush=True)
    ply, cameras, rendered, depths = find_outputs(run_output)
    manifest: dict[str, Any] = {
        **base_manifest,
        "status": "succeeded",
        "plyPath": external_path(ply),
        "camerasPath": external_path(cameras),
        "renderedPanoramas": [external_path(path) for path in rendered],
        "depthMaps": [external_path(path) for path in depths],
        "elapsedMs": round((time.monotonic() - started) * 1000),
    }
    atomic_json(result_path, manifest)
    print("CODEBUDDY_PROGRESS 1.00 finalizing result", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"PanoWorld runner error: {error}", file=sys.stderr, flush=True)
        raise SystemExit(1)
