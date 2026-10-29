# Speech-to-Text Demo — Implementation Document

**Project:** Speech-to-Text Demo on OpenShift AI  
**Author:** Your Name  
**Date:** October 2026  
**Repo:** https://github.com/YOUR_GITHUB_USERNAME/speech-to-text-demo  
**Cluster:** Rosa / OpenShift (`YOUR_NAMESPACE` namespace)

---

## 1. Overview

A mobile-friendly web application that records voice through a browser and transcribes it to text in real time. The application runs fully on OpenShift with no GPU required.

### Goals
- Demonstrate OpenShift AI serving an ASR (Automatic Speech Recognition) model
- Work on mobile phones (iOS Safari, Android Chrome) without a native app
- Run on CPU-only OpenShift nodes (no GPU dependency)
- Keep the architecture simple enough for a live demo

---

## 2. Technology Decisions

### 2.1 Model Selection

Speech-to-text is an ASR task, **not** an LLM task. Models like Poro (Finnish LLM) are text-in → text-out and cannot process audio.

The chosen model is **faster-whisper-small** for the following reasons:

| Criteria | Decision |
|---|---|
| No GPU available | faster-whisper with int8 quantisation runs well on CPU |
| Finnish language support | Whisper was trained on multilingual data including Finnish |
| Memory footprint | `small` model requires ~3 GB RAM, fits standard OpenShift nodes |
| Speed | ~3–8 seconds to transcribe a 10–15 second clip on CPU |
| Open source | Apache 2.0 licence, no API costs |

**faster-whisper** uses CTranslate2 under the hood, which provides 2–4× faster CPU inference compared to the original OpenAI Whisper package through int8 quantisation.

Alternative considered: `medium` model — better Finnish accuracy but requires ~8 GB RAM. Can be enabled by changing `WHISPER_MODEL_SIZE=medium` in the Deployment.

### 2.2 Architecture

```
Mobile Browser (mic)
       │
       │  HTTPS  (audio blob — WebM/MP4/OGG)
       ▼
┌─────────────────────────────────────────────┐
│                 OpenShift                   │
│  Namespace: YOUR_NAMESPACE                    │
│                                             │
│  ┌──────────────────┐                       │
│  │    Frontend      │  Route (public HTTPS) │◄── User
│  │  nginx:8080      │                       │
│  │  (static HTML)   │                       │
│  └────────┬─────────┘                       │
│           │  /api/ proxy                    │
│  ┌────────▼─────────┐                       │
│  │    Backend       │                       │
│  │  FastAPI:8000    │                       │
│  │  faster-whisper  │                       │
│  │  small · CPU     │                       │
│  └──────────────────┘                       │
└─────────────────────────────────────────────┘
```

### 2.3 Component Stack

| Component | Technology | Notes |
|---|---|---|
| Frontend | HTML5 / CSS / Vanilla JS | No framework, minimal dependencies |
| Web server | nginx-unprivileged 1.25 | Runs on port 8080, OpenShift-compatible out of the box |
| Backend API | Python 3.11 + FastAPI | `/health` and `/transcribe` endpoints |
| ASR model | faster-whisper 1.0.3 | int8 quantisation, CPU device |
| Audio decoding | ffmpeg | Handles WebM (Chrome/Android), MP4 (iOS Safari), OGG (Firefox) |
| Container builds | OpenShift BuildConfig | Binary strategy — built from local directory |
| Image registry | OpenShift internal registry | `image-registry.openshift-image-registry.svc:5000` |

---

## 3. Project Structure

```
speech_to_text/
├── backend/
│   ├── main.py             # FastAPI application
│   ├── requirements.txt    # Python dependencies
│   └── Dockerfile          # Multi-stage: download model + runtime
├── frontend/
│   ├── index.html          # Single-page recording UI
│   ├── app.js              # MediaRecorder + transcription fetch logic
│   ├── style.css           # Red Hat palette, animated record button
│   ├── nginx.conf          # Proxies /api/ → backend service
│   └── Dockerfile          # nginx-unprivileged
├── openshift/
│   ├── backend.yaml        # ImageStream + Deployment + Service + Route
│   └── frontend.yaml       # ImageStream + Deployment + Service + Route
├── .gitignore
├── README.md
└── IMPLEMENTATION.md       # This document
```

---

## 4. Key Implementation Details

### 4.1 Backend — `backend/main.py`

The FastAPI application exposes two endpoints:

- `GET /health` — liveness/readiness check, returns model name and device
- `POST /transcribe` — accepts a multipart audio file, returns JSON with transcript, detected language and confidence

The Whisper model is loaded once at startup using FastAPI's `lifespan` context manager. It is not reloaded per request.

Key transcription settings:
```python
model.transcribe(
    tmp_path,
    beam_size=5,
    language=None,       # auto-detect
    vad_filter=True,     # skip silent parts — important for CPU speed
    vad_parameters={"min_silence_duration_ms": 500},
)
```

