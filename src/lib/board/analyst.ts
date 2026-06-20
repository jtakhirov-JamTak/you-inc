// AI analyst — SERVER ONLY. The thin I/O shell that calls the Anthropic API to
// phrase the deterministic insight facts into the Board's weekly read. All pure
// logic (schema, prompts, validation) lives in analyst-core.ts so it stays
// testable. NEVER import this into client components or middleware.
import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import * as Sentry from "@sentry/nextjs";
import type { InsightFacts } from "./insights";
import {
  ANALYST_MAX_TOKENS,
  ANALYST_MODEL,
  PROMPT_VERSION,
  buildSystemPrompt,
  buildUserPrompt,
  parseAndValidateAnalysis,
  type AnalysisOutput,
} from "./analyst-core";

const MAX_RETRIES = 2; // 3 total attempts (playbook §7)

export interface GeneratedAnalysis {
  output: AnalysisOutput;
  model: string;
  promptVersion: string;
}

/**
 * Generate the weekly analysis from pre-computed facts. Returns null on a missing
 * key or after all attempts fail — the caller keeps the deterministic facts as the
 * fallback (never a blank state). Only the model call is here; the facts that ground
 * it are computed deterministically upstream.
 */
export async function generateAnalysis(facts: InsightFacts): Promise<GeneratedAnalysis | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("generateAnalysis: ANTHROPIC_API_KEY not set");
    return null;
  }

  const client = new Anthropic({ apiKey });
  const system = buildSystemPrompt();
  const userPrompt = buildUserPrompt(facts);

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const msg = await client.messages.create({
        model: ANALYST_MODEL,
        max_tokens: ANALYST_MAX_TOKENS,
        system,
        messages: [{ role: "user", content: userPrompt }],
      });
      const block = msg.content.find((b) => b.type === "text");
      const raw = block && block.type === "text" ? block.text : "";
      const output = parseAndValidateAnalysis(raw);
      return { output, model: ANALYST_MODEL, promptVersion: PROMPT_VERSION };
    } catch (err) {
      lastError = err;
      // Don't log the model output or facts (may carry user habit names).
      console.error(`generateAnalysis attempt ${attempt + 1} failed`, (err as Error).message);
    }
  }
  Sentry.captureException(lastError, { tags: { area: "board", kind: "analysis_generation_failed" } });
  return null;
}
