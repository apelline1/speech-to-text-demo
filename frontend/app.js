'use strict';

/**
 * Speech-to-Text Demo
 * Records audio via MediaRecorder API (works on mobile iOS & Android)
 * and sends it to the FastAPI backend for Whisper transcription.
 */

const API_BASE = '/api';

// ── Audio Recorder ──────────────────────────────────────────────────────────

class AudioRecorder {
  constructor() {
    this.mediaRecorder = null;
    this.chunks = [];
    this.stream = null;
    this.isRecording = false;
  }

  /**
   * Pick the best supported MIME type across browsers.
   * - Chrome/Android → audio/webm;codecs=opus
   * - Firefox        → audio/ogg;codecs=opus
   * - Safari/iOS     → audio/mp4
   */
  static getSupportedMimeType() {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ];
    for (const type of candidates) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return ''; // let the browser choose
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1,      // mono is fine for speech
        sampleRate: 16000,    // hint; browser may ignore
      },
    });

    const mimeType = AudioRecorder.getSupportedMimeType();
    this.mediaRecorder = new MediaRecorder(
      this.stream,
      mimeType ? { mimeType } : {}
    );
    this.chunks = [];

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };

    this.mediaRecorder.start(250); // fire ondataavailable every 250 ms
    this.isRecording = true;
  }

  stop() {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        reject(new Error('Recorder is not active'));
        return;
      }
      this.mediaRecorder.onstop = () => {
        const mimeType = this.mediaRecorder.mimeType || 'audio/webm';
        const blob = new Blob(this.chunks, { type: mimeType });
        this.stream.getTracks().forEach((t) => t.stop());
        this.isRecording = false;
        resolve(blob);
      };
      this.mediaRecorder.stop();
    });
  }
}

// ── API ─────────────────────────────────────────────────────────────────────

async function transcribeAudio(blob) {
  // Choose file extension so the server can pass the right hint to ffmpeg
  const ext = blob.type.includes('mp4') ? '.mp4'
             : blob.type.includes('ogg') ? '.ogg'
             : '.webm';

  const form = new FormData();
  form.append('audio', blob, `recording${ext}`);

  const res = await fetch(`${API_BASE}/transcribe`, { method: 'POST', body: form });

  if (!res.ok) {
    let detail = `Server error ${res.status}`;
    try { detail = (await res.json()).detail || detail; } catch { /* ignore */ }
    throw new Error(detail);
  }

  return res.json(); // { transcript, language, language_probability }
}

// ── UI helpers ──────────────────────────────────────────────────────────────

const recordBtn       = document.getElementById('recordBtn');
const statusText      = document.getElementById('statusText');
const transcriptEl    = document.getElementById('transcript');
const languageBadge   = document.getElementById('languageBadge');
const copyBtn         = document.getElementById('copyBtn');
const processingEl    = document.getElementById('processingIndicator');

const STATES = {
  idle:       'Tap to start recording',
  recording:  'Recording…  tap again to stop',
  processing: 'Transcribing…',
};

function setState(state) {
  recordBtn.dataset.state = state;
  statusText.textContent = STATES[state] ?? '';
  processingEl.hidden = state !== 'processing';
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function showResult({ transcript, language, language_probability }) {
  const text = transcript?.trim();

  if (text) {
    transcriptEl.innerHTML = `<p>${escapeHtml(text)}</p>`;
    copyBtn.hidden = false;
  } else {
    transcriptEl.innerHTML = `<p class="no-speech">No speech detected — try speaking closer to the microphone.</p>`;
    copyBtn.hidden = true;
  }

  if (language) {
    try {
      const names = new Intl.DisplayNames([navigator.language, 'en'], { type: 'language' });
      const langName = names.of(language);
      const pct = Math.round((language_probability ?? 0) * 100);
      languageBadge.textContent = `${langName} · ${pct}%`;
    } catch {
      languageBadge.textContent = language;
    }
    languageBadge.hidden = false;
  } else {
    languageBadge.hidden = true;
  }
}

function showError(message) {
  transcriptEl.innerHTML = `<p class="error-text">⚠ ${escapeHtml(message)}</p>`;
  languageBadge.hidden = true;
  copyBtn.hidden = true;
}

// ── Record button logic ─────────────────────────────────────────────────────

const recorder = new AudioRecorder();

recordBtn.addEventListener('click', async () => {
  if (recorder.isRecording) {
    // ── Stop & transcribe ──────────────────────────────────────
    setState('processing');
    try {
      const blob = await recorder.stop();
      const result = await transcribeAudio(blob);
      showResult(result);
    } catch (err) {
      console.error('Transcription error:', err);
      showError(err.message);
    } finally {
      setState('idle');
    }

  } else {
    // ── Start recording ────────────────────────────────────────
    try {
      await recorder.start();
      setState('recording');
    } catch (err) {
      console.error('Recorder error:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        showError('Microphone access was denied. Please allow microphone permission and reload.');
      } else if (err.name === 'NotFoundError') {
        showError('No microphone found on this device.');
      } else {
        showError(err.message);
      }
      setState('idle');
    }
  }
});

// ── Copy button ─────────────────────────────────────────────────────────────

copyBtn.addEventListener('click', async () => {
  const text = transcriptEl.querySelector('p')?.textContent?.trim();
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for older browsers / HTTP (non-HTTPS)
    const range = document.createRange();
    range.selectNodeContents(transcriptEl);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('copy');
    sel.removeAllRanges();
  }

  copyBtn.textContent = '✓ Copied!';
  setTimeout(() => (copyBtn.textContent = 'Copy'), 2200);
});

// ── Browser support check ───────────────────────────────────────────────────

if (!navigator.mediaDevices?.getUserMedia) {
  statusText.textContent = 'Your browser does not support audio recording. Try Chrome or Firefox.';
  recordBtn.disabled = true;
} else {
  setState('idle');
}
