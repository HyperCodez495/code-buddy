#!/usr/bin/env python3
"""Dependency-free unit tests for the LongCat checkpoint and INT8 helpers."""

from __future__ import annotations

import ast
from pathlib import Path
import sys
import types
import unittest


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "scripts" / "gpu-runners" / "longcat-lowmem-inference.py"


def load_functions() -> dict[str, object]:
    tree = ast.parse(SOURCE.read_text(encoding="utf-8"), filename=str(SOURCE))
    wanted = {
        "resolve_parent",
        "validate_checkpoint_tensor",
        "optimize_int8_kernels",
        "latent_grid_size",
        "save_avatar_video",
    }
    body = [tree.body[0]]
    body.extend(
        node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in wanted
    )
    module = ast.Module(body=body, type_ignores=[])
    namespace: dict[str, object] = {}
    exec(compile(module, str(SOURCE), "exec"), namespace)
    return namespace


class FakeDType:
    def __init__(self, name: str, floating: bool) -> None:
        self.name = name
        self.is_floating_point = floating

    def __repr__(self) -> str:
        return self.name


INT8 = FakeDType("int8", False)
FLOAT32 = FakeDType("float32", True)
BFLOAT16 = FakeDType("bfloat16", True)


class FakeTensor:
    def __init__(self, shape: tuple[int, ...], dtype: FakeDType) -> None:
        self.shape = shape
        self.dtype = dtype

    def to(self, dtype: FakeDType) -> "FakeTensor":
        return FakeTensor(self.shape, dtype)

    def unsqueeze(self, dimension: int) -> "FakeTensor":
        assert dimension == 1
        return FakeTensor((self.shape[0], 1), self.dtype)

    def mul_(self, other: "FakeTensor") -> "FakeTensor":
        assert other.shape == (self.shape[0], 1)
        return self


class FakeParameter(FakeTensor):
    def __init__(self, value: FakeTensor, requires_grad: bool = False) -> None:
        super().__init__(value.shape, value.dtype)
        self.requires_grad = requires_grad


class FakeDevice:
    active: str | None = None

    def __init__(self, name: str) -> None:
        self.name = name

    def __enter__(self) -> None:
        FakeDevice.active = self.name

    def __exit__(self, *_args: object) -> None:
        FakeDevice.active = None


class FakeLinear:
    def __init__(self, in_features: int, out_features: int, bias: bool, dtype: FakeDType) -> None:
        if FakeDevice.active != "meta":
            raise AssertionError("the replacement Linear must be allocated on meta")
        self.in_features = in_features
        self.out_features = out_features
        self.weight = FakeParameter(FakeTensor((out_features, in_features), dtype))
        self.bias = FakeParameter(FakeTensor((out_features,), dtype)) if bias else None
        self.training = True
        self.optimized = False

    def train(self, training: bool) -> None:
        self.training = training


class FakeQuantizedLinear:
    def __init__(self, in_features: int, out_features: int, bias: bool = True) -> None:
        self.in_features = in_features
        self.out_features = out_features
        self.weight_int8 = FakeTensor((out_features, in_features), INT8)
        self.weight_scale = FakeTensor((out_features,), FLOAT32)
        self.bias = FakeTensor((out_features,), BFLOAT16) if bias else None
        self.training = False


class FakeDit:
    def __init__(self) -> None:
        self.first = FakeQuantizedLinear(4, 3)
        self.second = FakeQuantizedLinear(3, 2, bias=False)

    def named_modules(self) -> list[tuple[str, object]]:
        return [("", self), ("first", self.first), ("second", self.second)]

    def modules(self) -> list[object]:
        return [self, self.first, self.second]


