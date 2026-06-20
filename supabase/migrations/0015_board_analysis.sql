-- 0015_board_analysis — store the weekly AI performance analysis on its meeting.
--
-- The analysis is a Derived Insight (docs/Evidence_Based_Insights_Architecture
-- Layer 4): computed once per week from the user's logs and cached here. It is NOT
-- source truth — it is recomputable from the logs, and `analysis_facts` stores the
-- deterministic evidence basis the text was phrased from. Separating the AI summary
-- from the user-authored `note` (which stays as-is) is deliberate: an AI summary is
-- replaceable; mixing it into canonical fields would erode trust when it's wrong.
--
-- No RLS change: board_meetings already has owner SELECT/UPDATE (0009). These
-- columns are written by the authenticated owner via the analysis endpoint.

alter table public.board_meetings
  -- The deterministic facts the analysis was computed from (evidence basis).
  add column if not exists analysis_facts jsonb,
  -- The AI-phrased read: { headline, body, takeaway }. Null when below the evidence
  -- threshold or when generation failed (the UI falls back to the plain facts).
  add column if not exists analysis_text jsonb,
  -- "insufficient" | "emerging" | "established" — the evidence state at compute time.
  add column if not exists analysis_state text,
  -- Which prompt template produced analysis_text; a bump triggers regeneration.
  add column if not exists analysis_prompt_version text,
  -- Which model produced analysis_text (audit + version tracking).
  add column if not exists analysis_model text,
  -- When the analysis was last computed (null = never).
  add column if not exists analysis_generated_at timestamptz;

notify pgrst, 'reload schema';
