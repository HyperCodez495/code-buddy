#!/usr/bin/env python3
"""Single-clip low-VRAM LongCat Avatar 1.5 inference for a 24 GiB RTX 3090.

The sequential loading design is derived from the unmerged community PR #115
by GitHub user wanghaisheng (MIT repository). This hardened variant removes
shell-built commands, stays INT8 on Ampere, verifies the streamed state-dict
shape and exposes stable phase markers to the Code Buddy worker.
"""

from __future__ import annotations

import argparse
import datetime
import gc
import json
import math
import os
from pathlib import Path
import sys
from typing import Any

import numpy as np
import PIL.Image
import torch
import torch.distributed as dist
import torch.nn as nn
from diffusers.utils import load_image
import librosa
from safetensors.torch import load_file
from transformers import AutoTokenizer, UMT5EncoderModel

from longcat_video.audio_process import get_audio_encoder, get_audio_feature_extractor
from longcat_video.audio_process.torch_utils import save_video_ffmpeg
from longcat_video.context_parallel import context_parallel_util
from longcat_video.modules.autoencoder_kl_wan import AutoencoderKLWan
from longcat_video.modules.avatar.longcat_video_dit_avatar import (
    LongCatVideoAvatarTransformer3DModel,
)
from longcat_video.modules.quantization import DEFAULT_SKIP_PATTERNS, QuantizedLinear
from longcat_video.modules.scheduling_flow_match_euler_discrete import (
    FlowMatchEulerDiscreteScheduler,
)
from longcat_video.pipeline_longcat_video_avatar import LongCatVideoAvatarPipeline


NUM_FRAMES = 93
FPS = 25
NUM_INFERENCE_STEPS = 8


def marker(phase: str) -> None:
    print(f"LONGCAT_PHASE {phase}", flush=True)


def collect_cuda() -> None:
    gc.collect()
    torch.cuda.empty_cache()
    torch.cuda.ipc_collect()


def load_input(path: Path) -> tuple[str, Path, Path]:
    value: Any = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("input JSON must be an object")
    prompt = value.get("prompt")
    image = value.get("cond_image")
    audio = value.get("cond_audio")
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("input prompt is required")
    if not isinstance(image, str):
        raise ValueError("input cond_image is required")
    if not isinstance(audio, dict) or not isinstance(audio.get("person1"), str):
        raise ValueError("input cond_audio.person1 is required")
    image_path = Path(image).resolve(strict=True)
    audio_path = Path(audio["person1"]).resolve(strict=True)
    return prompt.strip(), image_path, audio_path


def encode_prompt(
    base_model_dir: Path, prompt: str, device: torch.device
) -> tuple[AutoTokenizer, torch.Tensor, torch.Tensor]:
    marker("text")
    tokenizer = AutoTokenizer.from_pretrained(
        base_model_dir,
        subfolder="tokenizer",
        local_files_only=True,
    )
    text_encoder = UMT5EncoderModel.from_pretrained(
        base_model_dir,
        subfolder="text_encoder",
        torch_dtype=torch.bfloat16,
        local_files_only=True,
        low_cpu_mem_usage=True,
    ).eval()
    text_encoder.requires_grad_(False)
    text_encoder.to(device)
    text_inputs = tokenizer(
        [prompt],
        padding="max_length",
        max_length=512,
        truncation=True,
        add_special_tokens=True,
        return_attention_mask=True,
        return_tensors="pt",
    )
    input_ids = text_inputs.input_ids.to(device)
    mask = text_inputs.attention_mask.to(device)
    with torch.inference_mode():
        embeds = text_encoder(input_ids, mask).last_hidden_state.to(torch.bfloat16)
        embeds = embeds.view(1, 1, embeds.shape[1], -1)
    embeds_cpu = embeds.cpu()
    mask_cpu = mask.cpu()
    del text_encoder, text_inputs, input_ids, embeds, mask
    collect_cuda()
    return tokenizer, embeds_cpu, mask_cpu


