// ============ Settings ============
let settings = window.AccessifySettings.load();
window.AccessifySettings.apply(settings);

function updateSetting(key, value) {
  settings[key] = value;
  window.AccessifySettings.save(settings);
  window.AccessifySettings.apply(settings);
}

// ============ State ============
let history = [];
let mediaRecorder = null;
let recordedChunks = [];
let activeRecordingTarget = null; // "home" | "followup"
let screenBeforeSettings = "home";

// ============ Element refs ============
const screenHome = document.getElementById("screen-home");
const screenOutput = document.getElementById("screen-output");
const screenSettings = document.getElementById("screen-settings");
const loadingOverlay = document.getElementById("loading-overlay");

const contentBtns = document.querySelectorAll(".content-btn");
const textInputArea = document.getElementById("text-input-area");
const imageInputArea = document.getElementById("image-input-area");
const comingSoonArea = document.getElementById("coming-soon-area");
const contentTextEl = document.getElementById("content-text");
const contentImageInput = document.getElementById("content-image-input");
const imagePreview = document.getElementById("image-preview");

const micBtn = document.getElementById("mic-btn");
const recordingIndicator = document.getElementById("recording-indicator");
const instructionTextEl = document.getElementById("instruction-text");
const goBtn = document.getElementById("go-btn");
const homeError = document.getElementById("home-error");

const backBtn = document.getElementById("back-btn");
const detectedInstructionEl = document.getElementById("detected-instruction");
const resultTextEl = document.getElementById("result-text");
const outputError = document.getElementById("output-error");
const readAloudBtn = document.getElementById("read-aloud-btn");

const followupMicBtn = document.getElementById("followup-mic-btn");
const followupRecordingIndicator = document.getElementById("followup-recording-indicator");
const followupTextEl = document.getElementById("followup-text");
const followupGoBtn = document.getElementById("followup-go-btn");

const settingsBtnHome = document.getElementById("settings-btn-home");
const settingsBtnOutput = document.getElementById("settings-btn-output");
const settingsBackBtn = document.getElementById("settings-back-btn");

// ============ Content type selection ============
let selectedContentType = "text";
let selectedImageFile = null;

contentBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    contentBtns.forEach((b) => {
      b.classList.remove("active");
      const check = b.querySelector(".active-check");
      if (check) check.remove();
    });
    btn.classList.add("active");
    if (!btn.querySelector(".active-check")) {
      const check = document.createElement("span");
      check.className = "active-check";
      check.setAttribute("aria-hidden", "true");
      check.textContent = "✓";
      btn.appendChild(check);
    }
    selectedContentType = btn.dataset.type;
    textInputArea.classList.toggle("hidden", selectedContentType !== "text");
    imageInputArea.classList.toggle("hidden", selectedContentType !== "image");
    comingSoonArea.classList.toggle(
      "hidden",
      selectedContentType === "text" || selectedContentType === "image"
    );
  });
});

contentImageInput.addEventListener("change", () => {
  const file = contentImageInput.files[0];
  if (!file) {
    selectedImageFile = null;
    imagePreview.classList.add("hidden");
    return;
  }
  selectedImageFile = file;
  const url = URL.createObjectURL(file);
  imagePreview.src = url;
  imagePreview.classList.remove("hidden");
  imagePreview.onload = () => URL.revokeObjectURL(url);
});

// ============ Recording ============
async function startRecording(target) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    activeRecordingTarget = target;
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      if (activeRecordingTarget === "home") submitHome({ audioBlob: blob });
      else submitFollowup({ audioBlob: blob });
    };
    mediaRecorder.start();
    setRecordingUI(target, true);
    if (settings.audioCues) window.AccessifySettings.playCue("start");

    setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === "recording") stopRecording();
    }, 20000);
  } catch (err) {
    showError(target === "home" ? homeError : outputError,
      "Couldn't access the microphone. You can type your instruction instead.");
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
  if (settings.audioCues) window.AccessifySettings.playCue("stop");
  setRecordingUI(activeRecordingTarget, false);
}

function setRecordingUI(target, isRecording) {
  const btn = target === "home" ? micBtn : followupMicBtn;
  const indicator = target === "home" ? recordingIndicator : followupRecordingIndicator;
  btn.classList.toggle("recording", isRecording);
  indicator.classList.toggle("hidden", !isRecording);
  btn.textContent = isRecording ? "🎙️ Tap to stop" : (target === "home" ? "🎙️ Tell me what you need" : "🎙️ Ask a follow-up");
}

micBtn.addEventListener("click", () => {
  if (mediaRecorder && mediaRecorder.state === "recording") stopRecording();
  else startRecording("home");
});

followupMicBtn.addEventListener("click", () => {
  if (mediaRecorder && mediaRecorder.state === "recording") stopRecording();
  else startRecording("followup");
});

// ============ Typed fallback buttons ============
goBtn.addEventListener("click", () => {
  const text = instructionTextEl.value.trim();
  if (!text) { showError(homeError, "Type an instruction, or use the mic button."); return; }
  submitHome({ instructionText: text });
});

