// Shared client-side audio helpers for VoiceInput + PersonPicker.
// Duplication-prevention lesson: once the same voice-recording logic
// existed in two components, a fix (silence gate) shipped to one and
// missed the other. Mic-capable surfaces now share this module.

export const CODEC_PREFERENCE = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
];

export function pickMimeType(): string | undefined {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
    return undefined;
  }
  for (const t of CODEC_PREFERENCE) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      // Some browsers throw on unknown mime types.
    }
  }
  return undefined;
}

// Whisper hallucinates short filler ("you", "thank you.", "silence.silence.")
// when given silent audio. Gate the API call on RMS amplitude so a user who
// records silence sees a retry prompt instead of hallucinated text — and we
// don't burn a Whisper call on empty audio.
// Typical phone-mic self-noise RMS is ~0.001–0.003 (-50 to -60 dBFS).
// Whispered speech measures ~0.01+ (-40 dBFS). 0.005 rejects ambient noise
// while leaving room for quiet voices.
export const MIN_RMS_FOR_SPEECH = 0.005;

export async function measureRms(blob: Blob): Promise<number | null> {
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const Ctx =
      typeof OfflineAudioContext !== "undefined" ? OfflineAudioContext : null;
    if (!Ctx) return null;
    // OfflineAudioContext resamples decoded audio to its own rate; 44.1kHz
    // works for any WebM/MP4/MP3/WAV input Whisper accepts.
    const ctx = new Ctx(1, 1, 44100);
    const audio = await ctx.decodeAudioData(arrayBuffer);
    const channel = audio.getChannelData(0);
    if (channel.length === 0) return 0;
    let sumSquares = 0;
    for (let i = 0; i < channel.length; i++) {
      sumSquares += channel[i] * channel[i];
    }
    return Math.sqrt(sumSquares / channel.length);
  } catch {
    return null;
  }
}
