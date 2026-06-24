import { describe, it, expect } from "vitest";
import { pickVoice } from "../speech";

// Minimal SpeechSynthesisVoice stand-ins — only the fields pickVoice reads.
function voice(
  name: string,
  lang: string,
  localService = true,
): SpeechSynthesisVoice {
  return {
    name,
    lang,
    localService,
    default: false,
    voiceURI: name,
  } as SpeechSynthesisVoice;
}

describe("pickVoice", () => {
  it("returns null when there are no voices", () => {
    expect(pickVoice([])).toBeNull();
  });

  it("returns null when no English voice exists", () => {
    expect(pickVoice([voice("Amélie", "fr-FR"), voice("Yuki", "ja-JP")])).toBeNull();
  });

  it("prefers a natural local English voice over a compact variant", () => {
    const compact = voice("Samantha (Compact)", "en-US");
    const natural = voice("Samantha", "en-US");
    const picked = pickVoice([compact, natural]);
    expect(picked?.name).toBe("Samantha");
  });

  it("prefers an English voice even when a non-English one comes first", () => {
    const picked = pickVoice([voice("Amélie", "fr-FR"), voice("Daniel", "en-GB")]);
    expect(picked?.name).toBe("Daniel");
  });

  it("falls back past low-fidelity variants when no natural local voice exists", () => {
    const compact = voice("Eloquence", "en-US", false);
    const cloud = voice("Google US English", "en-US", false);
    const picked = pickVoice([compact, cloud]);
    expect(picked?.name).toBe("Google US English");
  });

  it("falls back to the first English voice when all are low-fidelity", () => {
    const a = voice("eSpeak en", "en-US", false);
    const b = voice("Compact Voice", "en-GB", false);
    const picked = pickVoice([a, b]);
    expect(picked?.name).toBe("eSpeak en");
  });
});
