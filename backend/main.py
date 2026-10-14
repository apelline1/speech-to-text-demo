import os
import tempfile
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

MODEL_SIZE = os.getenv("WHISPER_MODEL_SIZE", "small")
COMPUTE_TYPE = os.getenv("COMPUTE_TYPE", "int8")
DEVICE = os.getenv("DEVICE", "cpu")

model: WhisperModel | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model
    logger.info(f"Loading Whisper model: {MODEL_SIZE!r}  device={DEVICE}  compute={COMPUTE_TYPE}")
    model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)
    logger.info("Model ready ✓")
    yield
    model = None


app = FastAPI(title="Speech-to-Text API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok", "model": MODEL_SIZE, "device": DEVICE}


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    if model is None:
        raise HTTPException(status_code=503, detail="Model is not loaded yet, please retry.")

    # Determine file suffix from content type so ffmpeg gets the right hint
    content_type = audio.content_type or ""
    if "mp4" in content_type or "m4a" in content_type:
        suffix = ".mp4"
    elif "ogg" in content_type:
        suffix = ".ogg"
    else:
        suffix = ".webm"

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        data = await audio.read()
        tmp.write(data)
        tmp_path = tmp.name

    try:
        logger.info(f"Transcribing {len(data) / 1024:.1f} KB  ({suffix})")
        segments, info = model.transcribe(
            tmp_path,
            beam_size=5,
            language=None,          # auto-detect language
            vad_filter=True,        # skip silent parts
            vad_parameters={"min_silence_duration_ms": 500},
        )

        # Collect all segment texts
        transcript = " ".join(seg.text.strip() for seg in segments).strip()

        logger.info(
            f"Language: {info.language} ({info.language_probability:.0%})  "
            f"Transcript: {transcript[:80]!r}"
        )

        return {
            "transcript": transcript,
            "language": info.language,
            "language_probability": round(info.language_probability, 3),
        }

    except Exception as exc:
        logger.error(f"Transcription failed: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))

    finally:
        os.unlink(tmp_path)
