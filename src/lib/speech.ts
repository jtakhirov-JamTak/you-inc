// Device text-to-speech helpers for the guided visualization (Web Speech API).
//
// The actual `speechSynthesis.speak(...)` calls live in the component — jsdom
// doesn't implement the API, so keeping the imperative bits out of here lets the
// pure selection logic stay unit-testable (same pure-core / I/O-shell split the
// rest of the project uses).
//
// We only ever read aloud FIXED, non-personal prompts, so nothing user-generated
// is spoken — no privacy/sub-processor implications.

export function isSpeechAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance === "function"
  );
}

// Pick the most natural English voice available, else null (let the platform
// default stand). Some browsers ship "compact"/"eloquence" low-fidelity variants
// alongside a nicer default — prefer the natural/local one when we can tell them
// apart by name.
export function pickVoice(
  voices: SpeechSynthesisVoice[],
): SpeechSynthesisVoice | null {
  const english = voices.filter((v) => v.lang?.toLowerCase().startsWith("en"));
  if (english.length === 0) return null;

  const isLowFidelity = (v: SpeechSynthesisVoice) =>
    /compact|eloquence|espeak/i.test(v.name);

  // Prefer a natural, on-device (localService) voice that isn't a low-fi variant.
  const natural = english.find((v) => v.localService && !isLowFidelity(v));
  if (natural) return natural;

  // Otherwise any voice that at least isn't a low-fidelity variant.
  const notLowFi = english.find((v) => !isLowFidelity(v));
  if (notLowFi) return notLowFi;

  return english[0];
}