followupGoBtn.addEventListener("click", () => {
  const text = followupTextEl.value.trim();
  if (!text) { showError(outputError, "Type a follow-up, or use the mic button."); return; }
  submitFollowup({ instructionText: text });
});

// ============ Read aloud ============
readAloudBtn.addEventListener("click", () => {
  window.AccessifySettings.speak(resultTextEl.textContent, settings);
});

// ============ Submit logic ============
async function submitHome({ instructionText, audioBlob }) {
  clearError(homeError);

  const form = new FormData();
  form.append("history_json", "[]");

  if (selectedContentType === "text") {
    const contentText = contentTextEl.value.trim();
    if (!contentText) {
      showError(homeError, "Add some text content first.");
      return;
    }
    form.append("content_text", contentText);
  } else if (selectedContentType === "image") {
    if (!selectedImageFile) {
      showError(homeError, "Choose or take a photo first.");
      return;
    }
    form.append("content_image", selectedImageFile, selectedImageFile.name || "content.jpg");
  } else {
    showError(homeError, "This input type isn't wired up yet in this build — try Text or Image.");
    return;
  }

  if (audioBlob) form.append("instruction_audio", audioBlob, "instruction.webm");
  else form.append("instruction_text", instructionText);

  await callTransform(form, { isFollowup: false });
}

async function submitFollowup({ instructionText, audioBlob }) {
  clearError(outputError);
  const form = new FormData();
  form.append("content_text", "");
  form.append("history_json", JSON.stringify(history));
  if (audioBlob) form.append("instruction_audio", audioBlob, "instruction.webm");
  else form.append("instruction_text", instructionText);

  await callTransform(form, { isFollowup: true });
}

async function callTransform(form, { isFollowup }) {
  showLoading(true);
  try {
    const res = await fetch(`${API_BASE}/api/transform`, { method: "POST", body: form });
    const data = await res.json();

    if (data.error) {
      if (settings.audioCues) window.AccessifySettings.playCue("error");
      showError(isFollowup ? outputError : homeError, data.error);
      showLoading(false);
      return;
    }

    history = data.history || history;
    detectedInstructionEl.textContent = `You asked: "${data.detected_instruction || ""}"`;
    resultTextEl.textContent = data.transformed_output || "";
    clearError(outputError);
    if (settings.audioCues) window.AccessifySettings.playCue("success");
    if (settings.readAloud) window.AccessifySettings.speak(data.transformed_output || "", settings);
    showScreen("output");
  } catch (err) {
    if (settings.audioCues) window.AccessifySettings.playCue("error");
    showError(isFollowup ? outputError : homeError,
      `Couldn't reach the backend at ${API_BASE}. Is it running? (${err.message})`);
  } finally {
    showLoading(false);
  }
}

// ============ Navigation ============
backBtn.addEventListener("click", () => showScreen("home"));

settingsBtnHome.addEventListener("click", () => { screenBeforeSettings = "home"; showScreen("settings"); });
settingsBtnOutput.addEventListener("click", () => { screenBeforeSettings = "output"; showScreen("settings"); });
settingsBackBtn.addEventListener("click", () => showScreen(screenBeforeSettings));

function showScreen(name) {
  screenHome.classList.toggle("hidden", name !== "home");
  screenOutput.classList.toggle("hidden", name !== "output");
  screenSettings.classList.toggle("hidden", name !== "settings");
}

function showLoading(isLoading) {
  loadingOverlay.classList.toggle("hidden", !isLoading);
}

function showError(el, message) {
  el.textContent = `⚠️ ${message}`;
  el.classList.remove("hidden");
}

function clearError(el) {
  el.textContent = "";
  el.classList.add("hidden");
}

// ============ Settings screen wiring ============
document.querySelectorAll(".pill-group").forEach((group) => {
  const key = group.dataset.setting;
  const pills = group.querySelectorAll(".pill");
  pills.forEach((pill) => {
    pill.classList.toggle("selected", pill.dataset.value === settings[key]);
    pill.addEventListener("click", () => {
      pills.forEach((p) => p.classList.remove("selected"));
      pill.classList.add("selected");
      updateSetting(key, pill.dataset.value);
    });
  });
});

document.querySelectorAll(".toggle-row").forEach((row) => {
  const key = row.dataset.setting;
  const btn = row.querySelector(".toggle-switch");
  const label = btn.querySelector(".toggle-state");

  function render() {
    const isOn = !!settings[key];
    btn.setAttribute("aria-checked", String(isOn));
    label.textContent = isOn ? "On" : "Off";
  }
  render();

  btn.addEventListener("click", () => {
    updateSetting(key, !settings[key]);
    render();
  });
});

document.querySelectorAll('input[type="range"][data-setting]').forEach((slider) => {
  const key = slider.dataset.setting;
  slider.value = settings[key];
  slider.addEventListener("input", () => {
    updateSetting(key, parseFloat(slider.value));
  });
});
