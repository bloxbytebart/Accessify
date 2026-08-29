# Accessify

Give the app anything. Tell it what you need.

This build covers Phase 1 + Phase 2 (working UI, full text → spoken/typed
instruction → AI transformation → follow-up loop) **plus** a new
Accessibility Settings screen, added ahead of the original phase order
because it now underpins the rest of the UI. Image, PDF, and Gemini-quality
TTS still come in their originally planned phases (see roadmap below).

## Accessibility Settings

Four expandable sections — Color Blind, Visual, High Contrast, Audio — each
holding individual, atomic controls. No presets, no "Custom" mode, by
design: the user only ever picks exactly what they want, nothing bundled.
Everything applies instantly and app-wide (not just to generated content),
via `frontend/settings.js`, which:

- stores one flat settings object in `localStorage`,
- applies it as CSS custom properties + a couple of `data-`/class flags on
  `<html>`/`<body>` (`--text-scale`, `--ui-scale`, `--button-scale`,
  `--gap-scale`, `--font-family`, `--cvd-filter`, `data-contrast`), so every
  screen picks the change up automatically without any per-screen logic,
  and
- owns two small standalone features that don't need the backend at all:
  short audio cues (synthesized in-browser via WebAudio, no sound files)
  and read-aloud (via the browser's built-in `speechSynthesis`).

**One honest caveat on the Color Blind section.** The obvious approach —
a CSS/SVG filter labeled "Protanopia correction" etc. — doesn't actually
work the way it sounds. Those matrices (the ones Chrome DevTools itself
uses) are built to *simulate* color blindness for sighted viewers, not
*correct* it for colorblind viewers; applying one to an already-colorblind
person's screen doesn't help and could plausibly make things worse. Real
correction (Daltonization) needs a heavier per-pixel process and its
benefit is genuinely debated even then. Rather than ship something that
sounds right but doesn't do what it claims, this section instead offers:
a genuine Grayscale filter, a mild saturation-boost filter (helps some
anomalous, non-dichromatic color vision), and — the actual highest-leverage
fix — an app-wide color palette that avoids red/green (using blue/orange
instead, which stays distinguishable across protanopia and deuteranopia)
plus a hard rule that nothing in the UI signals state through color alone
(the active content-type button gets a ✓, not just a border color; every
error gets a ⚠️ prefix, not just red text). If you want true Daltonization
for the competition, it's a real feature to add later, just not a quick
filter swap — flag it and we'll scope it properly with canvas/WebGL rather
than faking it.

**Read-aloud today vs. Phase 5.** The Audio section's "read aloud" already
works right now using the device's built-in voice via `speechSynthesis` —
free, offline, zero extra API calls, but voice quality/language coverage
varies a lot by device and OS. Phase 5 (Gemini TTS) is still worth doing
for actually good Hindi/Tamil/Bengali voices; when it lands, swap
`speak()` in `settings.js` for a call to your new `/api/speak` endpoint —
the setting itself (`readAloud`, `voiceSpeed`, `voiceVolume`) doesn't need
to change.

## Architecture in one paragraph

A plain HTML/CSS/JS frontend (`frontend/`) talks to a small FastAPI backend
(`backend/`). The backend holds your Gemini API key (never put it in the
frontend — anyone could unzip an APK and read it) and makes exactly one
Gemini call per request: it sends your content + your instruction (as audio
or text) together, and Gemini transcribes the instruction, figures out what
combination of transformations you asked for, and returns the result — all
in one model, one API call. Later, the same frontend becomes your Capacitor
Android app; the backend stays deployed on the web and the app just calls it
over HTTPS.

## Day 1 setup (about 20-30 minutes)

### 1. Get a Gemini API key
Go to https://aistudio.google.com/apikey, sign in with any Google account,
click "Create API key". No credit card, no KYC. Copy the key.

### 2. Backend setup
```bash
cd backend
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# open .env and paste your key into GEMINI_API_KEY=
```

Run it:
```bash
python3 main.py
```
You should see uvicorn start on port 8000. Verify in another terminal:
```bash
curl http://127.0.0.1:8000/api/health
# {"ok":true,"model":"gemini-2.5-flash","gemini_configured":true}
```
If `gemini_configured` is `false`, your `.env` isn't being picked up — check
you're running `python3 main.py` from inside `backend/`.

### 3. Frontend setup
No build step. Just serve the folder so the browser treats it as a real
origin (not `file://`, which breaks microphone permission prompts):
```bash
cd frontend
python3 -m http.server 5500
```
Open http://127.0.0.1:5500 in Chrome.

### 4. Try it end-to-end
1. Paste some text into the text box (Text is selected by default).
2. Tap "🎙️ Tell me what you need" and say something like *"translate this
   into Hindi and make it simple"* — or just type it in the box below and
   hit Go, no mic needed.
3. You should land on the output screen with the transformed text.
4. Try a follow-up: *"explain the first sentence"* or type one.

If anything fails, the app will tell you in plain language what broke
(mic permission, backend unreachable, missing API key, etc.) — that's
intentional; don't spend Day 1 debugging silent failures.

## Why this stack, briefly

- **Gemini over Qwen Omni**: Qwen3.5-Omni is a genuinely strong omni-modal
  model, but the international DashScope signup requires Alibaba Cloud KYC,
  and the standalone free tier wants a Chinese phone number for
  verification — real risk of losing a day of your 12 to account setup.
  Gemini's AI Studio key is instant and free, and covers your actual
  requirements: text/image/PDF/audio understanding, Hindi/Tamil/Bengali
  translation and TTS, and follow-up conversation, all natively.
- **One backend call per turn, not streaming**: simpler to build and debug
  in a time-boxed sprint. You can add streaming later if you want the
  output to appear progressively, but it's not needed for a working demo.
- **MediaRecorder → raw audio → Gemini, not Web Speech API**: browser
  speech-recognition APIs are unreliable inside an Android WebView (which is
  what your packaged app will run in), so recording audio and letting
  Gemini transcribe it is both simpler and more portable.
- **No frontend framework**: keeps this a flat folder Capacitor can point
  `webDir` at directly with zero adaptation later.

## Known rough edges to expect (not bugs, just Day-1 honesty)

- The backend's `ALLOWED_ORIGINS` in `.env` must include whatever origin
  your frontend is actually served from. `http://127.0.0.1:5500` is set as
  a default — if you serve from a different port, add it.
- Gemini's officially documented audio MIME types are WAV/MP3/AIFF/AAC/OGG/
  FLAC, though Google's own Firebase docs also list WEBM/OPUS as accepted
  for the same models — which is what your browser's `MediaRecorder`
  actually produces. In testing here this worked; if you ever get an audio
  rejection error from Gemini, the fix is recording in a different mimeType
  (`MediaRecorder` supports `audio/ogg;codecs=opus` in some browsers) — flag
  it and we'll patch `app.js`.
- `gemini-2.5-flash` is set as the default model in `.env.example` because
  it's a stable, well-documented choice. Check your AI Studio console for
  whichever `gemini-3-*` flash model is available to your account and swap
  it in — likely faster and cheaper.

## Roadmap (matches your phase plan)

- **Phase 3 (images)**: add an `image` field to the `/api/transform` form,
  send it as `types.Part.from_bytes(data=..., mime_type="image/jpeg")`
  alongside the instruction — same endpoint, same JSON contract, no new
  concepts.
- **Phase 4 (PDF/documents)**: same pattern, `mime_type="application/pdf"`.
  Gemini reads PDFs natively — no separate OCR step needed.
- **Phase 5 (TTS)**: the backend JSON already returns `wants_audio`. Add a
  second endpoint `/api/speak` that calls `gemini-3.1-flash-tts-preview`
  with the `transformed_output` text and streams back audio; play it with
  an `<audio>` tag. This is a genuinely small addition given the plumbing
  already here.
- **Phase 6**: voice-as-content and video are the remaining input types;
  same request shape, just another `Part`.
- **Phase 7 (Capacitor/APK)**: `npm install @capacitor/core @capacitor/cli`,
  `npx cap init`, set `webDir` to `frontend/`, `npx cap add android`,
  `npx cap sync`, then open in Android Studio to build the signed APK.
  Before this step, deploy the backend somewhere reachable (Render, Fly.io,
  or similar free tier) and update `config.js`'s `API_BASE` to that URL —
  `127.0.0.1` only ever means "the phone itself" once this is on a device.
- **Phase 8**: error states are already handled reasonably throughout; the
  remaining polish is mostly font-size controls and a visible "reading
  aloud" state once TTS lands.

I'd suggest we tackle Phase 3 (images) next once you've confirmed Phase 2
works end-to-end on your machine with your own key.