def encode_audio(
    checkpoint_dir: Path,
    tokenizer: AutoTokenizer,
    audio_path: Path,
    device: torch.device,
) -> torch.Tensor:
    marker("audio")
    audio_model_path = checkpoint_dir / "whisper-large-v3"
    audio_encoder = get_audio_encoder(str(audio_model_path), "avatar-v1.5").to(device)
    audio_feature_extractor = get_audio_feature_extractor(
        str(audio_model_path), "avatar-v1.5"
    )
    speech_array, sample_rate = librosa.load(audio_path, sr=16_000)
    generated_duration = NUM_FRAMES / FPS
    speech_array = speech_array[: math.ceil(generated_duration * sample_rate)]
    source_duration = len(speech_array) / sample_rate
    missing_samples = math.ceil((generated_duration - source_duration) * sample_rate)
    if missing_samples > 0:
        speech_array = np.pad(speech_array, (0, missing_samples))
    temporary_pipeline = LongCatVideoAvatarPipeline(
        tokenizer=tokenizer,
        text_encoder=None,
        vae=None,
        scheduler=None,
        dit=None,
        audio_encoder=audio_encoder,
        audio_feature_extractor=audio_feature_extractor,
        model_type="avatar-v1.5",
    )
    with torch.inference_mode():
        audio_embedding = temporary_pipeline.get_audio_embedding(
            speech_array,
            fps=FPS,
            device=device,
            sample_rate=sample_rate,
            model_type="avatar-v1.5",
        )
    if torch.isnan(audio_embedding).any():
        raise ValueError("Whisper produced NaN audio embeddings")
    result = audio_embedding.cpu()
    del temporary_pipeline, audio_encoder, audio_feature_extractor, audio_embedding
    collect_cuda()
    return result


def resolve_parent(model: nn.Module, name: str) -> tuple[nn.Module, str]:
    parts = name.split(".")
    parent = model
    for part in parts[:-1]:
        parent = getattr(parent, part)
    return parent, parts[-1]


def load_streamed_int8_dit(
    checkpoint_dir: Path, cp_split_hw: list[int]
) -> LongCatVideoAvatarTransformer3DModel:
    quantized_dir = checkpoint_dir / "base_model_int8"
    config = json.loads((quantized_dir / "config.json").read_text(encoding="utf-8"))
    for key in ("_class_name", "architectures", "_diffusers_version", "model_max_length"):
        config.pop(key, None)
    config["cp_split_hw"] = cp_split_hw
    with torch.device("meta"):
        dit = LongCatVideoAvatarTransformer3DModel(**config)

    replacements: dict[str, nn.Linear] = {}
    for name, module in dit.named_modules():
        if isinstance(module, nn.Linear) and not any(
            pattern in name for pattern in DEFAULT_SKIP_PATTERNS
        ):
            replacements[name] = module
    for name, module in replacements.items():
        parent, attribute = resolve_parent(dit, name)
        setattr(
            parent,
            attribute,
            QuantizedLinear(
                module.in_features,
                module.out_features,
                bias=module.bias is not None,
            ),
        )
    dit = dit.to_empty(device="cpu")

    index = json.loads(
        (quantized_dir / "quantized_model.safetensors.index.json").read_text(
            encoding="utf-8"
        )
    )
    weight_map = index.get("weight_map")
    if not isinstance(weight_map, dict):
        raise ValueError("quantized model index has no weight_map")
    expected_keys = set(dit.state_dict().keys())
    indexed_keys = set(weight_map.keys())
    missing = expected_keys - indexed_keys
    unexpected = indexed_keys - expected_keys
    if missing or unexpected:
        raise ValueError(
            "quantized checkpoint/model mismatch: "
            f"{len(missing)} missing and {len(unexpected)} unexpected keys"
        )

    loaded: set[str] = set()
    shard_names = sorted(set(weight_map.values()))
    for shard_number, shard_name in enumerate(shard_names, start=1):
        if not isinstance(shard_name, str):
            raise ValueError("quantized model index contains a non-string shard")
        print(f"Loading INT8 shard {shard_number}/{len(shard_names)}", flush=True)
        shard = load_file(quantized_dir / shard_name, device="cpu")
        for key, tensor in shard.items():
            parent, attribute = resolve_parent(dit, key)
            current = getattr(parent, attribute)
            if not isinstance(current, (nn.Parameter, torch.Tensor)):
                raise ValueError(f"checkpoint target is not a tensor: {key}")
            if tuple(current.shape) != tuple(tensor.shape):
                raise ValueError(
                    f"checkpoint shape mismatch for {key}: {tuple(tensor.shape)} != {tuple(current.shape)}"
                )
            if current.dtype == torch.int8 and tensor.dtype != torch.int8:
                raise ValueError(f"checkpoint dtype mismatch for INT8 tensor {key}: {tensor.dtype}")
            if current.dtype.is_floating_point and not tensor.dtype.is_floating_point:
                raise ValueError(f"checkpoint dtype is not floating point for {key}: {tensor.dtype}")
            if isinstance(current, nn.Parameter):
                current.data = tensor
            else:
                setattr(parent, attribute, tensor)
            loaded.add(key)
        del shard
        gc.collect()
    if loaded != indexed_keys:
        raise ValueError(f"only {len(loaded)}/{len(indexed_keys)} checkpoint tensors loaded")

    dit.eval()
    dit.requires_grad_(False)
    for module in dit.modules():
        if isinstance(module, QuantizedLinear):
            continue
        for parameter in module.parameters(recurse=False):
            if parameter.dtype == torch.float32:
                parameter.data = parameter.data.to(torch.bfloat16)
    return dit


