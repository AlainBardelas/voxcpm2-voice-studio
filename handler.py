"""One endpoint, two isolated model runtimes, one GPU job at a time."""
import json
import logging
import subprocess
import tempfile
import time
from pathlib import Path

import runpod

from audio_protocol import decode_reference, validate_input, validate_model

PYTHONS = {"voxcpm2": "/opt/voice-env/bin/python", "qwen3-tts": "/opt/qwen-env/bin/python"}


def handler(job):
    started = time.monotonic()
    try:
        value = job.get("input")
        text, transcript, steps, reference = validate_input(value)
        model, audio_only = validate_model(value)
        raw_reference = decode_reference(reference) if reference else None
        with tempfile.TemporaryDirectory(prefix="voice-job-") as directory:
            root = Path(directory)
            reference_path = root / "reference.wav"
            if raw_reference:
                reference_path.write_bytes(raw_reference)
            request_path, result_path = root / "input.json", root / "output.json"
            request_path.write_text(json.dumps({
                "model": model, "text": text, "transcript": transcript,
                "steps": steps, "audio_only": audio_only,
                "reference_path": str(reference_path) if raw_reference else None,
            }))
            # The subprocess releases all GPU memory and keeps each model's
            # pinned Transformers version independent when switching models.
            subprocess.run(
                [PYTHONS[model], str(Path(__file__).with_name("generate.py")),
                 str(request_path), str(result_path)],
                check=True, timeout=560,
            )
            result = json.loads(result_path.read_text())
            result["generation_seconds"] = round(time.monotonic() - started, 3)
            return result
    except ValueError as error:
        return {"error": str(error)}
    except subprocess.TimeoutExpired:
        return {"error": "Generation took too long. Try a shorter passage or reference excerpt."}
    except Exception:
        logging.exception("Generation failed")
        return {"error": "Generation failed. Try a shorter passage or a different recording."}


if __name__ == "__main__":
    print("VOICE_STUDIO_READY: voxcpm2, qwen3-tts", flush=True)
    runpod.serverless.start({"handler": handler, "concurrency_modifier": lambda _: 1})
