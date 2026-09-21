import base64
import io
import unittest
import numpy as np
import soundfile as sf
from audio_protocol import decode_reference, encode_result, validate_input


def clip(seconds=2, rate=16000, silent=False):
    values = np.zeros(int(seconds * rate), dtype=np.float32) if silent else (0.2 * np.sin(2 * np.pi * 220 * np.arange(int(seconds * rate)) / rate))
    stream = io.BytesIO()
    sf.write(stream, values, rate, format="WAV", subtype="PCM_16")
    return base64.b64encode(stream.getvalue()).decode()


class ProtocolTests(unittest.TestCase):
    def test_reference_validation(self):
        self.assertTrue(decode_reference(clip()).startswith(b"RIFF"))
        for value in ("https://example.com/voice.wav", "not base64", clip(0.5), clip(61), clip(silent=True), clip(rate=48000)):
            with self.subTest(value=value[:30]), self.assertRaises(ValueError):
                decode_reference(value)

    def test_transcript_requires_reference(self):
        with self.assertRaises(ValueError):
            validate_input({"text":"Hola", "transcript":"Hola"})

    def test_text_and_step_bounds(self):
        for value in ({"text":""}, {"text":"a" * 1501}, {"text":"Hola", "steps":True}, {"text":"Hola", "steps":500}):
            with self.assertRaises(ValueError): validate_input(value)
        self.assertEqual(validate_input({"text":" Hola ", "steps":15})[:3], ("Hola", "", 15))

    def test_lossless_transport_and_normalization(self):
        source = np.sin(2 * np.pi * 440 * np.arange(96000) / 48000).astype(np.float32) * 1.5
        result = encode_result(source, 48000)
        decoded, rate = sf.read(io.BytesIO(base64.b64decode(result["audio_base64"])))
        self.assertEqual(rate, 48000)
        self.assertEqual(len(decoded), len(source))
        self.assertLess(np.max(np.abs(decoded - source / np.max(np.abs(source)))), 0.00004)
        self.assertEqual(result["duration_seconds"], 2)

    def test_invalid_model_output(self):
        for source in (np.array([]), np.array([np.nan]), np.zeros(100)):
            with self.assertRaises(ValueError): encode_result(source, 48000)


if __name__ == "__main__": unittest.main()
