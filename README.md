# 🎙️ Speech to Text Demo

A mobile-friendly speech-to-text demo application powered by **faster-whisper** and served on **OpenShift AI**. Open the page on your phone, tap the button, speak — and see your words appear as text.

![Architecture](https://img.shields.io/badge/OpenShift_AI-Demo-EE0000?style=flat-square&logo=redhat)
![Model](https://img.shields.io/badge/Model-faster--whisper--small-blue?style=flat-square)
![Device](https://img.shields.io/badge/Inference-CPU%20%E2%80%A2%20int8-green?style=flat-square)

---

## ✨ Features

- 🎤 **Mobile-first** — works in Chrome (Android) and Safari (iOS) via the `MediaRecorder` API
- 🌍 **Multilingual** — auto-detects language (Finnish, English, and 90+ others)
- ⚡ **CPU-only** — no GPU required; runs on any standard OpenShift node
- 🔒 **Self-contained** — model weights baked into the container image, no runtime internet access needed
- 🔄 **Auto-redeploy** — OpenShift ImageStream trigger redeploys on every new build

---

## 🏗️ Architecture

```
Mobile Browser (mic)
       │
       │  HTTPS  (audio blob)
       ▼
┌─────────────────────────────────────────┐
│               OpenShift                 │
│                                         │
│  ┌──────────────┐    ┌───────────────┐  │
│  │   Frontend   │    │    Backend    │  │
│  │ nginx:8080   │───▶│ FastAPI:8000  │  │
│  │ (static HTML)│    │               │  │
│  └──────────────┘    └──────┬────────┘  │
│         ▲                   │           │
│    Route (HTTPS)    faster-whisper      │
│                     small · CPU · int8  │
└─────────────────────────────────────────┘
```

| Component | Technology |
|---|---|
| Frontend | HTML5 / CSS / Vanilla JS · nginx-unprivileged |
| Backend | Python 3.11 · FastAPI · faster-whisper 1.0.3 |
| ASR Model | [faster-whisper-small](https://huggingface.co/Systran/faster-whisper-small) (int8, CPU) |
| Audio decode | ffmpeg (handles WebM, MP4, OGG from browsers) |
| Platform | OpenShift 4.x · internal image registry |

---

## 📁 Project Structure

```
speech_to_text/
├── backend/
│   ├── main.py             # FastAPI app — /health and /transcribe endpoints
│   ├── requirements.txt
│   └── Dockerfile          # Multi-stage: downloads model at build time
├── frontend/
│   ├── index.html          # Single-page recording UI
│   ├── app.js              # MediaRecorder + fetch logic
│   ├── style.css           # Red Hat palette, animated record button
│   ├── nginx.conf          # Proxies /api/ → backend service
│   └── Dockerfile          # nginx-unprivileged (OpenShift-ready)
└── openshift/
    ├── backend.yaml        # ImageStream + Deployment + Service + Route
    └── frontend.yaml       # ImageStream + Deployment + Service + Route
```

---

## 🚀 Deploying to OpenShift

No podman or Quay.io account needed — OpenShift builds the images internally.

### 1. Log in and create a project

```bash
oc login https://your-cluster-api:6443
oc new-project speech-to-text-demo
```

### 2. Build the images from GitHub

OpenShift pulls the code and builds the Dockerfiles inside the cluster:

```bash
# Backend (includes model download — takes ~10–15 min first time)
oc new-build https://github.com/apelline1/speech-to-text-demo \
  --context-dir=backend \
  --name=speech-to-text-backend \
  --strategy=docker

# Frontend
oc new-build https://github.com/apelline1/speech-to-text-demo \
  --context-dir=frontend \
  --name=speech-to-text-frontend \
  --strategy=docker
```

Watch the build logs:

```bash
oc logs -f bc/speech-to-text-backend
oc logs -f bc/speech-to-text-frontend
```

### 3. Deploy

```bash
oc apply -f openshift/backend.yaml
oc apply -f openshift/frontend.yaml
```

### 4. Get the public URL

```bash
oc get route speech-to-text
```

Open the URL on your phone and start speaking! 🎉

---

## 🔁 Rebuilding after a code change

Push your changes to GitHub, then trigger a new build:

```bash
git push

oc start-build speech-to-text-backend --follow   # if backend changed
oc start-build speech-to-text-frontend --follow  # if frontend changed
```

The ImageStream trigger will automatically redeploy the pods when the new image is ready.

---

## ⚙️ Configuration

### Backend environment variables

| Variable | Default | Description |
|---|---|---|
| `WHISPER_MODEL_SIZE` | `small` | Model size: `tiny`, `base`, `small`, `medium` |
| `COMPUTE_TYPE` | `int8` | Quantisation: `int8` (CPU) or `float16` (GPU) |
| `DEVICE` | `cpu` | `cpu` or `cuda` |

To use the larger **medium** model (better accuracy, needs ~8 GB RAM), edit `openshift/backend.yaml`:

```yaml
env:
  - name: WHISPER_MODEL_SIZE
    value: "medium"
resources:
  limits:
    memory: "10Gi"
    cpu: "8"
```

### Resource requirements (CPU)

| Model | RAM (limit) | CPU (limit) |
|---|---|---|
| `small` | 6 Gi | 4 |
| `medium` | 10 Gi | 8 |

---

## 🌐 Browser support

| Browser | Platform | Audio format | Supported |
|---|---|---|---|
| Chrome | Android | WebM / Opus | ✅ |
| Safari | iOS 14.3+ | MP4 / AAC | ✅ |
| Firefox | Android | OGG / Opus | ✅ |
| Chrome | Desktop | WebM / Opus | ✅ |

---

## 🇫🇮 Finnish language note

Whisper `small` and `medium` support Finnish out of the box — no fine-tuning required for a demo. For higher accuracy with heavy dialects or technical vocabulary, consider fine-tuning on a Finnish dataset such as [Common Voice FI](https://commonvoice.mozilla.org/fi).

---

## 📄 License

MIT
