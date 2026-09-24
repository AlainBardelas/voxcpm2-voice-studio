"""Model subprocess. Private input/output files exist only for the current job."""
import json
import os
import sys
from pathlib import Path

import soundfile as sf
import torch

from audio_protocol import encode_result


def generate(value):
    path = value["reference_path"]
    if value["model"] == "voxcpm2":
        from voxcpm import VoxCPM

        model = VoxCPM.from_pretrained(
            os.environ.get("MODEL_PATH", "/opt/voxcpm2-model"),
            device="cuda", load_denoiser=False, optimize=False,
        )
        kwargs = dict(text=value["text"], reference_wav_path=path, cfg_value=2.0,
                      inference_timesteps=value["steps"], normalize=False, denoise=False)
        if path and value["transcript"]:
            kwargs.update(prompt_wav_path=path, prompt_text=value["transcript"])
        waveform = model.generate(**kwargs)
        rate = model.tts_model.sample_rate
        mode = "audio + transcript" if path and value["transcript"] else "audio only" if path else "generated voice"
    else:
        from qwen_tts import Qwen3TTSModel

        model = Qwen3TTSModel.from_pretrained(
            os.environ.get("QWEN_MODEL_PATH", "/opt/qwen3-model"),
            device_map="cuda:0", dtype=torch.bfloat16, attn_implementation="sdpa",
        )
        waveforms, rate = model.generate_voice_clone(
            text=value["text"], language="Spanish", ref_audio=path,
            ref_text=value["transcript"] if not value["audio_only"] else None,
            x_vector_only_mode=value["audio_only"], max_new_tokens=2048,
        )
        waveform = waveforms[0]
        mode = "audio only" if value["audio_only"] else "audio + transcript"
    result = encode_result(waveform, rate)
    result.update(model=value["model"], cloning_mode=mode,
                  reference_seconds=round(sf.info(path).duration, 3) if path else 0)
    return result


if __name__ == "__main__":
    try:
        result = generate(json.loads(Path(sys.argv[1]).read_text()))
    except torch.cuda.OutOfMemoryError:
        result = {"error": "This reference or passage exceeded GPU memory. Try a shorter excerpt or passage."}
    Path(sys.argv[2]).write_text(json.dumps(result))
