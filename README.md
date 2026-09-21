# VoxCPM2 Voice Studio

A personal Spanish voice studio using a static browser interface and a private Runpod queue endpoint. The full VoxCPM2 model runs on a GPU only while workers are active. No reference recordings, generated recordings or credentials are included in this repository.

## Worker

Deploy this repository's Dockerfile with Runpod's GitHub builder. It includes the pinned public model weights, so no region-bound network volume is needed.

- Endpoint type: Queue.
- Active workers: 0. Maximum workers: 1. GPUs per worker: 1.
- GPU priority: 24 GB L4/A5000/3090 group; optional 16 GB Ampere/Ada fallback.
- Regions: all eligible regions. Network volume: none.
- Idle timeout: 5 seconds. Execution timeout: 300 seconds.
- Container disk: 20 GB or the minimum accepted for the built image.
- FlashBoot: enabled.
- No inbound HTTP ports, SSH access, extra startup commands or app secrets are required by the worker.

Requests contain `input.text`, optional `input.reference_audio_base64` (mono 16 kHz WAV/FLAC), optional exact `input.transcript`, and `input.steps` (10–30 in increments of 5). The response contains a lossless FLAC encoded as base64 and timing/sample-rate metadata. The browser converts the result to a downloadable WAV.

The reference cap of 60 seconds and target-text cap of 1,500 characters are application limits, not claims about the model's hard limits. No training occurs during normal cloning. Reference recordings are temporary and removed after each job; Runpod also handles request data under its service retention policies.

## Browser interface

Publish `site/` on a static HTTPS host. Set its endpoint ID in `site/config.json`. The endpoint ID is not a credential. Authentication uses a Runpod API key restricted to this one endpoint, entered in the password field. The key remains in JavaScript memory until logout or reload; it is never included in site files, URLs, local storage, or analytics. No third-party scripts or fonts are loaded.

Browser requests go directly to `https://api.runpod.ai`. Checking the endpoint does not submit a generation or start a GPU. Job submission is never retried automatically, to avoid duplicate charges after an ambiguous network failure. A submitted job has a 5-minute execution timeout and a 10-minute total lifetime. Closing the page does not itself cancel a submitted job; use Cancel. Completed results should be downloaded before leaving the page.

## Costs

Runpod's currently documented 24 GB flex group is $0.00019/second ($0.684 per worker-hour), including startup, generation and idle shutdown delay. The 16 GB group is cheaper at $0.00016/second. GPU compute scales to zero after idle shutdown. Container charges may be additional. Existing pod backups are separate resources and remain untouched.

These settings reduce dependence on one host or datacenter; capacity delays and cold starts remain possible. Never put an account-wide API key in this app. The endpoint-specific key grants the holder the ability to spend credits generating speech on this endpoint.

## Local validation

`python -m unittest discover -s tests` checks malformed/silent/oversized references, duration limits, transcript validation and lossless result transport without loading a model. GPU synthesis and scale-to-zero require separate live tests.
