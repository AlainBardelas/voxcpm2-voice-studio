# Voice Studio · Qwen3-TTS + VoxCPM2

A personal Spanish voice studio with a model switcher, two result players and a private Runpod queue endpoint. Both full, unquantized models use the same endpoint and access key. Each runs in a separate Python environment and subprocess, so their dependencies and GPU allocations cannot collide. No recordings or credentials are included in this repository.

## Models

- **Qwen3-TTS-12Hz-1.7B-Base:** clones an uploaded recording. Spanish is explicitly selected. The default mode requires an accurate transcript of the reference excerpt. Audio-only speaker-embedding mode is an explicit, lower-fidelity option. Native output is 24 kHz.
- **VoxCPM2:** supports generated speech without a reference, recording-only cloning, or recording plus exact transcript (Ultimate Cloning). Native output is 48 kHz. The existing generation settings are preserved.

The public Qwen CustomVoice checkpoint contains preset speakers. Base is the checkpoint for cloning uploaded recordings and for further single-speaker fine-tuning. Supporting Spanish does not guarantee Cuban accent or individual speaker fidelity: compare both models using the same reference, transcript and target text.

## Worker

Deploy this repository's Dockerfile with Runpod's GitHub builder. Both model snapshots and their speech tokenizers are bundled into the image. No network volume or runtime model download is required.

- Queue endpoint; active workers 0, maximum workers 1, one GPU per worker.
- 24 GB GPU group with a 16 GB fallback; all eligible regions.
- Idle timeout 60 seconds, execution timeout 600 seconds, Standard FlashBoot.
- No inbound HTTP ports, SSH access, extra startup commands or app secrets.
- Model inference subprocess timeout 560 seconds. Job policy: 600-second execution timeout and 900-second total lifetime.

The worker validates `input.text`, `input.model` (`voxcpm2` or `qwen3-tts`), optional `input.reference_audio_base64` (mono 16 kHz WAV/FLAC), `input.transcript`, `input.audio_only`, and VoxCPM2 `input.steps` (10–30 in increments of 5). Omitting `model` preserves compatibility with the previous VoxCPM2 page. The response includes the actual model, cloning mode, reference duration, lossless FLAC encoded as base64, and native sample rate. The browser converts it into a WAV without upsampling one model to match the other.

## Reference recordings

The page accepts a local recording up to 20 minutes / 100 MB, decodes it locally, and lets the user explicitly select a 1–180 second excerpt. Only that excerpt is submitted. For recordings longer than three minutes, the default selection is visibly identified as the first three minutes; start and end can be changed before generation. Transcripts must match the selected excerpt only.

The three-minute selection produces approximately 7.7 MB of base64-encoded 16 kHz PCM16 audio, leaving room within Runpod's 10 MiB asynchronous request limit. It is an application transport limit, not a claimed model maximum or an optimal reference duration. More context does not guarantee a closer accent match. Normal cloning does not train either model. Fine-tuning is a separate workflow that can use a larger collection of recordings.

Target text is capped at 1,500 characters and generated output at 180 seconds. Input/output files are temporary and removed after each job. Runpod also handles request data under its service retention policies.

## Browser interface and privacy

GitHub Pages serves `site/` through the root redirect. The endpoint ID in `site/config.json` is not a credential. Authentication uses the existing API key restricted to this one endpoint, entered in the password field. It remains in JavaScript memory until logout or reload and is never included in site files, URLs, local storage or analytics. No third-party scripts or fonts are loaded.

Requests go directly to `https://api.runpod.ai`. Checking endpoint health does not start a GPU. Job submission is never automatically retried; a submitted job ID and model are kept in session storage so a reload can reconnect after unlocking without buying another generation. The access key, reference recording and transcript are not saved in session storage.

Switching models retains inputs and the latest result from each model, with model-specific download names and native sample rates. A result from the wrong model is rejected rather than mislabeled. Unusually long output relative to the requested text is visibly flagged as possibly containing extra or repeated speech. This is a duration heuristic, not a transcription or voice-quality assessment. Results remain in tab memory until reload or lock. Closing the page does not cancel an existing job; use Cancel. Download recordings before leaving the page.

## Costs

The endpoint scales to zero after idle shutdown. Startup, model loading, generation and the idle delay are billable; current GPU prices appear in the Runpod console. The existing backup pods and storage are separate resources.

## Validation

- `python -m unittest discover -s tests`: malformed/silent/oversized references, three-minute transport limits, explicit Qwen clone mode, both native audio sample rates, and lossless output transport.
- `node --test tests/*.test.mjs`: WAV/base64 transport, selection of an excerpt from a long recording, and rejection of wrong-model or wrong-sample-rate responses.
- Browser upload, model switching, result playback and actual GPU generation require separate end-to-end checks. Synthetic speech can verify operation but does not establish fidelity to a user's voice or Cuban accent.
