"use client";

/**
 * DashboardClient — polls /api/health and /api/persona on mount and again
 * every 15 s. Renders every persistent tensor as editorial typography.
 */

import { useEffect, useState } from "react";

type Mood = {
  values: Record<string, number>;
  steps: number;
  updatedAt: string;
  lastRegister?: string;
};

type Persona = {
  ok: boolean;
  threadId: string;
  mood: Mood;
  userModel: { values: Record<string, number>; turns: number; updatedAt: string };
  relationship: {
    familiarity: number; trust: number; alignment: number; warmth: number;
    thumbs: { up: number; down: number };
    updatedAt: string;
  };
  reward: { pUp: number; pDown: number; n: number; confidence: number };
  drift: {
    lastFingerprint: { avgSentenceLen: number; firstPersonRate: number; asAiFlag: number; corpoOpenerFlag: number; hedgeDensity: number } | null;
    reanchorsTriggered: number;
    historyLength: number;
  };
  sentimentArc: { warmth_ema: number; trust_ema: number; frustration_ema: number; turns: number; updatedAt: string } | null;
  beliefs: Array<{ topic: string; level: "low" | "uncertain" | "medium" | "high"; lastUpdated: string; evidence: string }>;
  signatureVocab: string[];
  corrections: Array<{ ts: string; wrong: string; correction: string }>;
  innerThoughts: Array<{ ts: string; text: string; derivedFrom: string[] }>;
  affinities: Array<{ topic: string; affinity: number; samples: number; lastSeen: string }>;
  journalLastEntry: { ts: string; entry: string } | null;
};

type Health = {
  ok: boolean;
  cron: {
    configured: boolean;
    lastTrainingTick: { loss: number; tokens: number; ms: number; ranAt: string; committed?: boolean } | null;
    lastImprovement: { ranAt?: string } | null;
  };
  connectors: { count: number; names: string[] };
  memory: { ok: boolean; tables: string[] };
  features: Record<string, boolean>;
};