VAD (Voice Activity Detection) filtering is enabled to skip silent segments, which significantly reduces CPU processing time.

### 4.2 Backend — Dockerfile (multi-stage build)

The Dockerfile uses a two-stage build:

**Stage 1 (`model-download`):** Installs all Python dependencies and downloads the Whisper model weights from HuggingFace Hub into `/models`. The model is ~1.5 GB.

**Stage 2 (runtime):** Copies the downloaded model from Stage 1, installs ffmpeg for audio decoding, and sets up the application. The model is never downloaded at runtime — it is baked into the image.

This means:
- Container starts in ~30 seconds (model loads from local disk)
- Cluster nodes do not need internet access after the image is built
- Build takes 10–15 minutes the first time (model download), faster subsequently due to layer caching

OpenShift compatibility is handled by:
```dockerfile
RUN chown -R 1001:0 /app /models && chmod -R g+rwX /app /models
USER 1001
```
OpenShift runs containers as arbitrary UIDs in group 0. Group-readable/writable permissions ensure the app works regardless of which UID is assigned.

### 4.3 Frontend — Audio Recording

The `MediaRecorder` API is used to capture microphone audio. Different browsers output different audio formats:

| Browser | Platform | MIME type |
|---|---|---|
| Chrome | Android | `audio/webm;codecs=opus` |
| Safari | iOS 14.3+ | `audio/mp4` |
| Firefox | Android | `audio/ogg;codecs=opus` |

The `getSupportedMimeType()` function in `app.js` detects the best supported format at runtime. ffmpeg in the backend container handles all three formats transparently.

```javascript
static getSupportedMimeType() {
    const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
    ];
    for (const type of candidates) {
        if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return '';
}
```

### 4.4 Frontend — nginx Proxy

The nginx container proxies all `/api/` requests to the backend Service, avoiding cross-origin (CORS) issues entirely. The browser only ever talks to one origin.

```nginx
location /api/ {
    proxy_pass http://speech-to-text-backend:8000/;
    proxy_read_timeout 120s;
    client_max_body_size 25m;
}
```

`speech-to-text-backend` is resolved via Kubernetes DNS within the `YOUR_NAMESPACE` namespace.

---

## 5. HuggingFace API Token

The Whisper model weights are downloaded from **HuggingFace Hub** during the Docker image build (Stage 1). The model `Systran/faster-whisper-small` is public, so a token is not strictly required — however it is needed when:

- The OpenShift build node's IP has been **rate-limited** by HuggingFace (common on shared clusters)
- You want to use a **private or gated model** in the future
- Builds are failing with `401 Unauthorized` or `429 Too Many Requests` from HuggingFace

### 5.1 Get a HuggingFace Token

1. Log in or register at **https://huggingface.co**
2. Go to **Settings → Access Tokens → New token**
3. Name: `openshift-build`
4. Role: **Read**
5. Copy the token (starts with `hf_`)

### 5.2 Store the Token as an OpenShift Secret

```bash
oc create secret generic hf-token \
  --from-literal=token=hf_xxxxxxxxxxxxxxxxxxxx
```

### 5.3 Pass the Token to the Build

**Option A — pass as a build argument at start-build time:**

```bash
oc start-build speech-to-text-backend \
  --build-arg HF_TOKEN=hf_xxxxxxxxxxxxxxxxxxxx \
  --follow
```

**Option B — set it permanently in the BuildConfig** (so every future build uses it automatically):

```bash
oc patch bc/speech-to-text-backend --type=merge -p '{
  "spec": {
    "strategy": {
      "dockerStrategy": {
        "buildArgs": [
          {
            "name": "HF_TOKEN",
            "valueFrom": {
              "secretKeyRef": {
                "name": "hf-token",
                "key": "token"
              }
            }
          }
        ]
      }
    }
  }
}'
```

After patching, trigger a new build:

```bash
oc start-build speech-to-text-backend --follow
```

### 5.4 How the Token Is Used

The `HF_TOKEN` build argument is picked up in Stage 1 of the Dockerfile and set as both `HUGGING_FACE_HUB_TOKEN` and `HF_TOKEN` environment variables — the two names that different versions of `huggingface_hub` recognise:

```dockerfile
ARG HF_TOKEN=""
ENV HUGGING_FACE_HUB_TOKEN=${HF_TOKEN} \
    HF_TOKEN=${HF_TOKEN}
```

The token is **only used during the build stage** to download model weights. It is not baked into the runtime image (Stage 2 does not inherit Stage 1 `ARG` values).

---

## 6. OpenShift Deployment

### 6.1 Prerequisites

