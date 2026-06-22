"use client";

import { useState } from "react";

// Data export (right-to-access). POSTs to /api/account/export and saves the
// returned JSON as a file. No data leaves the app to a third party — the browser
// downloads it directly from our own endpoint.
export function ExportData() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "you-inc-export.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("data export failed", (err as Error)?.message);
      setError("Could not build your export. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-card border border-hairline bg-surface p-5">
      <h2 className="text-[15px] font-semibold text-ink">Your data</h2>
      <p className="mt-1.5 text-[13px] font-medium leading-[1.5] text-ink-soft">
        Download everything you&apos;ve entered — identity, goals, sprints, habits
        and their history, board notes, and settings — as a single JSON file.
      </p>

      {error && (
        <p role="alert" className="mt-3 text-[13px] font-medium text-danger">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleExport}
        disabled={busy}
        className="mt-4 inline-flex min-h-11 items-center rounded-pill border border-hairline px-4 text-[14px] font-semibold text-ink transition active:scale-[0.98] disabled:opacity-50"
      >
        {busy ? "Preparing…" : "Download my data"}
      </button>
    </div>
  );
}
