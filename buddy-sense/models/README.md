# Neural VAD model (Silero v4)

The optional neural VAD (`cargo build --features neural-vad`) uses Silero VAD via
ONNX Runtime. The energy-RMS VAD is the default and remains the fallback when the
model / onnxruntime are absent — nothing here is required for the normal build.

`vad-rs` 0.1.4 expects the **v4** model (the h/c-tensor signature), **not v5**.
Fetch it once (MIT):

```bash
curl -L -o models/silero_vad.onnx \
  https://github.com/snakers4/silero-vad/raw/v4.0/files/silero_vad.onnx
```

onnxruntime is loaded dynamically (`ort` load-dynamic). Fetch the shared lib once
(no sudo) and point `ORT_DYLIB_PATH` at it:

```bash
curl -L -o /tmp/ort.tgz \
  https://github.com/microsoft/onnxruntime/releases/download/v1.20.1/onnxruntime-linux-x64-1.20.1.tgz
mkdir -p ~/.cache/onnxruntime && tar xzf /tmp/ort.tgz -C ~/.cache/onnxruntime --strip-components=1
export ORT_DYLIB_PATH=~/.cache/onnxruntime/lib/libonnxruntime.so.1.20.1
```

Then run with `BUDDY_SENSE_VAD_MODEL=models/silero_vad.onnx`. Both Silero v4 and
onnxruntime are MIT-licensed (commercial-clean). The `.onnx` is gitignored.
```
