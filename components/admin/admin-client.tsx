"use client";

/**
 * AdminClient — runtime flag toggles.
 *
 * Loads from /api/admin/flags + /api/inference-mode, shows the current
 * state with provenance (env vs runtime-file override), and offers a
 * single button to flip USE_NATIVE_MODEL. Stores the CRON_SECRET in
 * sessionStorage so the rest of the page just works after one paste.
 */

import { useCallback, useEffect, useState } from "react";

type InferenceMode = {
  ok: boolean;
  mode: "native" | "cloud-bootstrap" | "cloud-no-checkpoint";
  label: string;
  flags: {
    USE_NATIVE_MODEL: boolean;
    USE_NATIVE_MODEL_source?: "env" | "runtime-file";
    checkpoint_present: boolean;
  };
  variant: string;
};

type FlagsResponse = {
  ok: boolean;
  flags?: {
    useNativeModel: boolean;
    source: { useNativeModel: "env" | "runtime-file" };
  };
  checkpoint_present?: boolean;
  error?: string;
};

const TOKEN_KEY = "mindees-admin-token";

export function AdminClient() {
  const [mode, setMode] = useState<InferenceMode | null>(null);
  const [flags, setFlags] = useState<FlagsResponse | null>(null);
  const [token, setToken] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setToken(sessionStorage.getItem(TOKEN_KEY) || "");
  }, []);

  const headers = useCallback((): HeadersInit => {
    return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
  }, [token]);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [mRes, fRes] = await Promise.all([
        fetch("/api/inference-mode", { cache: "no-store" }),
        fetch("/api/admin/flags", { headers: headers(), cache: "no-store" }),
      ]);
      const m = (await mRes.json()) as InferenceMode;
      const f = (await fRes.json()) as FlagsResponse;
      setMode(m);
      setFlags(f);
      if (!f.ok && f.error === "unauthorized") {
        setError("Auth required — paste CRON_SECRET below.");
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [headers]);

  useEffect(() => { void refresh(); }, [refresh]);

  const saveToken = () => {
    sessionStorage.setItem(TOKEN_KEY, token);
    void refresh();
  };

  const flip = async () => {
    if (!flags?.flags) return;
    setBusy(true);
    setError(null);
    try {
      const next = !flags.flags.useNativeModel;
      const res = await fetch("/api/admin/flags", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ useNativeModel: next }),
      });
      const j = (await res.json()) as FlagsResponse;
      if (!j.ok) {
        setError(j.error || `HTTP ${res.status}`);
      } else {
        await refresh();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-8 max-w-3xl">
      {/* ─── Current mode card ─────────────────────────────────────────── */}
      <div className="border border-bone-800 rounded-md p-6 bg-bone-950">
        <p className="text-eyebrow mb-3">INFERENCE MODE — RIGHT NOW</p>
        <p className="text-2xl font-display text-bone-100 mb-1">{mode?.label ?? "…"}</p>
        <p className="text-bone-500 text-xs font-mono">
          mode: {mode?.mode ?? "—"}  ·  variant: {mode?.variant ?? "—"}  ·  checkpoint: {mode?.flags.checkpoint_present ? "present" : "MISSING"}
        </p>
      </div>

      {/* ─── Native-model toggle ───────────────────────────────────────── */}
      <div className="border border-bone-800 rounded-md p-6 bg-bone-950">
        <div className="flex justify-between items-start gap-6 flex-wrap">
          <div className="flex-1 min-w-[260px]">
            <p className="text-eyebrow mb-2">USE_NATIVE_MODEL</p>
            <p className="text-bone-300 text-sm leading-relaxed">
              When ON, the chat orchestrator routes through Mindees&rsquo; own
              transformer (<span className="font-mono">core/mindees-mind</span>).
              When OFF, it routes through the cloud LLM router (Groq today).
              Takes effect on the very next message — no redeploy needed.
            </p>
            <p className="text-bone-500 text-xs font-mono mt-2">
              current: <span className={flags?.flags?.useNativeModel ? "text-emerald-400" : "text-amber-400"}>
                {flags?.flags?.useNativeModel ? "ON" : "OFF"}
              </span>
              {flags?.flags?.source && (
                <> · source: {flags.flags.source.useNativeModel}</>
              )}
            </p>
            {flags?.checkpoint_present === false && (
              <p className="text-amber-400 text-xs mt-3">
                ⚠ No checkpoint on disk. Flipping ON will keep cloud routing
                until a checkpoint hydrates (the orchestrator double-checks
                before swapping brains).
              </p>
            )}
          </div>
          <button
            onClick={() => void flip()}
            disabled={busy || !flags?.ok}
            className="px-6 py-3 border border-bone-700 hover:border-bone-300 transition-colors rounded text-bone-100 font-mono text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? "…" : flags?.flags?.useNativeModel ? "Switch to CLOUD" : "Switch to NATIVE"}
          </button>
        </div>
      </div>

      {/* ─── Auth ──────────────────────────────────────────────────────── */}
      {!flags?.ok && (
        <div className="border border-amber-900/60 rounded-md p-6 bg-amber-950/20">
          <p className="text-eyebrow mb-3 text-amber-400">AUTH REQUIRED</p>
          <p className="text-bone-300 text-sm mb-4">
            This endpoint is gated by CRON_SECRET. Paste it once — it lives in
            sessionStorage and is cleared when you close the tab.
          </p>
          <div className="flex gap-2 items-stretch">
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="CRON_SECRET"
              className="flex-1 bg-black border border-bone-800 rounded px-3 py-2 text-bone-100 font-mono text-sm"
            />
            <button
              onClick={saveToken}
              className="px-4 py-2 border border-bone-700 hover:border-bone-300 transition-colors rounded text-bone-100 font-mono text-sm"
            >
              Save
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-danger text-sm">Error: {error}</p>}
    </div>
  );
}
