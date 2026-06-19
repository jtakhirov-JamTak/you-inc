import { NextResponse } from "next/server";
import OpenAI from "openai";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";
import { checkOrigin } from "@/lib/check-origin";

export const runtime = "nodejs";

const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const MIN_AUDIO_BYTES = 2 * 1024;

// Magic-byte sniff. The Blob's self-declared `type` is client-supplied and
// trivially spoofable — without this, an attacker can upload any file and
// bill our OpenAI account.
function looksLikeAudio(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  // WebM / Matroska: 1A 45 DF A3
  if (
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return true;
  }
  // ISO-BMFF (mp4/m4a): bytes 4..7 === "ftyp"
  if (
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    return true;
  }
  // MP3: ID3 tag
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return true;
  }
  // MP3 raw frame sync: 0xFFFB / 0xFFF3 / 0xFFF2
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    return true;
  }
  // OGG
  if (
    bytes[0] === 0x4f &&
    bytes[1] === 0x67 &&
    bytes[2] === 0x67 &&
    bytes[3] === 0x53
  ) {
    return true;
  }
  // WAV: "RIFF"...."WAVE"
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x41 &&
    bytes[10] === 0x56 &&
    bytes[11] === 0x45
  ) {
    return true;
  }
  return false;
}

export async function POST(req: Request) {
  if (!checkOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Per-minute burst cap + per-day total cap. Both guard against cost-bleed
  // if an account gets scripted. Note: in-memory, per-instance — see
  // src/lib/rate-limit.ts for launch-time swap notes.
  const minuteRl = await rateLimit(`transcribe:min:${user.id}`, {
    limit: 6,
    windowMs: 60_000,
  });
  if (!minuteRl.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            Math.ceil((minuteRl.resetAt - Date.now()) / 1000)
          ),
        },
      }
    );
  }
  const dayRl = await rateLimit(`transcribe:day:${user.id}`, {
    limit: 60,
    windowMs: 24 * 60 * 60 * 1000,
  });
  if (!dayRl.allowed) {
    return NextResponse.json(
      { error: "Daily transcription limit reached" },
      { status: 429 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const audio = form.get("audio");

  if (!(audio instanceof Blob)) {
    return NextResponse.json({ error: "Missing audio" }, { status: 400 });
  }
  if (audio.size < MIN_AUDIO_BYTES) {
    return NextResponse.json({ error: "Audio too small" }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "Audio too large" }, { status: 413 });
  }
  if (!audio.type.startsWith("audio/")) {
    return NextResponse.json({ error: "Invalid audio type" }, { status: 400 });
  }

  const buffer = await audio.arrayBuffer();
  const head = new Uint8Array(buffer.slice(0, 16));
  if (!looksLikeAudio(head)) {
    return NextResponse.json(
      { error: "Unrecognized audio format" },
      { status: 400 }
    );
  }

  const ext = audio.type.includes("mp4")
    ? "mp4"
    : audio.type.includes("mpeg")
    ? "mp3"
    : audio.type.includes("ogg")
    ? "ogg"
    : audio.type.includes("wav")
    ? "wav"
    : "webm";

  try {
    const file = new File([buffer], `audio.${ext}`, { type: audio.type });

    const client = new OpenAI();
    const result = await client.audio.transcriptions.create({
      file,
      model: "whisper-1",
      language: "en",
      response_format: "json",
    });

    return NextResponse.json({ text: result.text ?? "" });
  } catch (err) {
    const status =
      (err as { status?: number })?.status ?? "unknown";
    Sentry.captureException(err, {
      tags: {
        area: "transcribe",
        kind: String(status),
      },
    });
    console.error("transcribe failed", status);
    return NextResponse.json(
      { error: "Transcription failed" },
      { status: 502 }
    );
  }
}
