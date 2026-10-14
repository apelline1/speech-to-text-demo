# ── Stage 1: download the Whisper model weights ──────────────────────────────
FROM python:3.11-slim AS model-download

ARG WHISPER_MODEL_SIZE=small

RUN pip install --no-cache-dir faster-whisper==1.0.3

# Download model into /models so Stage 2 can copy it
ENV HF_HOME=/models
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('${WHISPER_MODEL_SIZE}', device='cpu', compute_type='int8')"


# ── Stage 2: runtime image ────────────────────────────────────────────────────
FROM python:3.11-slim

WORKDIR /app

# ffmpeg is required by faster-whisper to decode audio (webm, mp4, ogg …)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy pre-downloaded model weights from Stage 1
COPY --from=model-download /models /models

COPY main.py .

# ── OpenShift compatibility ───────────────────────────────────────────────────
# OpenShift runs containers as an arbitrary UID in group 0.
# Ensure every file the app needs is group-readable/writable.
RUN chown -R 1001:0 /app /models && \
    chmod -R g+rwX  /app /models

ENV HF_HOME=/models \
    WHISPER_MODEL_SIZE=small \
    COMPUTE_TYPE=int8 \
    DEVICE=cpu

USER 1001

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
