"""Bounded, file-only audio protocol. No URLs or remote file fetches."""
import base64
import binascii
import io

import numpy as np
import soundfile as sf

MAX_REFERENCE_BYTES = 6_000_000
MAX_OUTPUT_BYTES = 7_000_000
MAX_REFERENCE_SECONDS = 60


def validate_input(value):
    if not isinstance(value, dict):
        raise ValueError("Input must be an object.")
    text = value.get("text", "")
    transcript = value.get("transcript", "")
    if not isinstance(text, str) or not 1 <= len(text.strip()) <= 1500:
        raise ValueError("Enter between 1 and 1,500 characters to say.")
    if not isinstance(transcript, str) or len(transcript) > 8000:
        raise ValueError("The reference transcript is too long.")
    steps = value.get("steps", 10)
    if isinstance(steps, bool) or steps not in (10, 15, 20, 25, 30):
        raise ValueError("Generation steps must be 10, 15, 20, 25 or 30.")
    reference = value.get("reference_audio_base64")
    if transcript.strip() and not reference:
        raise ValueError("Upload the recording that matches the transcript.")
    return text.strip(), transcript.strip(), int(steps), reference


def decode_reference(encoded):
    if not isinstance(encoded, str) or len(encoded) > 4 * ((MAX_REFERENCE_BYTES + 2) // 3):
        raise ValueError("Reference recording is too large.")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        raise ValueError("Reference audio is not valid base64.") from None
    if len(raw) > MAX_REFERENCE_BYTES:
        raise ValueError("Reference recording is too large.")
    try:
        info = sf.info(io.BytesIO(raw))
        if info.format not in ("WAV", "FLAC"):
            raise ValueError("Send reference audio as WAV or FLAC.")
        if not 1 <= info.duration <= MAX_REFERENCE_SECONDS:
            raise ValueError("Use a recording between 1 and 60 seconds.")
        if info.channels != 1 or info.samplerate != 16000:
            raise ValueError("Reference audio must be mono at 16 kHz.")
        samples, rate = sf.read(io.BytesIO(raw), dtype="float32")
    except (RuntimeError, sf.LibsndfileError):
        raise ValueError("The recording could not be decoded.") from None
    if not np.isfinite(samples).all() or np.max(np.abs(samples)) < 0.00001:
        raise ValueError("The recording is silent or contains invalid samples.")
    return raw


def encode_result(waveform, sample_rate):
    samples = np.asarray(waveform, dtype=np.float32).reshape(-1)
    if not samples.size or not np.isfinite(samples).all():
        raise ValueError("The model returned invalid audio. Try again.")
    if sample_rate != 48000:
        raise ValueError("Unexpected model sample rate.")
    if len(samples) > 180 * sample_rate:
        raise ValueError("The result is too long. Generate a shorter passage.")
    peak = float(np.max(np.abs(samples)))
    if peak < 0.00001:
        raise ValueError("The model returned silence. Try again.")
    if peak > 1:
        samples = samples / peak
    out = io.BytesIO()
    sf.write(out, samples, sample_rate, format="FLAC", subtype="PCM_16")
    raw = out.getvalue()
    if len(raw) > MAX_OUTPUT_BYTES:
        raise ValueError("The result exceeds the transfer limit. Generate a shorter passage.")
    return {
        "audio_base64": base64.b64encode(raw).decode("ascii"),
        "format": "flac",
        "sample_rate": sample_rate,
        "duration_seconds": round(len(samples) / sample_rate, 3),
    }
