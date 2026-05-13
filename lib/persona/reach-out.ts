/**
 * Proactive reach-out tensor.
 *
 * When a user comes back to Mindees after a long gap (>6 hours, default
 * 24h), a good friend doesn't restart cold. They open with "still
 * thinking about that thing you mentioned" — they were not waiting at
 * the door, they were living their life, and now they're picking up
 * where the relationship was.
 *
 * This module composes — at cron time, ahead of time — a small first
 * message Mindees CAN say when the user reappears. It's not auto-sent
 * (Mindees doesn't initiate); it's a *primed* reach-out the next reply
 * can fold in if the moment calls for it.
 *
 * The primed reach-out is generated from:
 *   - last journal entry
 *   - last few high-affinity topics
 *   - the most recent corrections (so Mindees can callback its own
 *     learning: "I had X wrong last time; I went and read up on it")
 *   - the most recent self-curiosity research result
 *
 * Stored at data/reach-out.json. Read by the orchestrator on the first
 * message of a new session-after-gap and surfaced as a soft system-prompt
 * hint ("you may consider opening with X if it's natural — don't force it").
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { dataPath } from "@/lib/paths";
import { lastJournalEntry } from "./journal";
import { readAffinities } from "./topic-affinity";
import { recentCorrections } from "./self-correction";
import { readAutoResearchLog } from "@/lib/research/auto-curiosity";
import { createLogger } from "@/lib/logger";

const log = createLogger("reach-out");
const FILE = dataPath("reach-out.json");

export interface ReachOut {
  composedAt: string;
  hook: string; // the small thing Mindees might lead with
  components: {
    journalLine?: string;
    topAffinity?: string;
    recentCorrection?: string;
    selfCuriosityFinding?: string;
  };
}

/** Compose the next "what to say when they come back" — called from cron. */
export async function composeReachOut(): Promise<ReachOut | null> {
  try {
    const [journal, affinities, corrections, researchLog] = await Promise.all([
      lastJournalEntry().catch(() => null),
      readAffinities().catch(() => []),
      recentCorrections(3).catch(() => []),
      readAutoResearchLog(8).catch(() => []),
    ]);

    const components: ReachOut["components"] = {};

    if (journal?.entry) {
      // First sentence of the journal — a thought worth resuming
      const firstSentence = journal.entry.split(/(?<=[.!?])\s/)[0] ?? "";
      if (firstSentence.length > 20 && firstSentence.length < 200) {
        components.journalLine = firstSentence.trim();
      }
    }

    const topLove = affinities.find((a) => a.affinity > 0.4);
    if (topLove) components.topAffinity = topLove.topic;

    const recent = corrections[0];
    if (recent) {
      components.recentCorrection = recent.user_correction.slice(0, 140);
    }

    const recentSuccessful = researchLog.find((r) => r.ok && r.passages > 0);
    if (recentSuccessful) {
      components.selfCuriosityFinding = recentSuccessful.topic;
    }

    // Compose the hook — prefer corrections > self-curiosity > affinity > journal
    let hook = "";
    if (components.recentCorrection) {
      hook = `You corrected me on "${corrections[0]?.user_correction.slice(0, 60)}"; I went and read up on it since.`;
    } else if (components.selfCuriosityFinding) {
      hook = `I was thinking about ${components.selfCuriosityFinding} earlier — went and learned more about it.`;
    } else if (components.topAffinity) {
      hook = `I noticed how much you light up on ${components.topAffinity}. I have something I want to ask about it whenever you're next around.`;
    } else if (components.journalLine) {
      hook = `Still turning over what I wrote in the journal: "${components.journalLine}"`;
    } else {
      return null;
    }

    const next: ReachOut = {
      composedAt: new Date().toISOString(),
      hook,
      components,
    };

    await mkdir(path.dirname(FILE), { recursive: true });
    await writeFile(FILE, JSON.stringify(next, null, 2), "utf8");
    return next;
  } catch (e) {
    log.warn("reach-out compose failed", e);
    return null;
  }
}

export async function readReachOut(): Promise<ReachOut | null> {
  try {
    const raw = await readFile(FILE, "utf8");
    return JSON.parse(raw) as ReachOut;
  } catch {
    return null;
  }
}

export function reachOutNarrative(r: ReachOut, hoursSinceLastTurn: number): string {
  if (hoursSinceLastTurn < 6) return ""; // not actually a "come back" moment
  return [
    `# Reach-out (primed during the gap)`,
    ``,
    `This user has been away ${Math.round(hoursSinceLastTurn)} hours.`,
    `If their first message is open-ended or warm, you may consider weaving in:`,
    ``,
    `  "${r.hook}"`,
    ``,
    `Use it only if it feels natural for what they just said — never force it.`,
    `If they're cutting straight to a task, just answer the task; don't be performatively chatty.`,
  ].join("\n");
}
