/* Accessify settings: one small module owning all accessibility state.
   Everything here applies instantly and app-wide via CSS custom properties
   and a few data-attributes/classes on <html>/<body> - never by touching
   individual screens. That's what "applies immediately across the entire
   app, not just generated content" means in practice. */

const SETTINGS_KEY = "accessify_settings_v1";

const DEFAULTS = {
  cvdFilter: "off",        // off | grayscale | boost
  textSize: "medium",      // small | medium | large | xlarge
  uiSize: "medium",
  buttonSize: "medium",
  font: "default",         // default | dyslexia
  spacing: "comfortable",  // compact | comfortable | spacious
  contrast: "off",         // off | medium | high
  strongBorders: false,
  clearerText: false,
  audioCues: false,
  voiceSpeed: 1.0,         // 0.6 - 1.6
  voiceVolume: 0.9,        // 0 - 1
  readAloud: false,
};

const SCALE = {
  textSize: { small: 0.85, medium: 1, large: 1.15, xlarge: 1.35 },
  uiSize: { small: 0.9, medium: 1, large: 1.15, xlarge: 1.3 },
  buttonSize: { small: 0.9, medium: 1, large: 1.2, xlarge: 1.4 },
  spacing: { compact: 0.7, comfortable: 1, spacious: 1.4 },
};

function load() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable - settings just won't persist, non-fatal */
  }
}

function apply(settings) {
  const root = document.documentElement;

  root.style.setProperty("--text-scale", SCALE.textSize[settings.textSize]);
  root.style.setProperty("--ui-scale", SCALE.uiSize[settings.uiSize]);
  root.style.setProperty("--button-scale", SCALE.buttonSize[settings.buttonSize]);
  root.style.setProperty("--gap-scale", SCALE.spacing[settings.spacing]);

  root.style.setProperty(
    "--font-family",
    settings.font === "dyslexia"
      ? "'Atkinson Hyperlegible', system-ui, sans-serif"
      : "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
  );

  const cvdMap = { off: "none", grayscale: "url(#cvd-grayscale)", boost: "url(#cvd-boost)" };
  root.style.setProperty("--cvd-filter", cvdMap[settings.cvdFilter] || "none");

  root.setAttribute("data-contrast", settings.contrast);
  document.body.classList.toggle("strong-borders", !!settings.strongBorders);
  document.body.classList.toggle("clear-text", !!settings.clearerText);
}

function playCue(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const patterns = {
      start: { freq: 880, duration: 0.12 },
      stop: { freq: 440, duration: 0.12 },
      success: { freq: 660, duration: 0.15 },
      error: { freq: 220, duration: 0.25 },
    };
    const p = patterns[type] || patterns.success;
    osc.frequency.value = p.freq;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + p.duration);
    osc.start();
    osc.stop(ctx.currentTime + p.duration);
    osc.onended = () => ctx.close();
  } catch {
    /* WebAudio unsupported or blocked - silently skip, cues are a nicety */
  }
}

function speakWithBrowserVoice(text, settings) {
  if (!("speechSynthesis" in window) || !text) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = settings.voiceSpeed;
  utter.volume = settings.voiceVolume;
  window.speechSynthesis.speak(utter);
}

let currentAudio = null;

/* Real Gemini TTS via the backend - proper voices in the content's own
   language, not just whatever the OS happens to ship. Falls back to the
   browser's built-in voice if the backend/API is unreachable, so "read
   aloud" still works even if Gemini TTS is down or unconfigured. */
async function speak(text, settings) {
  if (!text) return;
  if (currentAudio) {
    currentAudio.pause();
    URL.revokeObjectURL(currentAudio.src); // avoid leaking a blob URL if we're interrupting a still-playing clip
    currentAudio = null;
  }
  if (typeof API_BASE === "undefined") {
    speakWithBrowserVoice(text, settings);
    return;
  }
  try {
    const form = new FormData();
    form.append("text", text);
    form.append("voice_speed", String(settings.voiceSpeed));
    const res = await fetch(`${API_BASE}/api/speak`, { method: "POST", body: form });
    if (!res.ok) throw new Error("backend TTS unavailable");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    currentAudio = new Audio(url);
    currentAudio.volume = settings.voiceVolume;
    currentAudio.onended = () => URL.revokeObjectURL(url);
    // play() returns a Promise that rejects if the browser's autoplay
    // policy blocks it (e.g. auto-read-aloud with no direct click) -
    // without this catch it was an unhandled rejection and the user got
    // silence with no explanation. Fall back to the browser voice, which
    // isn't subject to the same autoplay restrictions.
    currentAudio.play().catch(() => speakWithBrowserVoice(text, settings));
  } catch {
    speakWithBrowserVoice(text, settings);
  }
}

window.AccessifySettings = { DEFAULTS, load, save, apply, playCue, speak };
