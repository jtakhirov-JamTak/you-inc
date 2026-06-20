"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Kicker } from "@/components/ui/kicker";
import { TextArea } from "@/components/ui/text-area";
import { pillAccentClass, SecondaryButton } from "@/components/ui/button";

// Client-side authoring for the weekly statement: the user-written "Note to the
// chair" and the checkable resolutions carried into next week. Both POST to the
// board endpoints (RLS-scoped) and refresh the server component on success. Notes
// and resolutions are narrative/checklist data — not ledger inputs — so editing
// freely (incl. on a settled week) is by design.

// ── Note to the chair ────────────────────────────────────────────────────────
export function NoteToChair({
  meetingId,
  initialNote,
}: {
  meetingId: string;
  initialNote: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialNote ?? "");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  async function save() {
    if (saving) return;
    setSaving(true);
    setFailed(false);
    try {
      const res = await fetch("/api/board/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingId, note: value }),
      });
      if (!res.ok) throw new Error();
      setEditing(false);
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setValue(initialNote ?? "");
    setFailed(false);
    setEditing(false);
  }

  const hasNote = !!initialNote?.trim();

  return (
    <div className="mt-6 border-y border-hairline py-4">
      <div className="flex items-baseline justify-between">
        <Kicker as="h2" className="tracking-[0.12em] text-ink-muted">
          Note to the chair
        </Kicker>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex min-h-11 items-center font-mono text-[10px] uppercase tracking-[0.1em] text-ink-soft underline"
          >
            {hasNote ? "Edit" : "Write"}
          </button>
        )}
      </div>

      {editing ? (
        <div className="mt-2">
          <TextArea
            value={value}
            onChange={setValue}
            placeholder="A line of reflection — what compounded this week, what gave a little back."
            rows={3}
            maxLength={800}
            ariaLabel="Note to the chair"
          />
          {failed && (
            <p role="alert" className="mt-1 text-[12px] font-medium text-danger">
              Couldn&apos;t save — try again.
            </p>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <SecondaryButton onClick={cancel} disabled={saving} className="h-11 px-4 text-[13px]">
              Cancel
            </SecondaryButton>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className={cn(pillAccentClass, "h-11 px-5 text-[13px]")}
            >
              {saving ? "Saving…" : "Save note"}
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-[16px] font-medium leading-[1.5] text-[#39342c]">
          {hasNote
            ? initialNote
            : "No note recorded for this week yet. A line of reflection — what compounded, what gave a little back — lands here."}
        </p>
      )}
    </div>
  );
}

// ── Resolutions ──────────────────────────────────────────────────────────────
interface Resolution {
  id: string;
  text: string;
  checked: boolean;
}

export function Resolutions({
  meetingId,
  initialResolutions,
}: {
  meetingId: string;
  initialResolutions: Resolution[];
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="mt-7">
      <Kicker as="h2" className="tracking-[0.12em] text-ink-muted">
        Resolutions for next week
      </Kicker>

      {initialResolutions.length > 0 ? (
        <div className="mt-3 space-y-2">
          {initialResolutions.map((r) => (
            <ResolutionRow key={r.id} resolution={r} />
          ))}
        </div>
      ) : (
        <p className="mt-2.5 text-[13px] text-ink-soft">
          None set yet. Add a commitment to carry into next week.
        </p>
      )}

      {adding ? (
        <AddResolution meetingId={meetingId} onDone={() => setAdding(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-card-sm border border-dashed border-hairline-strong bg-surface px-4 py-2.5 text-[13px] font-semibold text-ink-soft transition active:scale-[0.99]"
        >
          <span aria-hidden className="text-[16px] font-light leading-none">
            +
          </span>
          Add resolution
        </button>
      )}
    </div>
  );
}

function ResolutionRow({ resolution }: { resolution: Resolution }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  // The last action attempted, so the Retry button can re-invoke it (toggle vs remove).
  const lastAction = useRef<(() => void) | null>(null);

  async function run(method: "PATCH" | "DELETE", body: object) {
    if (pending) return;
    setPending(true);
    setFailed(false);
    try {
      const res = await fetch("/api/board/resolutions", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  function toggle() {
    lastAction.current = toggle;
    void run("PATCH", { resolutionId: resolution.id, checked: !resolution.checked });
  }
  function remove() {
    lastAction.current = remove;
    void run("DELETE", { resolutionId: resolution.id });
  }

  return (
    <div className="flex items-center gap-3 rounded-card-sm border border-hairline bg-surface px-4 py-3">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={resolution.checked}
        aria-label={`${resolution.text}${resolution.checked ? ", done — tap to un-check" : ", tap to mark done"}`}
        className="flex min-h-11 flex-1 items-center gap-3 text-left disabled:opacity-50"
      >
        <span
          aria-hidden
          className={cn(
            "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border",
            resolution.checked ? "border-ink bg-accent text-accent-text" : "border-ink-faint",
          )}
        >
          {resolution.checked && <Check className="h-3 w-3" strokeWidth={3} />}
        </span>
        {/* aria-hidden: the button's aria-label already speaks the text + state, so
            this avoids a screen reader reading the resolution twice. */}
        <span
          aria-hidden
          className={cn(
            "min-w-0 flex-1 text-[13px]",
            resolution.checked ? "text-ink-soft line-through" : "text-ink",
          )}
        >
          {resolution.text}
        </span>
      </button>
      {failed ? (
        <button
          type="button"
          onClick={() => lastAction.current?.()}
          aria-label={`Retry — ${resolution.text}`}
          className="flex h-11 shrink-0 items-center px-2 text-[11px] font-semibold text-danger"
        >
          Retry
        </button>
      ) : (
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          aria-label={`Remove resolution: ${resolution.text}`}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card-sm text-[18px] leading-none text-ink-soft disabled:opacity-50"
        >
          −
        </button>
      )}
    </div>
  );
}

function AddResolution({ meetingId, onDone }: { meetingId: string; onDone: () => void }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const canSubmit = !!text.trim() && !saving;

  async function add() {
    if (!canSubmit) return;
    setSaving(true);
    setFailed(false);
    try {
      const res = await fetch("/api/board/resolutions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingId, text: text.trim() }),
      });
      if (!res.ok) throw new Error();
      onDone();
      router.refresh();
    } catch {
      setFailed(true);
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 rounded-card-sm border border-hairline bg-surface p-3">
      <input
        type="text"
        value={text}
        maxLength={200}
        autoFocus
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") add();
        }}
        placeholder="One commitment for next week"
        aria-label="New resolution"
        className="min-h-11 w-full rounded-card-sm border border-divider bg-surface px-3 text-[16px] text-ink placeholder:text-ink-soft focus:outline-none focus:ring-2 focus:ring-accent"
      />
      {failed && (
        <p role="alert" className="mt-1.5 text-[12px] font-medium text-danger">
          Couldn&apos;t add — try again.
        </p>
      )}
      <div className="mt-2 flex justify-end gap-2">
        <SecondaryButton
          onClick={() => {
            setText("");
            onDone();
          }}
          disabled={saving}
          className="h-11 px-4 text-[13px]"
        >
          Cancel
        </SecondaryButton>
        <button
          type="button"
          onClick={add}
          disabled={!canSubmit}
          className={cn(pillAccentClass, "h-11 px-5 text-[13px]")}
        >
          {saving ? "Adding…" : "Add"}
        </button>
      </div>
    </div>
  );
}
