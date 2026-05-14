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

  const [githubPAT, setGithubPAT] = useState("");
  const [trainResult, setTrainResult] = useState<string | null>(null);
  useEffect(() => {
    setGithubPAT(sessionStorage.getItem("mindees-github-pat") || "");
  }, []);
  const triggerTrain = async () => {
    if (!githubPAT) {
      setError("Paste a GitHub PAT (Actions: Read & Write scope) into the field below first.");
      return;
    }
    setBusy(true);
    setError(null);
    setTrainResult("dispatching workflow...");
    try {
      sessionStorage.setItem("mindees-github-pat", githubPAT);
      const res = await fetch("/api/admin/train", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ githubToken: githubPAT, ref: "main" }),
      });
      const j = await res.json();
      setTrainResult(JSON.stringify(j, null, 2).slice(0, 2000));
      if (!j.ok) setError(j.error || `HTTP ${res.status}`);
    } catch (e) {
      setError((e as Error).message);
      setTrainResult(null);
    } finally {
      setBusy(false);
    }
  };

  const [cronResult, setCronResult] = useState<string | null>(null);
  const runCron = async () => {
    setBusy(true);
    setError(null);
    setCronResult("running...");
    try {
      const res = await fetch("/api/cron/self-improve", {
        method: "POST",
        headers: headers(),
      });
      const j = await res.json();
      setCronResult(JSON.stringify(j, null, 2).slice(0, 4000));
      if (!j.ok) setError(j.error || `HTTP ${res.status}`);
    } catch (e) {
      setError((e as Error).message);
      setCronResult(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col">
      {/* ─── Current mode ─────────────────────────────────────────────── */}
      <Panel kicker="Inference mode — right now">
        <p className="text-[24px] sm:text-[28px] text-bone-50 font-display leading-tight tracking-tight">{mode?.label ?? "…"}</p>
        <p className="text-bone-500 text-[12px] font-mono mt-2">
          mode: {mode?.mode ?? "—"}  ·  variant: {mode?.variant ?? "—"}  ·  checkpoint: {mode?.flags.checkpoint_present ? "present" : "MISSING"}
        </p>
      </Panel>

      {/* ─── Native-model toggle ───────────────────────────────────────── */}
      <Panel kicker="USE_NATIVE_MODEL">
        <div className="flex justify-between items-start gap-6 flex-wrap">
          <div className="flex-1 min-w-[260px]">
            <p className="text-bone-300 text-[14px] leading-relaxed">
              When ON, the chat orchestrator routes through MindeesAI&rsquo;s own transformer
              (<span className="font-mono text-bone-100">core/mindees-mind</span>).
              When OFF, it routes through the cloud LLM router (Groq today).
              Takes effect on the next message — no redeploy needed.
            </p>
            <p className="text-bone-500 text-[12px] font-mono mt-3">
              current: <span className={flags?.flags?.useNativeModel ? "text-emerald-400" : "text-bone-400"}>
                {flags?.flags?.useNativeModel ? "ON" : "OFF"}
              </span>
              {flags?.flags?.source && (
                <> · source: {flags.flags.source.useNativeModel}</>
              )}
            </p>
            {flags?.checkpoint_present === false && (
              <p className="text-amber-400/80 text-[12px] mt-3">
                No checkpoint on disk yet. Flipping ON will keep cloud routing until a checkpoint hydrates (the orchestrator double-checks before swapping brains).
              </p>
            )}
          </div>
          <Btn primary onClick={() => void flip()} disabled={busy || !flags?.ok}>
            {busy ? "…" : flags?.flags?.useNativeModel ? "Switch to CLOUD" : "Switch to NATIVE"}
          </Btn>
        </div>
      </Panel>

      {/* ─── Train Now ─────────────────────────────────────────────────── */}
      <Panel kicker="Train now">
        <div className="flex justify-between items-start gap-6 flex-wrap mb-4">
          <div className="flex-1 min-w-[260px]">
            <p className="text-bone-300 text-[14px] leading-relaxed">
              Fires the GitHub Actions pretrain workflow on the <span className="font-mono text-bone-100">main</span> branch.
              ~30 minutes of CPU-only training; uploads <span className="font-mono text-bone-100">checkpoints/base.bin</span> to Vercel Blob. Next cold-start hydrates the new weights.
            </p>
            <p className="text-bone-500 text-[12px] mt-3">
              Needs a GitHub fine-grained PAT with <span className="font-mono text-bone-300">Actions: Read &amp; Write</span> on this repo. Paste once; never sent server-side.
            </p>
          </div>
          <Btn onClick={() => void triggerTrain()} disabled={busy || !flags?.ok || !githubPAT}>
            {busy ? "dispatching…" : "Run pretrain"}
          </Btn>
        </div>
        <input
          type="password"
          value={githubPAT}
          onChange={(e) => setGithubPAT(e.target.value)}
          placeholder="ghp_... or github_pat_..."
          className="w-full bg-transparent border-b border-white/[0.10] focus:border-warm-400/60 px-1 py-2 text-bone-100 font-mono text-[12px] outline-none transition-colors duration-200"
        />
        {trainResult && (
          <pre className="text-bone-300 text-[11px] font-mono mt-4 border border-white/[0.06] rounded p-3 max-h-[200px] overflow-auto whitespace-pre-wrap break-all">
            {trainResult}
          </pre>
        )}
      </Panel>

      {/* ─── Run cron now ──────────────────────────────────────────────── */}
      <Panel kicker="Self-improvement cron">
        <div className="flex justify-between items-start gap-6 flex-wrap mb-4">
          <div className="flex-1 min-w-[260px]">
            <p className="text-bone-300 text-[14px] leading-relaxed">
              Manually fire <span className="font-mono text-bone-100">/api/cron/self-improve</span>. Same endpoint cron-job.org and Vercel Cron hit. Useful for verifying the full pipeline without waiting for the next scheduled invocation.
            </p>
            <p className="text-bone-500 text-[12px] font-mono mt-3">
              Budget: 40s on Vercel (Hobby ceiling); unbounded locally.
            </p>
          </div>
          <Btn onClick={() => void runCron()} disabled={busy || !flags?.ok}>
            {busy ? "running…" : "Run cron now"}
          </Btn>
        </div>
        {cronResult && (
          <pre className="text-bone-300 text-[11px] font-mono mt-2 border border-white/[0.06] rounded p-3 max-h-[280px] overflow-auto whitespace-pre-wrap break-all">
            {cronResult}
          </pre>
        )}
      </Panel>

      {/* ─── Auth (only shown when unauthenticated) ────────────────────── */}
      {!flags?.ok && (
        <Panel kicker="Auth required">
          <p className="text-bone-300 text-[14px] mb-4 leading-relaxed">
            This endpoint is gated by CRON_SECRET. Paste it once — it lives in sessionStorage and clears when you close the tab.
          </p>
          <div className="flex gap-3 items-stretch">
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="CRON_SECRET"
              className="flex-1 bg-transparent border-b border-white/[0.10] focus:border-warm-400/60 px-1 py-2 text-bone-100 font-mono text-[12px] outline-none transition-colors duration-200"
            />
            <Btn primary onClick={saveToken}>Save</Btn>
          </div>
        </Panel>
      )}

      {error && <p className="text-rose-300 text-[13px] pt-6 border-t border-white/[0.06]">Error: {error}</p>}
    </div>
  );
}

// ─── Panel + Btn primitives ───────────────────────────────────────────────

function Panel({ kicker, children }: { kicker: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-white/[0.06] py-8">
      <p className="text-tabular text-warm-400 text-[10px] uppercase tracking-[0.12em] mb-4">{kicker}</p>
      {children}
    </div>
  );
}

function Btn({ children, primary, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  const base =
    "cursor-pointer text-[13px] font-medium rounded-lg px-4 py-2 transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bone-50/40";
  const variant = primary
    ? "text-ink-950 bg-bone-50 hover:bg-white"
    : "text-bone-200 border border-white/[0.10] hover:bg-white/[0.04] hover:border-white/[0.18]";
  return (
    <button {...props} className={`${base} ${variant}`}>
      {children}
    </button>
  );
}
