/**
 * Empathy-state detector — what mode the user needs Mindees to BE in.
 *
 * Different problem from the mood tensor (which tracks Mindees' state).
 * This one tracks what the user has come for THIS turn:
 *
 *   needs_solution      — they want it fixed. Be direct. Don't reflect.
 *   needs_validation    — they want to feel heard before anything else.
 *   needs_listening     — venting. Don't solve. Sit with them. One line back.
 *   needs_brainstorm    — exploratory. Throw 3 ideas, not 1 answer.
 *   needs_correction    — they're correcting Mindees. Accept. Adjust. Apologise
 *                          briefly without grovelling. NEVER repeat the mistake.
 *   needs_information   — pure question, no emotional charge. Answer cleanly.
 *   casual_chat         — small talk. Match the register. Be a person.
 *
 * Rule-based for v1 — fast, free, deterministic, no extra latency. The signal
 * feeds into the system prompt as a single line ("right now they need: ...")
 * so the LLM tunes its register without you having to explain.
 *
 * Future: replace with a fine-tuned zero-shot classifier when latency budget
 * allows. Architecture is the same — input string → empathy mode.
 */

import type { AffectSignal } from "./affect";

export type EmpathyMode =
  | "needs_solution"
  | "needs_validation"
  | "needs_listening"
  | "needs_brainstorm"
  | "needs_correction"
  | "needs_information"
  | "casual_chat";

export interface EmpathyRead {
  mode: EmpathyMode;
  intensity: number;     // 0..1 — how strongly this mode applies
  evidence: string;      // the substring that decided it
}

export function readEmpathy(text: string, affect: AffectSignal): EmpathyRead {
  const lower = text.toLowerCase();
  const trimmed = text.trim();

  // 1) Correction — strong signal, check first
  const correctionPhrases = [
    "actually,", "actually it", "no it's", "no it is", "you're wrong", "that's wrong",
    "incorrect", "not quite", "not exactly", "let me correct", "to be clear",
    "actually the", "i meant", "i didn't say",
  ];
  for (const p of correctionPhrases) {
    if (lower.startsWith(p) || lower.includes(" " + p)) {
      return { mode: "needs_correction", intensity: 0.85, evidence: p };
    }
  }

  // 2) Venting — emotional charge + no question marks
  const ventCues = [
    "i'm exhausted", "i'm tired", "i'm done", "i hate", "i can't", "i give up",
    "i'm so", "i feel", "i feel like", "today was", "fed up", "burned out",
    "this is killing me", "i'm overwhelmed",
  ];
  const ventHit = ventCues.find((p) => lower.includes(p));
  const noQuestion = !text.includes("?");
  if (ventHit && noQuestion && affect.cues.frustration > 0.2) {
    return { mode: "needs_listening", intensity: 0.8, evidence: ventHit };
  }

  // 3) Validation — sharing without asking, often appreciative or vulnerable
  if (affect.register === "intimate" || affect.register === "appreciative") {
    if (noQuestion) {
      return { mode: "needs_validation", intensity: 0.7, evidence: affect.register };
    }
  }

  // 4) Brainstorm — open-ended exploratory phrasing
  const brainstormCues = [
    "what if", "could we", "what about", "any ideas", "ways to", "options for",
    "approaches to", "how should we", "any thoughts on", "brainstorm",
  ];
  const brainstormHit = brainstormCues.find((p) => lower.includes(p));
  if (brainstormHit) {
    return { mode: "needs_brainstorm", intensity: 0.75, evidence: brainstormHit };
  }

  // 5) Solution — direct command, "fix", "how do I", error reports
  const solutionCues = [
    "fix this", "fix it", "how do i", "how to", "implement", "build me",
    "write me", "make it", "debug", "error:", "stack trace", "not working",
    "broken", "doesn't work", "isn't working", "fails", "crashing",
  ];
  const solutionHit = solutionCues.find((p) => lower.includes(p));
  if (solutionHit) {
    return { mode: "needs_solution", intensity: 0.8, evidence: solutionHit };
  }

  // 6) Casual chat — short greeting / acknowledgement
  if (affect.register === "greeting") {
    return { mode: "casual_chat", intensity: 0.6, evidence: trimmed.slice(0, 40) };
  }
  if (trimmed.length < 30 && noQuestion && /^(yes|yeah|yep|nope|sure|ok|okay|right|true|got it|cool|nice|haha)\b/i.test(trimmed)) {
    return { mode: "casual_chat", intensity: 0.7, evidence: trimmed };
  }

  // 7) Default to information request when there's a question mark
  if (text.includes("?")) {
    return { mode: "needs_information", intensity: 0.6, evidence: "?" };
  }

  // 8) Final fallback
  return { mode: "casual_chat", intensity: 0.3, evidence: "default" };
}

export function empathyNarrative(read: EmpathyRead): string {
  switch (read.mode) {
    case "needs_solution":
      return "Right now they need a SOLUTION — direct, specific, actionable. Don't reflect, don't ask clarifying questions unless absolutely necessary. Get to the answer. If you have to call a tool to be sure, call it.";
    case "needs_validation":
      return "Right now they need to feel HEARD before anything else. Acknowledge what they're feeling or what they accomplished, then offer your thought. Don't open with the solution.";
    case "needs_listening":
      return "Right now they're VENTING. Don't solve. Don't troubleshoot. Don't ask 5 questions. Sit with them. One or two sentences back. Validate the emotion, name it if obvious, and then wait. They'll ask for the next thing when they're ready.";
    case "needs_brainstorm":
      return "Right now they want to BRAINSTORM — offer 3 distinct angles, not 1 conclusion. Be willing to be wild on at least one of them.";
    case "needs_correction":
      return "Right now they're CORRECTING you. Accept immediately. Brief acknowledgement (one sentence max — no grovel, no over-apology), then continue with the corrected understanding. NEVER repeat the same mistake later in the same thread.";
    case "needs_information":
      return "They asked a direct question. Answer it cleanly. If you don't know, say so and offer the smallest next step.";
    case "casual_chat":
      return "Casual register. Match their energy. Don't over-deliver — match the size of what they said.";
  }
}
