"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { TextArea } from "@/components/ui/text-area";
import { pillAccentClass } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/collapsible-section";

// Decision Making (the Regulation area) on Systems — editable notes/checklists:
// a meditation routine, a decision-making protocol, and the four Eisenhower
// quadrants. Read view = three collapsibles; one Edit affordance opens a form
// (single PUT /api/decision-tools). Mirrors the Mission charter's read/edit shell.

export type DecisionToolsView = {
  meditation: string;
  protocol: string;
  eisDo: string;
  eisDecide: string;
  eisDelegate: string;
  eisDelete: string;
};

type EisKey = "eisDo" | "eisDecide" | "eisDelegate" | "eisDelete";

const QUADRANTS: { key: EisKey; label: string; hint: string }[] = [
  { key: "eisDo", label: "Do", hint: "Urgent + important" },
  { key: "eisDecide", label: "Decide", hint: "Important, not urgent" },
  { key: "eisDelegate", label: "Delegate", hint: "Urgent, not important" },
  { key: "eisDelete", label: "Delete", hint: "Neither" },
];

function firstLine(s: string): string {
  const t = s.trim();
  if (!t) return "";
  const line = t.split("\n")[0].trim();
  return line.length > 80 ? line.slice(0, 79) + "…" : line;
}

const notSet = <span className="font-medium text-ink-muted">Not set</span>;

export function DecisionMaking({ tools }: { tools: DecisionToolsView }) {
  const [editing, setEditing] = useState(false);
  const eisFilled = QUADRANTS.filter((q) => tools[q.key].trim()).length;

  return (
    <section className="mt-7">
      <div className="flex items-start justify-between px-0.5">
        <div>
          <h2 className="font-display text-[18px] font-extrabold leading-none tracking-[-0.01em] text-ink">
            Decision Making
          </h2>
          <p className="mt-1 text-[12px] font-medium text-ink-soft">Regulate first, then decide.</p>
        </div>
        {editing ? (
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="mt-0.5 shrink-0 rounded-[6px] border border-hairline px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-soft transition active:scale-95"
          >
            Cancel
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label="Edit decision-making tools"
            className="mt-0.5 flex shrink-0 items-center gap-1 rounded-[6px] border border-hairline px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-soft transition active:scale-95"
          >
            <Pencil className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden />
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="mt-3">
          <DecisionForm tools={tools} onDone={() => setEditing(false)} />
        </div>
      ) : (
        <div className="mt-3 space-y-2.5">
          <CollapsibleSection title="Meditation" summary={firstLine(tools.meditation) || notSet}>
            {tools.meditation.trim() ? (
              <p className="whitespace-pre-line text-[13px] leading-snug text-ink">
                {tools.meditation}
              </p>
            ) : (
              <Empty label="meditation routine" />
            )}
          </CollapsibleSection>

          <CollapsibleSection
            title="Decision-making protocol"
            summary={firstLine(tools.protocol) || notSet}
          >
            {tools.protocol.trim() ? (
              <p className="whitespace-pre-line text-[13px] leading-snug text-ink">
                {tools.protocol}
              </p>
            ) : (
              <Empty label="protocol" />
            )}
          </CollapsibleSection>

          <CollapsibleSection
            title="Eisenhower Matrix"
            summary={eisFilled ? `${eisFilled} of 4 quadrants filled` : notSet}
          >
            <div className="grid grid-cols-2 gap-2">
              {QUADRANTS.map((q) => (
                <div key={q.key} className="rounded-card-sm border border-hairline p-2.5">
                  <div className="font-mono text-[8.5px] font-medium uppercase tracking-[0.1em] text-ink-muted">
                    {q.label}
                  </div>
                  <div className="font-mono text-[8px] uppercase tracking-[0.08em] text-ink-faint">
                    {q.hint}
                  </div>
                  <p className="mt-1.5 whitespace-pre-line text-[11.5px] leading-snug text-ink">
                    {tools[q.key].trim() || "—"}
                  </p>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        </div>
      )}
    </section>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <p className="text-[12.5px] leading-snug text-ink-soft">
      No {label} yet — add it from Edit.
    </p>
  );
}

function DecisionForm({ tools, onDone }: { tools: DecisionToolsView; onDone: () => void }) {
  const router = useRouter();
  const [meditation, setMeditation] = useState(tools.meditation);
  const [protocol, setProtocol] = useState(tools.protocol);
  const [eis, setEis] = useState({
    eisDo: tools.eisDo,
    eisDecide: tools.eisDecide,
    eisDelegate: tools.eisDelegate,
    eisDelete: tools.eisDelete,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/decision-tools", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meditation: meditation.trim(),
          protocol: protocol.trim(),
          eisDo: eis.eisDo.trim(),
          eisDecide: eis.eisDecide.trim(),
          eisDelegate: eis.eisDelegate.trim(),
          eisDelete: eis.eisDelete.trim(),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Could not save your tools.");
      }
      router.refresh();
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 rounded-card border border-hairline bg-surface p-4">
      <Labeled label="Meditation">
        <TextArea
          value={meditation}
          onChange={setMeditation}
          placeholder="Your routine — when, how long, the practice…"
          rows={3}
          maxLength={1000}
          ariaLabel="Meditation routine"
        />
      </Labeled>

      <Labeled label="Decision-making protocol">
        <TextArea
          value={protocol}
          onChange={setProtocol}
          placeholder="Your steps for a hard call — one per line…"
          rows={3}
          maxLength={1000}
          ariaLabel="Decision-making protocol"
        />
      </Labeled>

      <div>
        <span className="mb-1.5 block font-mono text-[8.5px] font-medium uppercase tracking-[0.12em] text-ink-muted">
          Eisenhower Matrix
        </span>
        <div className="grid grid-cols-2 gap-2">
          {QUADRANTS.map((q) => (
            <div key={q.key}>
              <div className="mb-1 font-mono text-[8.5px] font-medium uppercase tracking-[0.1em] text-ink-muted">
                {q.label}
                <span className="ml-1 text-ink-faint">· {q.hint}</span>
              </div>
              <TextArea
                value={eis[q.key]}
                onChange={(next) => setEis((prev) => ({ ...prev, [q.key]: next }))}
                placeholder="One per line…"
                rows={2}
                maxLength={500}
                ariaLabel={`Eisenhower ${q.label}`}
              />
            </div>
          ))}
        </div>
      </div>

      {error && (
        <p role="alert" className="text-[13px] font-medium text-danger">
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={saving}
        onClick={save}
        className={cn(pillAccentClass, "h-12 w-full text-[14px]")}
      >
        {saving ? "Saving…" : "Save tools"}
      </button>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="mb-1 block font-mono text-[8.5px] font-medium uppercase tracking-[0.12em] text-ink-muted">
        {label}
      </span>
      {children}
    </div>
  );
}
