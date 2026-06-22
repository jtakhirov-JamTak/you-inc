"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { inputClass } from "@/components/ui/field";

// Danger zone — irreversible account deletion. Two-step: reveal, then require
// the user to type DELETE. On success the server has already erased everything;
// we sign out locally to clear the (now-invalid) session cookies and redirect.
export function DeleteAccount() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canDelete = confirm === "DELETE" && !busy;

  async function handleDelete() {
    if (!canDelete) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "DELETE" }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      // Data is gone server-side; clear the local session and leave the app.
      const supabase = createClient();
      await supabase.auth.signOut();
      router.replace("/login");
    } catch (err) {
      console.error("account delete failed", (err as Error)?.message);
      setError("Could not delete your account. Try again, or contact support.");
      setBusy(false);
    }
  }

  return (
    <div className="rounded-card border border-danger/30 bg-surface p-5">
      <h2 className="text-[15px] font-semibold text-ink">Delete account</h2>
      <p className="mt-1.5 text-[13px] font-medium leading-[1.5] text-ink-soft">
        Permanently erases your identity charter, goals, sprints, habits and
        their history, board notes, and settings. This cannot be undone.
      </p>

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-4 inline-flex min-h-11 items-center rounded-pill border border-danger/40 px-4 text-[14px] font-semibold text-danger transition active:scale-[0.98]"
        >
          Delete my account
        </button>
      ) : (
        <div className="mt-4">
          <label
            htmlFor="delete-confirm"
            className="block text-[13px] font-semibold text-ink"
          >
            Type <span className="font-bold text-danger">DELETE</span> to confirm
          </label>
          <input
            id="delete-confirm"
            type="text"
            inputMode="text"
            autoComplete="off"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={cn(inputClass, "mt-1.5 bg-surface-tint")}
            placeholder="DELETE"
          />

          {error && (
            <p role="alert" className="mt-3 text-[13px] font-medium text-danger">
              {error}
            </p>
          )}

          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={handleDelete}
              disabled={!canDelete}
              className="inline-flex h-12 flex-1 items-center justify-center rounded-pill bg-danger text-[14px] font-bold text-white transition active:scale-[0.98] disabled:opacity-50"
            >
              {busy ? "Deleting…" : "Permanently delete"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setConfirm("");
                setError(null);
              }}
              disabled={busy}
              className="inline-flex h-12 items-center justify-center rounded-pill border border-hairline px-5 text-[14px] font-semibold text-ink-soft transition active:scale-[0.98] disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
