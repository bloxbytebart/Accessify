"""
Accessify backend smoke test.

Hits every endpoint and every error path we've deliberately built, so you
can catch a backend regression in seconds instead of clicking through the
whole app by hand every time you change something.

Usage:
    python3 test_backend.py [base_url]

    base_url defaults to http://127.0.0.1:8000 (your local dev server).
    Point it at your Render URL instead to test the live deployment:
    python3 test_backend.py https://accessify-1i0n.onrender.com

This does NOT need your Gemini key to be valid for most checks - the
first few tests deliberately check error-handling paths that fire before
any real Gemini call. The "real" tests near the end DO need a working key
and will actually call Gemini (small cost, a handful of cheap calls).
"""

import sys
import requests

BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"

passed = 0
failed = 0


def check(name, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
        print(f"  PASS  {name}")
    else:
        failed += 1
        print(f"  FAIL  {name}  {detail}")


def section(title):
    print(f"\n=== {title} ===")


# ---------- Health ----------
section("Health check")
try:
    r = requests.get(f"{BASE_URL}/api/health", timeout=10)
    data = r.json()
    check("returns 200", r.status_code == 200)
    check("has ok:true", data.get("ok") is True, data)
    check("gemini_configured present", "gemini_configured" in data, data)
    key_configured = data.get("gemini_configured", False)
    if not key_configured:
        print("  NOTE  gemini_configured is False - real Gemini calls below will fail. "
              "That's expected if you're testing without a key set.")
except Exception as e:
    check("server reachable at all", False, str(e))
    print("\nBackend unreachable - stopping here, nothing else can be tested.")
    sys.exit(1)


# ---------- Input validation (no Gemini call needed) ----------
section("Input validation errors")

r = requests.post(f"{BASE_URL}/api/transform", data={
    "content_text": "", "instruction_text": "", "history_json": "[]", "combined": "false",
})
check("empty everything -> error, not crash", r.status_code == 200 and "error" in r.json(), r.text)

r = requests.post(f"{BASE_URL}/api/transform", data={
    "content_text": "hello", "instruction_text": "", "history_json": "[]", "combined": "false",
})
check("content with no instruction -> error", "error" in r.json(), r.text)

r = requests.post(f"{BASE_URL}/api/transform", data={
    "content_text": "", "instruction_text": "translate this", "history_json": "[]", "combined": "false",
})
check("instruction with no content, no history -> error", "error" in r.json(), r.text)

r = requests.post(f"{BASE_URL}/api/speak", data={"text": "", "voice_speed": "1.0"})
if key_configured:
    check("empty text to /api/speak -> 400 error", r.status_code == 400, r.text)
else:
    check("no key configured -> 500 error (checked before input validation)", r.status_code == 500, r.text)


# ---------- Real Gemini calls (only meaningful if key is configured) ----------
if key_configured:
    section("Real transform - plain text")
    r = requests.post(f"{BASE_URL}/api/transform", data={
        "content_text": "The sky is blue and the grass is green.",
        "instruction_text": "translate this into Hindi",
        "history_json": "[]",
        "combined": "false",
    })
    data = r.json()
    check("no error field", "error" not in data, data)
    check("has transformed_output", bool(data.get("transformed_output")), data)
    check("has detected_instruction", bool(data.get("detected_instruction")), data)
    check("has history for follow-ups", isinstance(data.get("history"), list), data)

    section("Real transform - follow-up using history")
    history = data.get("history", [])
    r2 = requests.post(f"{BASE_URL}/api/transform", data={
        "content_text": "",
        "instruction_text": "make it even simpler",
        "history_json": __import__("json").dumps(history),
        "combined": "false",
    })
    data2 = r2.json()
    check("follow-up works with empty content_text", "error" not in data2, data2)

    section("Real transform - combined voice-as-content mode (typed)")
    r3 = requests.post(f"{BASE_URL}/api/transform", data={
        "content_text": "",
        "instruction_text": "Roses are red, violets are blue. Translate that into French.",
        "history_json": "[]",
        "combined": "true",
    })
    data3 = r3.json()
    check("combined mode works", "error" not in data3, data3)

    section("Real TTS call")
    r4 = requests.post(f"{BASE_URL}/api/speak", data={"text": "Hello, this is a test.", "voice_speed": "1.0"})
    check("TTS returns 200", r4.status_code == 200, r4.text[:200])
    check("TTS returns audio content-type", "audio" in r4.headers.get("content-type", ""), r4.headers)
    check("TTS returns non-trivial audio bytes", len(r4.content) > 1000, f"got {len(r4.content)} bytes")
else:
    print("\nSkipping real Gemini/TTS tests since gemini_configured is False.")


# ---------- Summary ----------
print(f"\n{'='*40}")
print(f"  {passed} passed, {failed} failed")
print(f"{'='*40}")
sys.exit(1 if failed else 0)