- OpenShift 4.x cluster with `YOUR_NAMESPACE` namespace
- `oc` CLI logged in
- GitHub Personal Access Token with `Contents: Read` permission on the repo (for git-based builds)

### 6.2 Build Setup

BuildConfigs were created using the **git-based strategy** with a GitHub token secret for authentication against the private repo.

```bash
# Create GitHub authentication secret
oc create secret generic github-token \
  --from-literal=username=YOUR_GITHUB_USERNAME \
  --from-literal=password=<GITHUB_TOKEN> \
  --type=kubernetes.io/basic-auth

oc secrets link builder github-token

# Create BuildConfigs
oc new-build \
  --name=speech-to-text-backend \
  --strategy=docker \
  --context-dir=backend \
  --source-secret=github-token \
  --code=https://github.com/YOUR_GITHUB_USERNAME/speech-to-text-demo.git

oc new-build \
  --name=speech-to-text-frontend \
  --strategy=docker \
  --context-dir=frontend \
  --source-secret=github-token \
  --code=https://github.com/YOUR_GITHUB_USERNAME/speech-to-text-demo.git
```

> **Note:** `--binary` strategy BuildConfigs (created with `oc new-build --binary`) cannot be patched to use a git source — they are mutually exclusive. A new BuildConfig must be created if switching strategies.

### 6.3 Image Registry

Built images are stored in the OpenShift internal registry:

```
image-registry.openshift-image-registry.svc:5000/YOUR_NAMESPACE/speech-to-text-backend:latest
image-registry.openshift-image-registry.svc:5000/YOUR_NAMESPACE/speech-to-text-frontend:latest
```

Deployments reference the full internal registry path. Short names like `speech-to-text-backend:latest` (without the registry prefix) cause pods to attempt a pull from Docker Hub and fail with `ErrImagePull`.

### 6.4 Deploying

```bash
oc apply -f openshift/backend.yaml
oc apply -f openshift/frontend.yaml
```

### 6.5 Resource Allocation

| Component | Memory request | Memory limit | CPU request | CPU limit |
|---|---|---|---|---|
| Backend | 4 Gi | 6 Gi | 2 | 4 |
| Frontend | 64 Mi | 128 Mi | 100m | 200m |

The backend probe `initialDelaySeconds` is set to 45 seconds to allow the Whisper model to load from disk before the readiness probe starts checking.

### 6.6 Rebuilding After Code Changes

```bash
# Push changes to GitHub first
git add . && git commit -m "..." && git push

# Trigger new builds (OpenShift pulls from GitHub)
oc start-build speech-to-text-backend --follow
oc start-build speech-to-text-frontend --follow
```

The ImageStream trigger in the Deployment annotation automatically rolls out new pods when the build completes.

---

## 7. Troubleshooting Log

Issues encountered and resolved during initial deployment:

| Error | Root cause | Fix |
|---|---|---|
| `ModuleNotFoundError: No module named 'requests'` | Stage 1 of Dockerfile only installed `faster-whisper` directly, not via `requirements.txt`, so transitive deps were missed | Changed Stage 1 to install from `requirements.txt`; added `requests>=2.31.0` explicitly |
| `ErrImagePull: docker.io/library/speech-to-text-backend` | Deployment image field used short name; OpenShift resolved it against Docker Hub | Updated image field to full internal registry path |
| `authentication error` on `oc new-build` with HTTPS | BuildConfig had no source secret | Created `github-token` basic-auth secret and attached with `--source-secret` |
| `spec.source.git: Invalid value` | Tried to patch a binary BuildConfig to use a git source | Deleted and recreated BuildConfig using `--code=` flag with git URL |
| `Error from server (NotFound): deployments.apps` | `oc apply -f openshift/` had not been run yet | Applied the YAML manifests after builds completed |
| `error: remote: Write access to repository not granted. 403` | GitHub token secret was created without the actual token value (placeholder `<GITHUB_TOKEN>` was not replaced), or token lacked `repo` scope | Deleted secret, regenerated a classic token with `repo` scope, recreated secret with real value |
| HuggingFace model download failing during build | Build node IP rate-limited by HuggingFace, or token not set | Create `hf-token` secret and pass `--build-arg HF_TOKEN=hf_xxx` to `oc start-build` |

---

## 8. Future Improvements

- **Streaming transcription** — use WebSockets to stream audio chunks and return partial transcripts in real time
- **Medium model** — upgrade to `faster-whisper-medium` for better Finnish accuracy (requires 8 Gi RAM limit)
- **Poro integration** — add Poro as a second-stage LLM to post-process or summarise the Finnish transcript
- **Webhook trigger** — add a GitHub webhook to `oc start-build` automatically on every push
- **Horizontal scaling** — add HPA based on CPU usage for handling multiple simultaneous users
- **HTTPS microphone** — already handled by the OpenShift Route TLS termination; required by browsers for `getUserMedia`
