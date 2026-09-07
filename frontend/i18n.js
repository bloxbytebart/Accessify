/* Accessify i18n: translates the app's own UI chrome (buttons, labels,
   settings) - completely separate from the AI transformation itself,
   which already handles any language via the user's instruction. This
   only affects what the app's OWN interface says, e.g. "Text size" vs
   "टेक्स्ट का आकार".

   Design: every language file only needs to exist once translations are
   ready for it - LANGUAGES lists every language we intend to support so
   the selector is complete today, and load() gracefully falls back to
   English for any not-yet-translated file rather than breaking. */

const LANGUAGES = [
  { code: "en", native: "English" },
  { code: "hi", native: "हिन्दी" },
  { code: "bn", native: "বাংলা" },
  { code: "mr", native: "मराठी" },
  { code: "te", native: "తెలుగు" },
  { code: "ta", native: "தமிழ்" },
  { code: "gu", native: "ગુજરાતી" },
  { code: "ur", native: "اردو" },
  { code: "kn", native: "ಕನ್ನಡ" },
  { code: "or", native: "ଓଡ଼ିଆ" },
  { code: "ml", native: "മലയാളം" },
  { code: "pa", native: "ਪੰਜਾਬੀ" },
  { code: "as", native: "অসমীয়া" },
  { code: "sa", native: "संस्कृतम्" },
  { code: "mai", native: "मैथिली" },
  { code: "kok", native: "कोंकणी" },
  { code: "ne", native: "नेपाली" },
  { code: "sd", native: "سنڌي" },
  { code: "doi", native: "डोगरी" },
  { code: "brx", native: "बड़ो" },
  { code: "mni", native: "মৈতৈলোন্" },
  { code: "ks", native: "کٲشُر" },
  { code: "sat", native: "ᱥᱟᱱᱛᱟᱲᱤ" },
];

// Tiny synchronous fallback for the couple of strings that get rendered
// via JS before the async language file necessarily finishes loading
// (e.g. a toggle switch's initial "On"/"Off" label at page load) - avoids
// a brief flash of the raw key name before the real dictionary arrives.
let englishDict = { "toggle.on": "On", "toggle.off": "Off" };
let englishLoaded = false;
let activeDict = englishDict;

async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Could not load ${path}`);
  return res.json();
}

async function load(langCode) {
  if (!englishLoaded) {
    englishDict = await fetchJson("i18n/en.json");
    englishLoaded = true;
  }
  if (langCode === "en") {
    activeDict = englishDict;
    return activeDict;
  }
  try {
    const dict = await fetchJson(`i18n/${langCode}.json`);
    // Merge over English so any string not yet translated in a partial
    // file still shows *something* instead of going blank.
    activeDict = { ...englishDict, ...dict };
  } catch {
    console.warn(`i18n: ${langCode} not available yet, falling back to English.`);
    activeDict = englishDict;
  }
  return activeDict;
}

function t(key, vars) {
  let str = (activeDict && activeDict[key]) || (englishDict && englishDict[key]) || key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(`{${k}}`, v);
    }
  }
  return str;
}

function apply() {
  if (!activeDict) return;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.getAttribute("data-i18n-placeholder"));
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
    el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria-label")));
  });
}

window.AccessifyI18n = { LANGUAGES, load, apply, t };
