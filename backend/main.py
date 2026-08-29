"""
Accessify backend
----------------------------
One job: take (content + a natural-language instruction, spoken or typed)
and return the transformed result, using a single Gemini multimodal call.

Why a backend at all, instead of calling Gemini straight from the browser?
Because the Gemini API key must never ship inside the Android APK - anyone
could unzip it and steal your key. This tiny FastAPI service holds the key
server-side and is the only thing the app talks to.
"""

import io
import json
import os
import wave
from typing import List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from google import genai
from google.genai import types

load_dotenv()

API_KEY = os.environ.get("GEMINI_API_KEY")
MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.6-flash")
TTS_MODEL = os.environ.get("GEMINI_TTS_MODEL", "gemini-3.1-flash-tts-preview")
TTS_VOICE = os.environ.get("GEMINI_TTS_VOICE", "Kore")
ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "*").split(",")

app = FastAPI(title="Accessify backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

client: Optional[genai.Client] = None
if API_KEY:
    client = genai.Client(api_key=API_KEY)


SYSTEM_PROMPT = """You are the transformation engine behind Accessify, \
an accessibility-first app used by people of different ages, abilities, \
languages, and literacy levels.

You will be given:
- CONTENT: the material the user wants transformed. It may be empty if this \
is a follow-up turn that only refers to something already discussed earlier \
in this conversation.
- INSTRUCTION: what the user wants done, given as spoken audio or typed \
text. It may combine several requests at once (for example: translate + \
simplify + keep names unchanged + summarize + give only key points).

LANGUAGE RULE - follow this exactly, it is the most commonly broken rule:
The language of "transformed_output" is ALWAYS the language of the CONTENT \
(or, on a follow-up, the language of the most recent output in this \
conversation), UNLESS the instruction explicitly names a different target \
language ("translate into X", "in Hindi", "in Tamil", etc.) - in which \
case use that named language instead.
The language the INSTRUCTION happens to be written or spoken in is \
IRRELEVANT to the output language and must never influence it. A Hindi \
instruction applied to Hindi content, with no language explicitly named, \
must produce Hindi output - not English. A Hindi instruction applied to \
English content, with no language named, must produce English output. \
Never default to English just because these system instructions and the \
"detected_instruction" field are written in English - that field is \
metadata for the app's own UI, not a signal about what language to answer \
in.

Your job:
1. Understand the instruction, however many things it combines.
2. Apply every requested transformation to the CONTENT (or, on a follow-up, \
to the most relevant earlier content/output already in this conversation).
3. Produce clear, natural, correctly formatted output in the requested \
style, in whatever language the LANGUAGE RULE above resolves to.
4. If the instruction says to keep something unchanged (names, numbers, \
technical terms), honor that exactly.
5. If the instruction is unclear or impossible given what you have, say so \
plainly inside transformed_output (in the correct output language) rather \
than guessing wildly.

Respond with ONLY a single JSON object - no markdown fences, no commentary \
outside the object - with exactly these keys:
{
  "detected_instruction": "a short, clear restatement in English of what \
the user asked for, based on the audio or text you received",
  "transformed_output": "the final transformed content the user should see",
  "target_language": "BCP-47 code if a translation was requested, otherwise null",
  "wants_audio": true or false, depending on whether the user asked to hear \
it read aloud / spoken
}
"""


def build_history_contents(history: List[dict]) -> List[types.Content]:
    """Turn our simple [{"role": "user"/"model", "text": "..."}] history
    into Gemini Content objects."""
    contents = []
    for turn in history:
        role = "user" if turn.get("role") == "user" else "model"
        contents.append(
            types.Content(role=role, parts=[types.Part.from_text(text=turn.get("text", ""))])
        )
    return contents


@app.get("/api/health")
def health():
    return {"ok": True, "model": MODEL, "gemini_configured": client is not None}


@app.post("/api/transform")
async def transform(
    content_text: str = Form(""),
    instruction_text: str = Form(""),
    history_json: str = Form("[]"),
    instruction_audio: Optional[UploadFile] = None,
    content_image: Optional[UploadFile] = None,
):
    if client is None:
        return {
            "error": "GEMINI_API_KEY is not set on the backend. "
            "Copy .env.example to .env and add your key from "
            "https://aistudio.google.com/apikey"
        }

    try:
        history = json.loads(history_json) if history_json else []
    except json.JSONDecodeError:
        history = []

    if not content_text.strip() and content_image is None and not history:
        return {"error": "No content provided and no prior conversation to follow up on."}
    if not instruction_text.strip() and instruction_audio is None:
        return {"error": "No instruction given (neither typed text nor recorded audio)."}

    user_parts: List[types.Part] = []
    content_summary_for_history = "(none)"

    if content_image is not None:
        image_bytes = await content_image.read()
        image_mime = (content_image.content_type or "image/jpeg").split(";")[0]
        user_parts.append(
            types.Part.from_text(
                text="CONTENT: an image is attached below. Read any text in it "
                "(OCR) and treat that - plus anything else relevant you can see "
                "- as the CONTENT to transform, unless the instruction is "
                "specifically asking you to describe or explain the image itself."
            )
        )
        user_parts.append(types.Part.from_bytes(data=image_bytes, mime_type=image_mime))
        content_summary_for_history = "(an image was provided as content)"
    else:
        content_summary_for_history = content_text if content_text.strip() else "(none - follow-up)"
        user_parts.append(
            types.Part.from_text(
                text=f"CONTENT:\n{content_text if content_text.strip() else '(none - this is a follow-up, use the conversation so far)'}"
            )
        )

    if instruction_audio is not None:
        audio_bytes = await instruction_audio.read()
        mime_type = (instruction_audio.content_type or "audio/webm").split(";")[0]
        user_parts.append(types.Part.from_text(text="INSTRUCTION (spoken, transcribe then follow it):"))
        user_parts.append(types.Part.from_bytes(data=audio_bytes, mime_type=mime_type))
    else:
        user_parts.append(types.Part.from_text(text=f"INSTRUCTION (typed):\n{instruction_text}"))

    contents = build_history_contents(history)
    contents.append(types.Content(role="user", parts=user_parts))

    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT,
        response_mime_type="application/json",
    )

    try:
        response = client.models.generate_content(model=MODEL, contents=contents, config=config)
    except Exception as exc:  # noqa: BLE001 - surface any Gemini/SDK error as clean JSON,
        # not a raw 500 page the frontend can't parse (this is what caused
        # the "NetworkError" confusion when the model name was retired).
        return {"error": f"The AI request failed: {exc}"}

    try:
        result = json.loads(response.text)
    except (json.JSONDecodeError, TypeError):
        return {"error": "Model did not return valid JSON.", "raw": response.text}

    detected_instruction = result.get("detected_instruction", "")
    transformed_output = result.get("transformed_output", "")

    new_history = history + [
        {"role": "user", "text": f"[CONTENT]\n{content_summary_for_history}\n\n[INSTRUCTION]\n{detected_instruction}"},
        {"role": "model", "text": transformed_output},
    ]

    result["history"] = new_history
    return result


