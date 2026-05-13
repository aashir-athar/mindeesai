/**
 * Public persona API — barrel module the orchestrator imports from.
 *
 * Usage:
 *   const affect = readAffect(userMessage);
 *   const mood   = await updateMood(affect);            // persist + return new
 *   const prompt = buildMindeesSystemPrompt({ mood, memoryBlock, toolsBlock });
 */

export { readAffect, type AffectSignal } from "./affect";
export {
  getMood,
  updateMood,
  moodNarrative,
  BASELINE,
  DIMENSIONS,
  type MoodVector,
  type MoodDim,
} from "./mood";
export { MINDEES_CORE, buildMindeesSystemPrompt, type PersonaContext } from "./mindees";