export function DashboardClient() {
  const [persona, setPersona] = useState<Persona | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [threadId, setThreadId] = useState("default");

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const [pRes, hRes] = await Promise.all([
          fetch(`/api/persona?threadId=${encodeURIComponent(threadId)}`, { cache: "no-store" }),
          fetch("/api/health", { cache: "no-store" }),
        ]);
        if (!pRes.ok || !hRes.ok) {
          if (alive) setError(`p=${pRes.status} h=${hRes.status}`);
          return;
        }
        const p = (await pRes.json()) as Persona;
        const h = (await hRes.json()) as Health;
        if (alive) { setPersona(p); setHealth(h); setError(null); }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    tick();
    const id = setInterval(tick, 15_000);
    return () => { alive = false; clearInterval(id); };
  }, [threadId]);

  if (error) return <p className="text-danger text-sm">Error: {error}</p>;
  if (!persona || !health) return <p className="text-bone-500 text-sm">Loading state…</p>;

  return (
    <div className="flex flex-col">
      <ThreadPicker value={threadId} onChange={setThreadId} />

      <SystemPanel health={health} mood={persona.mood} />

      <Section title="Mood tensor" subtitle={`Updated ${relative(persona.mood.updatedAt)} · step ${persona.mood.steps} · last register: ${persona.mood.lastRegister ?? "—"}`}>
        <BarGrid values={persona.mood.values} />
      </Section>

      <Section title="User model" subtitle={`Per-thread · ${persona.userModel.turns} turns · updated ${relative(persona.userModel.updatedAt)}`}>
        <BarGrid values={persona.userModel.values} />
      </Section>

      <Section title="Relationship" subtitle={`Per-thread · ${persona.relationship.thumbs.up}👍 / ${persona.relationship.thumbs.down}👎 · updated ${relative(persona.relationship.updatedAt)}`}>
        <BarGrid
          values={{
            familiarity: persona.relationship.familiarity,
            trust: persona.relationship.trust,
            alignment: persona.relationship.alignment,
            warmth: persona.relationship.warmth,
          }}
        />
      </Section>

      <Section title="Reward predictor" subtitle={`Based on ${persona.reward.n} thumb signals · confidence ${(persona.reward.confidence * 100).toFixed(0)}%`}>
        <div className="grid grid-cols-12 gap-3 max-w-md">
          <BarRow label="P(up)" value={persona.reward.pUp} />
          <BarRow label="P(down)" value={persona.reward.pDown} />
        </div>
      </Section>

      <Section title="Persona drift" subtitle={`${persona.drift.historyLength} fingerprints recorded · ${persona.drift.reanchorsTriggered} re-anchors triggered`}>
        {persona.drift.lastFingerprint ? (
          <dl className="grid grid-cols-2 gap-y-3 gap-x-8 max-w-md text-tabular text-[13px]">
            <KV k="avg sentence length" v={`${persona.drift.lastFingerprint.avgSentenceLen.toFixed(1)} chars`} />
            <KV k="first-person rate" v={persona.drift.lastFingerprint.firstPersonRate.toFixed(3)} />
            <KV k="as-AI flag" v={persona.drift.lastFingerprint.asAiFlag ? "leaked" : "ok"} />
            <KV k="corpo-opener flag" v={persona.drift.lastFingerprint.corpoOpenerFlag ? "leaked" : "ok"} />
            <KV k="hedge density" v={persona.drift.lastFingerprint.hedgeDensity.toFixed(3)} />
          </dl>
        ) : (
          <p className="text-bone-500 text-sm">No replies fingerprinted yet.</p>
        )}
      </Section>

      {persona.sentimentArc && persona.sentimentArc.turns >= 3 && (
        <Section title="Sentiment arc" subtitle={`Whole-relationship · ${persona.sentimentArc.turns} turns observed`}>
          <div className="grid grid-cols-12 gap-3 max-w-md">
            <BarRow label="warmth (EMA)" value={(persona.sentimentArc.warmth_ema + 1) / 2} />
            <BarRow label="trust (EMA)" value={persona.sentimentArc.trust_ema} />
            <BarRow label="frustration (EMA)" value={persona.sentimentArc.frustration_ema} />
          </div>
        </Section>
      )}

      {persona.affinities.length > 0 && (
        <Section title="Topic affinity" subtitle={`${persona.affinities.length} topics tracked`}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-3.5">
            {persona.affinities.slice(0, 12).map((a) => (
              <div key={a.topic} className="grid grid-cols-12 items-center gap-3 text-[13px]">
                <span className={`col-span-5 text-tabular truncate ${a.affinity > 0.3 ? "text-emerald-300/90" : a.affinity < -0.3 ? "text-rose-300/90" : "text-bone-300"}`}>{a.topic}</span>
                <div className="col-span-5 h-px bg-white/[0.06] relative">
                  <div className="absolute inset-y-[-3px] left-1/2 w-px bg-white/[0.10]" />
                  <div
                    className={`absolute inset-y-[-1px] ${a.affinity >= 0 ? "bg-emerald-400/80" : "bg-rose-400/80"}`}
                    style={{
                      width: `${Math.abs(a.affinity) * 50}%`,
                      left: a.affinity >= 0 ? "50%" : `${50 - Math.abs(a.affinity) * 50}%`,
                    }}
                  />
                </div>
                <span className="col-span-2 text-tabular text-[11px] text-bone-500 text-right tabular-nums">×{a.samples}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {persona.beliefs.length > 0 && (
        <Section title="Theory of mind" subtitle={`${persona.beliefs.length} belief${persona.beliefs.length === 1 ? "" : "s"} learned about you`}>
          <div className="flex flex-wrap gap-x-3 gap-y-2 text-[12px] font-mono">
            {persona.beliefs.slice(0, 24).map((b) => (
              <span
                key={b.topic}
                title={b.evidence}
                className={
                  b.level === "high" ? "text-emerald-300/80" :
                  b.level === "low" ? "text-amber-300/80" :
                  b.level === "uncertain" ? "text-sky-300/80" :
                  "text-bone-400"
                }
              >
                {b.topic} <span className="text-bone-700">·{b.level}</span>
              </span>
            ))}
          </div>
        </Section>
      )}

      {persona.innerThoughts.length > 0 && (
        <Section title="Inner voice" subtitle="MindeesAI's private noticing stream — last few turns">
          <ol className="flex flex-col gap-5">
            {persona.innerThoughts.slice(-5).reverse().map((t, i) => (
              <li key={i}>
                <p className="text-bone-200 text-[14px] italic leading-relaxed">{t.text}</p>
                <p className="text-bone-600 text-[10px] font-mono mt-1.5">{relative(t.ts)} · {t.derivedFrom.join(" + ") || "—"}</p>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {persona.corrections.length > 0 && (
        <Section title="Past corrections" subtitle={`${persona.corrections.length} time${persona.corrections.length === 1 ? "" : "s"} you said 'no, it's X'`}>
          <ol className="flex flex-col gap-5">
            {persona.corrections.slice(0, 5).map((c, i) => (
              <li key={i} className="text-[13px]">
                <p className="text-bone-500 mb-1">It said: <span className="text-bone-300 italic">&ldquo;{c.wrong}&rdquo;</span></p>
                <p className="text-bone-400">You corrected: <span className="text-rose-300/90">&ldquo;{c.correction}&rdquo;</span></p>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {persona.signatureVocab.length > 0 && (
        <Section title="Vocabulary signature" subtitle="Words you use unusually often — MindeesAI mirrors them sparingly">
          <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[12px] font-mono text-bone-300">
            {persona.signatureVocab.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
        </Section>
      )}

      {persona.journalLastEntry && (
        <Section title="Latest journal entry" subtitle={`Written ${relative(persona.journalLastEntry.ts)}`}>
          <blockquote className="border-l border-warm-400/50 pl-5 text-bone-100 text-[17px] leading-[1.7] font-light italic whitespace-pre-wrap">
            {persona.journalLastEntry.entry}
          </blockquote>
        </Section>
      )}
    </div>
  );
}

function SystemPanel({ health, mood }: { health: Health; mood: Mood }) {
  return (
    <div className="border-y border-white/[0.06] py-6 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-x-6 gap-y-4 mb-2">
      <Cell label="Live" value={
        <span className="inline-flex items-center gap-2">
          <span className={`size-1.5 rounded-full ${health.cron.configured ? "bg-emerald-400 pulse-dot" : "bg-bone-600"}`} />
          <span>{health.cron.configured ? "Active" : "Standby"}</span>
        </span>
      } />
      <Cell label="Last tick" value={health.cron.lastTrainingTick ? relative(health.cron.lastTrainingTick.ranAt) : "—"} />
      <Cell label="Last loss" value={health.cron.lastTrainingTick ? health.cron.lastTrainingTick.loss.toFixed(4) : "—"} />
      <Cell label="Committed" value={health.cron.lastTrainingTick?.committed === false ? "rolled back" : health.cron.lastTrainingTick ? "yes" : "—"} />
      <Cell label="Mood steps" value={String(mood.steps)} />
      <Cell label="Connectors" value={String(health.connectors.count)} />
      <Cell label="Memory" value={health.memory.ok ? "online" : "—"} />
    </div>
  );
}

function ThreadPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-3 text-[13px] text-bone-400 pb-8 border-b border-white/[0.06] mb-2">
      <span className="text-tabular text-warm-400 text-[10px] uppercase tracking-[0.12em]">Thread</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="default"
        className="bg-transparent border-b border-white/[0.10] focus:border-warm-400/60 text-bone-100 px-1 py-1 outline-none w-64 text-tabular transition-colors duration-200"
      />
      <span className="text-bone-600 text-[11px]">paste a thread ID to inspect</span>
    </label>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="py-10 border-t border-white/[0.06] first:border-t-0">
      <header className="mb-6">
        <h2 className="text-display text-xl sm:text-2xl text-bone-50 tracking-tight leading-tight">{title}</h2>
        <p className="text-bone-500 text-[12px] mt-1">{subtitle}</p>
      </header>
      {children}
    </section>
  );
}

function BarGrid({ values }: { values: Record<string, number> }) {
  const entries = Object.entries(values);
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-3.5">
      {entries.map(([k, v]) => <BarRow key={k} label={k} value={v} />)}
    </div>
  );
}

function BarRow({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="grid grid-cols-12 items-center gap-3 text-[12px]">
      <span className="col-span-4 text-bone-400 truncate">{label}</span>
      <div className="col-span-6 h-px bg-white/[0.06] relative">
        <div
          className="absolute inset-y-[-1px] left-0 bg-warm-400/80 transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="col-span-2 text-tabular text-[11px] text-bone-200 text-right tabular-nums">{value.toFixed(3)}</span>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-tabular text-warm-400 text-[10px] uppercase tracking-[0.12em]">{label}</span>
      <span className="text-tabular text-[14px] text-bone-100">{value}</span>
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <>
      <dt className="text-bone-500 self-center">{k}</dt>
      <dd className="text-bone-100 text-right">{v}</dd>
    </>
  );
}

function relative(iso: string): string {
  if (!iso) return "—";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}