@app.post("/api/speak")
async def speak(text: str = Form(...), voice_speed: float = Form(1.0)):
    """Turn text into speech using Gemini's TTS model - real, natural
    voices in the text's own language (Hindi/Tamil/Bengali/etc. included),
    a big step up from the browser's built-in speechSynthesis voice.
    Volume is handled client-side (just the <audio> element's volume), but
    pace is a genuine model instruction since Gemini TTS takes style/pace
    as plain-language prefixes rather than a numeric parameter."""
    if client is None:
        return JSONResponse(
            {"error": "GEMINI_API_KEY is not set on the backend."}, status_code=500
        )
    if not text.strip():
        return JSONResponse({"error": "No text to speak."}, status_code=400)

    style_prefix = ""
    if voice_speed <= 0.85:
        style_prefix = "Say this slowly and clearly: "
    elif voice_speed >= 1.3:
        style_prefix = "Say this at a brisk, energetic pace: "

    try:
        tts_response = client.models.generate_content(
            model=TTS_MODEL,
            contents=style_prefix + text,
            config=types.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=types.SpeechConfig(
                    voice_config=types.VoiceConfig(
                        prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=TTS_VOICE)
                    )
                ),
            ),
        )
        pcm_data = tts_response.candidates[0].content.parts[0].inline_data.data
    except Exception as exc:  # noqa: BLE001 - surface any Gemini/SDK error to the client
        return JSONResponse({"error": f"TTS generation failed: {exc}"}, status_code=502)

    # Gemini TTS returns raw 24kHz 16-bit mono PCM - wrap it in a WAV
    # header so the browser's <audio> element can play it directly.
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(24000)
        wf.writeframes(pcm_data)

    return Response(content=buf.getvalue(), media_type="audio/wav")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
