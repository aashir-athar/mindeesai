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
    <div className="flex flex-col gap-16">
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
          <BarRow label="P(👍)" value={persona.reward.pUp} />
          <BarRow label="P(👎)" value={persona.reward.pDown} />
        </div>
      </Section>

      <Section title="Persona drift" subtitle={`${persona.drift.historyLength} fingerprints recorded · ${persona.drift.reanchorsTriggered} re-anchors triggered`}>
        {persona.drift.lastFingerprint ? (
          <dl className="grid grid-cols-2 gap-y-3 gap-x-8 max-w-md text-tabular text-sm">
            <KV k="avg sentence length" v={`${persona.drift.lastFingerprint.avgSentenceLen.toFixed(1)} chars`} />
            <KV k="first-person rate" v={persona.drift.lastFingerprint.firstPersonRate.toFixed(3)} />
            <KV k="as-AI flag" v={persona.drift.lastFingerprint.asAiFlag ? "🚨 yes" : "ok"} />
            <KV k="corpo-opener flag" v={persona.drift.lastFingerprint.corpoOpenerFlag ? "🚨 yes" : "ok"} />
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 max-w-3xl">
            {persona.affinities.slice(0, 12).map((a) => (
              <div key={a.topic} className="col-span-1 grid grid-cols-12 items-center gap-3">
                <span className={`col-span-5 text-tabular text-sm truncate ${a.affinity > 0.3 ? "text-emerald-300" : a.affinity < -0.3 ? "text-rose-300" : "text-bone-300"}`}>{a.topic}</span>
                <div className="col-span-5 h-1.5 bg-white/[0.05] rounded-full overflow-hidden relative">
                  <div className="absolute inset-y-0 left-1/2 w-px bg-white/10" />
                  <div
                    className={`h-full ${a.affinity >= 0 ? "bg-emerald-400 ml-[50%]" : "bg-rose-400 ml-[50%]"} transition-[width] duration-700 ease-out`}
                    style={{
                      width: `${Math.abs(a.affinity) * 50}%`,
                      marginLeft: a.affinity >= 0 ? "50%" : `${50 - Math.abs(a.affinity) * 50}%`,
                    }}
                  />
                </div>
                <span className="col-span-2 text-tabular text-xs text-bone-500 text-right">×{a.samples}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {persona.beliefs.length > 0 && (
        <Section title="Theory of mind" subtitle={`${persona.beliefs.length} belief${persona.beliefs.length === 1 ? "" : "s"} learned about this user`}>
          <div className="flex flex-wrap gap-2 max-w-3xl">
            {persona.beliefs.slice(0, 24).map((b) => (
              <span
                key={b.topic}
                title={b.evidence}
                className={`px-2 py-1 text-xs font-mono rounded-full border ${
                  b.level === "high" ? "border-emerald-700/60 text-emerald-300 bg-emerald-950/20" :
                  b.level === "low" ? "border-amber-700/60 text-amber-300 bg-amber-950/20" :
                  b.level === "uncertain" ? "border-sky-700/60 text-sky-300 bg-sky-950/20" :
                  "border-bone-800 text-bone-400"
                }`}
              >
                {b.topic} · {b.level}
              </span>
            ))}
          </div>
        </Section>
      )}

      {persona.innerThoughts.length > 0 && (
        <Section title="Inner voice" subtitle="Mindees's private noticing-stream — last few turns">
          <ol className="flex flex-col gap-3 max-w-3xl">
            {persona.innerThoughts.slice(-5).reverse().map((t, i) => (
              <li key={i} className="border-l-2 border-bone-800 pl-4">
                <p className="text-bone-200 text-sm italic">{t.text}</p>
                <p className="text-bone-600 text-[10px] font-mono mt-1">{relative(t.ts)} · {t.derivedFrom.join(" + ") || "—"}</p>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {persona.corrections.length > 0 && (
        <Section title="Past corrections" subtitle={`${persona.corrections.length} time${persona.corrections.length === 1 ? "" : "s"} the user told Mindees it was wrong`}>
          <ol className="flex flex-col gap-3 max-w-3xl">
            {persona.corrections.slice(0, 5).map((c, i) => (
              <li key={i} className="text-sm border border-rose-900/40 rounded p-3 bg-rose-950/10">
                <p className="text-bone-500 text-xs mb-1">Mindees said: <span className="text-bone-300 italic">&ldquo;{c.wrong}&rdquo;</span></p>
                <p className="text-bone-300 text-xs">You corrected: <span className="text-rose-200">&ldquo;{c.correction}&rdquo;</span></p>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {persona.signatureVocab.length > 0 && (
        <Section title="Vocabulary signature" subtitle="Words this user uses unusually often — Mindees mirrors them sparingly">
          <div className="flex flex-wrap gap-2 max-w-3xl">
            {persona.signatureVocab.map((w) => (
              <span key={w} className="px-2 py-1 text-xs font-mono rounded border border-bone-800 text-bone-300">{w}</span>
            ))}
          </div>
        </Section>
      )}

      {persona.journalLastEntry && (
        <Section title="Latest journal entry" subtitle={`Mindees wrote this to itself ${relative(persona.journalLastEntry.ts)}`}>
          <blockquote className="border-l-2 border-warm-600/60 pl-6 max-w-3xl text-bone-100 text-lg leading-[1.65] font-light italic whitespace-pre-wrap">
            {persona.journalLastEntry.entry}
          </blockquote>
        </Section>
      )}
    </div>
  );
}

function SystemPanel({ health, mood }: { health: Health; mood: Mood }) {
  return (
    <div className="glass rounded-2xl px-6 py-5 grid grid-cols-12 gap-x-10 gap-y-4">
      <Cell label="LIVE" value={
        <span className="inline-flex items-center gap-2">
          <span className={`size-1.5 rounded-full ${health.cron.configured ? "bg-success pulse-dot" : "bg-bone-500"}`} />
          <span>{health.cron.configured ? "Active" : "Standby"}</span>
        </span>
      } />
      <Cell label="LAST TICK" value={health.cron.lastTrainingTick ? relative(health.cron.lastTrainingTick.ranAt) : "—"} />
      <Cell label="LAST LOSS" value={health.cron.lastTrainingTick ? health.cron.lastTrainingTick.loss.toFixed(4) : "—"} />
      <Cell label="COMMITTED" value={health.cron.lastTrainingTick?.committed === false ? "rolled back" : health.cron.lastTrainingTick ? "yes" : "—"} />
      <Cell label="MOOD STEPS" value={String(mood.steps)} />
      <Cell label="CONNECTORS" value={String(health.connectors.count)} />
      <Cell label="MEMORY" value={health.memory.ok ? "online" : "—"} />
    </div>
  );
}

function ThreadPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-3 text-sm text-bone-300">
      <span className="text-eyebrow">THREAD</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="default"
        className="glass rounded-full px-4 py-1.5 text-tabular text-bone-100 outline-none w-64"
      />
      <span className="text-eyebrow !text-bone-500">paste a thread ID to inspect</span>
    </label>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-5 reveal">
      <header className="flex items-baseline gap-4">
        <h2 className="text-display text-2xl text-bone-50">{title}</h2>
        <span className="text-eyebrow">{subtitle}</span>
      </header>
      {children}
    </section>
  );
}

function BarGrid({ values }: { values: Record<string, number> }) {
  const entries = Object.entries(values);
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 max-w-3xl">
      {entries.map(([k, v]) => <BarRow key={k} label={k} value={v} />)}
    </div>
  );
}

function BarRow({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="col-span-12 grid grid-cols-12 items-center gap-3">
      <span className="col-span-4 text-eyebrow truncate">{label}</span>
      <div className="col-span-6 h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-aurora-400 to-warm-400 transition-[width] duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="col-span-2 text-tabular text-sm text-bone-100 text-right">{value.toFixed(3)}</span>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="col-span-12 sm:col-span-3 md:col-span-2 flex flex-col gap-0.5">
      <span className="text-eyebrow">{label}</span>
      <span className="text-tabular text-base text-bone-50">{value}</span>
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <>
      <dt className="text-eyebrow self-center">{k}</dt>
      <dd className="text-bone-50">{v}</dd>
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
