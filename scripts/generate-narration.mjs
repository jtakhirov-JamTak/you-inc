// Render the guided-visualization narration to static MP3 clips via ElevenLabs.
//
// This runs OFFLINE (one time, or whenever a line's text changes) — the ElevenLabs
// key never ships in the app. The clips it writes to /public/audio/{id}.mp3 are
// plain static assets the PWA plays; there is no runtime API call, cost, or
// third-party data flow at app-use time.
//
// Usage (PowerShell):
//   $env:ELEVENLABS_API_KEY="sk_..."; $env:ELEVENLABS_VOICE_ID="<voice id>"; \
//     node scripts/generate-narration.mjs
//   add --force to overwrite clips that already exist.
//
// Source of truth for what's spoken: src/lib/narration.json (shared with the app).

import { readFile, mkdir, writeFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_DIR = join(ROOT, "public", "audio");

const API_KEY = process.env.ELEVENLABS_API_KEY;
// Default voice = "Rachel" (calm, neutral). Override with ELEVENLABS_VOICE_ID.
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
const MODEL_ID = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";
const FORCE = process.argv.includes("--force");

// Calm, steady guided-meditation delivery.
const VOICE_SETTINGS = {
  stability: 0.6,
  similarity_boost: 0.75,
  style: 0.0,
  use_speaker_boost: true,
};

if (!API_KEY) {
  console.error(
    "Missing ELEVENLABS_API_KEY. Set it in the environment, e.g.\n" +
      '  $env:ELEVENLABS_API_KEY="sk_..."; node scripts/generate-narration.mjs',
  );
  process.exit(1);
}

const exists = (p) =>
  access(p).then(
    () => true,
    () => false,
  );

async function loadLines() {
  const raw = await readFile(join(ROOT, "src", "lib", "narration.json"), "utf8");
  const data = JSON.parse(raw);
  const lines = [];
  for (const scene of [data.future, data.obstacle]) {
    for (const step of scene.steps) lines.push({ id: step.id, text: step.text });
    lines.push({ id: scene.endId, text: scene.endText });
  }
  return lines;
}

async function synth(text) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": API_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: MODEL_ID,
        voice_settings: VOICE_SETTINGS,
      }),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs ${res.status} ${res.statusText} — ${detail}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const lines = await loadLines();
  console.log(
    `Rendering ${lines.length} clips with voice ${VOICE_ID} (${MODEL_ID})…`,
  );
  let made = 0;
  let skipped = 0;
  for (const { id, text } of lines) {
    const out = join(OUT_DIR, `${id}.mp3`);
    if (!FORCE && (await exists(out))) {
      console.log(`  • ${id}.mp3 — exists, skipping (use --force to redo)`);
      skipped += 1;
      continue;
    }
    const audio = await synth(text);
    await writeFile(out, audio);
    console.log(`  ✓ ${id}.mp3 (${(audio.length / 1024).toFixed(1)} KB)`);
    made += 1;
  }
  console.log(`Done — ${made} written, ${skipped} skipped → public/audio/`);
}

main().catch((err) => {
  console.error("\nFailed:", err.message);
  process.exit(1);
});