class LongCatLowMemoryHelpersTest(unittest.TestCase):
    def setUp(self) -> None:
        self.namespace = load_functions()
        self.namespace.update(
            {
                "Any": object,
                "gc": __import__("gc"),
                "marker": lambda _phase: None,
                "nn": types.SimpleNamespace(
                    Linear=FakeLinear,
                    Module=object,
                    Parameter=FakeParameter,
                ),
                "torch": types.SimpleNamespace(
                    Tensor=FakeTensor,
                    bfloat16=BFLOAT16,
                    float32=FLOAT32,
                    int8=INT8,
                    device=FakeDevice,
                ),
                "QuantizedLinear": FakeQuantizedLinear,
                "NUM_FRAMES": 93,
                "FPS": 25,
            }
        )

    def test_compile_grid_matches_portrait_latents_instead_of_pixel_frames(self) -> None:
        class FakePipeline:
            vae_scale_factor_spatial = 8
            vae_scale_factor_temporal = 4

            @staticmethod
            def get_condition_shape(_image, _resolution, scale_factor_spatial):
                if scale_factor_spatial != 16:
                    raise AssertionError("unexpected spatial scale")
                return 832, 480

        grid = self.namespace["latent_grid_size"](FakePipeline(), object())
        self.assertEqual(grid, (24, 52, 30))

    def test_video_mux_falls_back_to_copying_the_existing_h264_stream(self) -> None:
        root = Path(self.id().replace(".", "-"))
        output_base = root / "avatar"
        crop_video = root / "avatar-cropvideo.mp4"
        crop_audio = root / "avatar-cropaudio.wav"
        temporary = root / "avatar-temp.mp4"
        root.mkdir()
        for path in (crop_video, crop_audio, temporary):
            path.write_bytes(b"fixture")

        calls: list[list[str]] = []

        def fail_upstream(*_args, **_kwargs) -> None:
            raise __import__("subprocess").CalledProcessError(8, ["ffmpeg"])

        def capture(command: list[str], check: bool) -> None:
            self.assertTrue(check)
            calls.append(command)

        self.namespace.update(
            {
                "Path": Path,
                "save_video_ffmpeg": fail_upstream,
                "subprocess": types.SimpleNamespace(
                    CalledProcessError=__import__("subprocess").CalledProcessError,
                    run=capture,
                ),
            }
        )
        try:
            self.namespace["save_avatar_video"](object(), output_base, root / "voice.wav")
        finally:
            for path in root.glob("*"):
                path.unlink()
            root.rmdir()

        self.assertEqual(len(calls), 1)
        self.assertIn("copy", calls[0])
        self.assertNotIn("libx264", calls[0])

    def test_checkpoint_shape_and_quantized_dtypes_are_enforced(self) -> None:
        validate = self.namespace["validate_checkpoint_tensor"]
        validate("block.weight_int8", FakeTensor((3, 4), INT8), FakeTensor((3, 4), INT8))
        validate(
            "block.weight_scale",
            FakeTensor((3,), FLOAT32),
            FakeTensor((3,), FLOAT32),
        )
        with self.assertRaisesRegex(ValueError, "shape mismatch"):
            validate("block.weight_int8", FakeTensor((3, 4), INT8), FakeTensor((4, 3), INT8))
        with self.assertRaisesRegex(ValueError, "INT8 tensor"):
            validate(
                "block.weight_int8",
                FakeTensor((3, 4), INT8),
                FakeTensor((3, 4), BFLOAT16),
            )
        with self.assertRaisesRegex(ValueError, "scale tensor"):
            validate(
                "block.weight_scale",
                FakeTensor((3,), FLOAT32),
                FakeTensor((3,), BFLOAT16),
            )

    def test_each_layer_is_quantized_immediately_from_a_meta_linear(self) -> None:
        calls: list[FakeLinear] = []

        def quantize_(linear: FakeLinear, _configuration: object) -> None:
            linear.optimized = True
            calls.append(linear)

        quantization_module = types.ModuleType("torchao.quantization")
        quantization_module.int8_weight_only = lambda: object()
        quantization_module.quantize_ = quantize_
        torchao_module = types.ModuleType("torchao")
        torchao_module.quantization = quantization_module
        previous = {name: sys.modules.get(name) for name in ("torchao", "torchao.quantization")}
        sys.modules["torchao"] = torchao_module
        sys.modules["torchao.quantization"] = quantization_module
        try:
            dit = FakeDit()
            optimized = self.namespace["optimize_int8_kernels"](dit)
        finally:
            for name, value in previous.items():
                if value is None:
                    sys.modules.pop(name, None)
                else:
                    sys.modules[name] = value
        self.assertIs(optimized, dit)
        self.assertEqual(len(calls), 2)
        self.assertIsInstance(dit.first, FakeLinear)
        self.assertIsInstance(dit.second, FakeLinear)
        self.assertTrue(dit.first.optimized)
        self.assertTrue(dit.second.optimized)
        self.assertFalse(dit.first.training)


if __name__ == "__main__":
    unittest.main()
