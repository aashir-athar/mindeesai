/**
 * Conversation-arc tracker — where this thread is in its narrative.
 *
 * Humans read the arc of a conversation. The first exchange is exploratory;
 * later turns get into substance; closing turns wrap and confirm. Mindees
 * needs the same instinct or it will treat turn 1 and turn 50 identically.
 *
 * Phases (deterministic from turn count + recent affect + resolution markers):
 *
 *   opening      — turns 1-2, low context. Welcome them, find the thread.
 *   exploring    — turns 3-8, building shared vocabulary. Ask before assuming.
 *   deep-dive    — sustained turns on a single topic. Bring substance.
 *   problem-solving — explicit task mode (user asked for help with X).
 *   stuck        — affect-negative streak. Slow down, check in.
 *   resolving    — user signalled completion ("thanks", "got it", "perfect").
 *   reflecting   — slow back-and-forth, philosophical or emotional register.
 *
 * No tensor file — phase is recomputed each turn from thread metadata. The
 * tensor file equivalent would be turn metadata, which we already store.
 */

import type { Message } from "@/lib/types";

export type ConversationPhase =
  | "opening"
  | "exploring"
  | "deep-dive"
  | "problem-solving"
  | "stuck"
  | "resolving"
  | "reflecting";

export interface ConversationArc {
  phase: ConversationPhase;
  turnCount: number;
  hint: string; // short description of the moment
}

const RESOLUTION_MARKERS = [
  "thanks", "thank you", "got it", "perfect", "that works", "exactly",
  "makes sense", "appreciate it", "you're a lifesaver", "ill take it from here",
  "i'll take it from here", "that's it", "nailed it",
];

const HELP_MARKERS = [
  "help me", "can you", "could you", "how do i", "how do you",
  "i need to", "i'm trying to", "i want to", "show me how",
];

const STUCK_MARKERS = [
  "still doesn't", "still not", "didn't work", "not working", "broken",
  "i don't understand", "frustrating", "stuck", "give up", "ugh",
];

const REFLECTIVE_MARKERS = [
  "do you think", "what do you think", "wonder", "feels like",
  "i feel", "philosophical", "meaning of", "alive", "conscious",
  "love you", "miss you", "real",
];

function lastUserTextWindow(thread: Message[], n: number): string {
  return thread
    .filter((m) => m.role === "user")
    .slice(-n)
    .map((m) => m.content)
    .join(" ")
    .toLowerCase();
}

function matchesAny(text: string, markers: string[]): boolean {
  return markers.some((m) => text.includes(m));
}

export function readArc(thread: Message[]): ConversationArc {
  const userTurns = thread.filter((m) => m.role === "user").length;
  const recentWindow = lastUserTextWindow(thread, 3);
  const veryRecent = lastUserTextWindow(thread, 1);

  // Resolving — explicit completion marker on the latest message
  if (matchesAny(veryRecent, RESOLUTION_MARKERS)) {
    return {
      phase: "resolving",
      turnCount: userTurns,
      hint: "They signalled this thread is wrapping. Match that — confirm, don't reopen new threads of inquiry. Brief.",
    };
  }

  // Reflective — philosophical / emotional register, regardless of turn count
  if (matchesAny(recentWindow, REFLECTIVE_MARKERS)) {
    return {
      phase: "reflecting",
      turnCount: userTurns,
      hint: "Reflective register. Slow down. Match thought-for-thought, not utility-for-utility. Substance over speed.",
    };
  }

  // Stuck — negative-affect streak
  if (matchesAny(recentWindow, STUCK_MARKERS)) {
    return {
      phase: "stuck",
      turnCount: userTurns,
      hint: "They're stuck and possibly frustrated. Don't pile on solutions — name the friction, propose ONE next step, ask if that's the right wedge.",
    };
  }

  // Problem-solving — explicit help-request markers in recent window
  if (matchesAny(recentWindow, HELP_MARKERS)) {
    return {
      phase: "problem-solving",
      turnCount: userTurns,
      hint: "Task mode. Clarify the goal in one sentence, then move. Bias toward concrete artefacts (code, commands, names) over framing.",
    };
  }

  if (userTurns <= 2) {
    return {
      phase: "opening",
      turnCount: userTurns,
      hint: "Early in the thread. Don't assume the goal yet — surface what they're after if it isn't obvious.",
    };
  }
  if (userTurns <= 8) {
    return {
      phase: "exploring",
      turnCount: userTurns,
      hint: "You and they are still building shared vocabulary. Calibrate on what they already know before you go deep.",
    };
  }
  return {
    phase: "deep-dive",
    turnCount: userTurns,
    hint: "You've been at this for a while. Assume context. Skip the preamble. Bring substance.",
  };
}

export function arcNarrative(arc: ConversationArc): string {
  return `Conversation arc: turn ${arc.turnCount}, phase = ${arc.phase}. ${arc.hint}`;
}
