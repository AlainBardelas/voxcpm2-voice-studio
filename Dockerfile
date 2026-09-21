FROM runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404

ENV PYTHONUNBUFFERED=1 \
    HF_HUB_ENABLE_HF_TRANSFER=0 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    TOKENIZERS_PARALLELISM=false \
    MODEL_PATH=/opt/voxcpm2-model
WORKDIR /app
COPY requirements.txt constraints.txt ./
RUN python -m pip install --no-cache-dir --no-compile -c constraints.txt -r requirements.txt
RUN python -c "from huggingface_hub import snapshot_download; snapshot_download('openbmb/VoxCPM2', revision='32279effe8c19989596f05d353d1447f51d9e915', local_dir='/opt/voxcpm2-model')"
COPY audio_protocol.py handler.py ./
ENV HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
ENTRYPOINT []
CMD ["python", "-u", "/app/handler.py"]
