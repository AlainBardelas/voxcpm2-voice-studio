"""Runpod queue worker for the full, unquantized VoxCPM2 model."""
import logging
import os
import tempfile
import time
from pathlib import Path

import runpod
import torch
from voxcpm import VoxCPM

from audio_protocol import decode_reference, encode_result, validate_input

model = VoxCPM.from_pretrained(
    os.environ.get("MODEL_PATH", "/opt/voxcpm2-model"),
    device="cuda",
    load_denoiser=False,
    optimize=False,
)
print("VOXCPM2_READY", torch.cuda.get_device_name(0), flush=True)


def handler(job):
    started = time.monotonic()
    try:
        text, transcript, steps, reference = validate_input(job.get("input"))
        raw_reference = decode_reference(reference) if reference else None
        with tempfile.TemporaryDirectory(prefix="voxcpm-job-") as directory:
            path = None
            if raw_reference:
                path = str(Path(directory) / "reference.wav")
                Path(path).write_bytes(raw_reference)
            kwargs = dict(
                text=text,
                reference_wav_path=path,
                cfg_value=2.0,
                inference_timesteps=steps,
                normalize=False,
                denoise=False,
            )
            if path and transcript:
                kwargs.update(prompt_wav_path=path, prompt_text=transcript)
            waveform = model.generate(**kwargs)
            result = encode_result(waveform, model.tts_model.sample_rate)
            result["generation_seconds"] = round(time.monotonic() - started, 3)
            return result
    except ValueError as error:
        return {"error": str(error)}
    except Exception:
        logging.exception("Generation failed")
        return {"error": "Generation failed. Try a shorter passage or a different recording."}


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler, "concurrency_modifier": lambda _: 1})