def build_pipeline(
    checkpoint_dir: Path,
    base_model_dir: Path,
    tokenizer: AutoTokenizer,
    cp_split_hw: list[int],
    device: torch.device,
) -> LongCatVideoAvatarPipeline:
    marker("model")
    vae = AutoencoderKLWan.from_pretrained(
        base_model_dir,
        subfolder="vae",
        torch_dtype=torch.bfloat16,
        local_files_only=True,
        low_cpu_mem_usage=True,
    )
    scheduler = FlowMatchEulerDiscreteScheduler.from_pretrained(
        checkpoint_dir,
        subfolder="scheduler",
        torch_dtype=torch.bfloat16,
        local_files_only=True,
    )
    dit = load_streamed_int8_dit(checkpoint_dir, cp_split_hw)
    dit = optimize_int8_kernels(dit)
    lora_path = checkpoint_dir / "lora" / "dmd_lora.safetensors"
    dit.load_lora(
        str(lora_path),
        "dmd",
        multiplier=1.0,
        lora_network_dim=128,
        lora_network_alpha=64,
    )
    pipeline = LongCatVideoAvatarPipeline(
        tokenizer=tokenizer,
        text_encoder=None,
        vae=vae,
        scheduler=scheduler,
        dit=dit,
        audio_encoder=None,
        audio_feature_extractor=None,
        model_type="avatar-v1.5",
    )
    pipeline.to(device)
    pipeline.dit.enable_loras(["dmd"])
    compile_pipeline(pipeline, device)
    collect_cuda()
    return pipeline


def install_cached_prompt(
    pipeline: LongCatVideoAvatarPipeline,
    prompt_embeds_cpu: torch.Tensor,
    mask_cpu: torch.Tensor,
    device: torch.device,
) -> None:
    cached_embeds = prompt_embeds_cpu.to(device, dtype=pipeline.dit.dtype)
    cached_mask = mask_cpu.to(device)

    def cached_encode_prompt(
        prompt: Any = None,
        negative_prompt: Any = None,
        do_classifier_free_guidance: bool = False,
        num_videos_per_prompt: int = 1,
        max_sequence_length: int = 512,
        dtype: Any = None,
        device: Any = None,
    ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor | None, torch.Tensor | None]:
        del prompt, negative_prompt, num_videos_per_prompt, max_sequence_length, dtype, device
        negative_embeds = torch.zeros_like(cached_embeds) if do_classifier_free_guidance else None
        negative_mask = cached_mask if do_classifier_free_guidance else None
        return cached_embeds, cached_mask, negative_embeds, negative_mask

    pipeline.encode_prompt = cached_encode_prompt


def optimize_int8_kernels(
    dit: LongCatVideoAvatarTransformer3DModel,
) -> LongCatVideoAvatarTransformer3DModel:
    """Replace eager dequantizing layers with TorchAO INT8 kernels.

    Converting every layer to BF16 before a global quantize, as the community
    prototype does, creates a large transient allocation. Quantizing each layer
    before moving to the next keeps the peak bounded to one reconstructed layer.
    """
    from torchao.quantization import int8_weight_only, quantize_

    marker("optimize")
    names = [name for name, module in dit.named_modules() if isinstance(module, QuantizedLinear)]
    quantization = int8_weight_only()
    for index, name in enumerate(names, start=1):
        parent, attribute = resolve_parent(dit, name)
        module = getattr(parent, attribute)
        if not isinstance(module, QuantizedLinear):
            raise ValueError(f"quantized layer changed during conversion: {name}")
        linear = nn.Linear(
            module.in_features,
            module.out_features,
            bias=module.bias is not None,
            device="cpu",
            dtype=torch.bfloat16,
        )
        linear.weight.data.copy_(
            module.weight_int8.to(torch.bfloat16)
            * module.weight_scale.to(torch.bfloat16).unsqueeze(1)
        )
        if module.bias is not None:
            linear.bias.data.copy_(module.bias.to(torch.bfloat16))
        quantize_(linear, quantization)
        setattr(parent, attribute, linear)
        if index % 16 == 0:
            gc.collect()
            print(f"Optimized INT8 layers: {index}/{len(names)}", flush=True)
    gc.collect()
    if any(isinstance(module, QuantizedLinear) for module in dit.modules()):
        raise ValueError("one or more eager QuantizedLinear layers remain")
    return dit


def compile_pipeline(pipeline: LongCatVideoAvatarPipeline, device: torch.device) -> None:
    marker("compile")
    grid_size = (NUM_FRAMES, 480 // 16, 832 // 16)
    key_name = ".".join(str(value) for value in grid_size) + "-None-None"
    for block in pipeline.dit.blocks:
        attention = getattr(block, "attn", None)
        rope = getattr(attention, "rope_3d", None)
        if rope is None:
            continue
        if key_name not in rope.freqs_dict:
            rope.register_grid_size(grid_size, key_name, None, None)
        rope.freqs_dict[key_name] = rope.freqs_dict[key_name].to(device)
    pipeline.dit = torch.compile(
        pipeline.dit,
        mode="max-autotune-no-cudagraphs",
    )


def render(
    pipeline: LongCatVideoAvatarPipeline,
    image_path: Path,
    audio_path: Path,
    prompt: str,
    audio_embedding_cpu: torch.Tensor,
    output_dir: Path,
    device: torch.device,
) -> None:
    marker("render")
    indices = torch.arange(5) - 2
    center_indices = torch.arange(0, NUM_FRAMES).unsqueeze(1) + indices.unsqueeze(0)
    center_indices = torch.clamp(
        center_indices,
        min=0,
        max=audio_embedding_cpu.shape[0] - 1,
    )
    audio_embedding = audio_embedding_cpu[center_indices][None, ...].to(device)
    generator = torch.Generator(device=device).manual_seed(42)
    image = load_image(str(image_path))
    with torch.inference_mode():
        output, _latent = pipeline.generate_ai2v(
            image=image,
            prompt=prompt,
            negative_prompt=None,
            resolution="480p",
            num_frames=NUM_FRAMES,
            num_inference_steps=NUM_INFERENCE_STEPS,
            text_guidance_scale=1.0,
            audio_guidance_scale=1.0,
            output_type="both",
            generator=generator,
            audio_emb=audio_embedding,
            use_distill=True,
        )
    frames = output[0]
    video = [PIL.Image.fromarray((frame * 255).astype(np.uint8)) for frame in frames]
    del _latent, output, audio_embedding, pipeline
    collect_cuda()
    marker("encode")
    output_tensor = torch.from_numpy(np.stack([np.asarray(frame) for frame in video]))
    save_video_ffmpeg(
        output_tensor,
        str(output_dir / "avatar"),
        str(audio_path),
        fps=FPS,
        quality=5,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-json", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--checkpoint-dir", type=Path, required=True)
    args = parser.parse_args()

    prompt, image_path, audio_path = load_input(args.input_json.resolve(strict=True))
    checkpoint_dir = args.checkpoint_dir.resolve(strict=True)
    base_model_dir = (checkpoint_dir.parent / "LongCat-Video").resolve(strict=True)
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True, mode=0o700)

    rank = int(os.environ.get("RANK", "0"))
    local_rank = int(os.environ.get("LOCAL_RANK", "0"))
    torch.cuda.set_device(local_rank)
    dist.init_process_group(backend="nccl", timeout=datetime.timedelta(hours=1))
    world_size = dist.get_world_size()
    if world_size != 1:
        raise ValueError("the measured low-memory profile requires exactly one GPU process")
    context_parallel_util.init_context_parallel(
        context_parallel_size=1,
        global_rank=rank,
        world_size=world_size,
    )
    cp_split_hw = context_parallel_util.get_optimal_split(1)
    device = torch.device(f"cuda:{local_rank}")

    tokenizer, prompt_embeds_cpu, mask_cpu = encode_prompt(base_model_dir, prompt, device)
    audio_embedding_cpu = encode_audio(checkpoint_dir, tokenizer, audio_path, device)
    pipeline = build_pipeline(checkpoint_dir, base_model_dir, tokenizer, cp_split_hw, device)
    install_cached_prompt(pipeline, prompt_embeds_cpu, mask_cpu, device)
    render(pipeline, image_path, audio_path, prompt, audio_embedding_cpu, output_dir, device)
    dist.barrier()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001 - executable boundary
        print(f"LongCat inference error: {error}", file=sys.stderr, flush=True)
        raise
