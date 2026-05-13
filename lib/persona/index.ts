/**
 * Public persona API — barrel module the orchestrator imports from.
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

// Tensors added in v0.2.2
export {
  USER_DIMS,
  getUserModel,
  applyTurn as applyTurnToUserModel,
  persistUserModel,
  userModelNarrative,
  type UserDim,
  type UserModel,
} from "./user-model";
export {
  getRelationship,
  applyTurn as applyTurnToRelationship,
  applyThumb,
  persistRelationship,
  relationshipNarrative,
  type Relationship,
} from "./relationship";
export { curiosityGap, curiosityNarrative, type CuriosityGap } from "./curiosity";
export {
  fingerprint,
  distance as driftDistance,
  recordReply as recordDriftFromReply,
  REANCHOR_INSTRUCTION,
  type DriftFingerprint,
  type DriftState,
} from "./drift";
export { predictReward, rewardNarrative, type RewardEstimate } from "./reward";

// v0.2.3 — orientation + graph extraction
export {
  getGoal,
  updateGoal,
  goalNarrative,
  type GoalState,
} from "./goal";
export { extractAndPersistTriples } from "./extract-triples";

// v0.2.4 — empathy state (what the user needs Mindees to BE this turn)
export { readEmpathy, empathyNarrative, type EmpathyMode, type EmpathyRead } from "./empathy";

// v0.2.4 — auto-research (proactive learning between turns)
export { decideAutoResearch, performAutoResearch, type AutoResearchDecision } from "./auto-research";

// v0.2.5 — humanizing micro-tensors
export { readTime, timeNarrative, type TimeContext } from "./time-awareness";
export { recordUserText, signatureVocab, vocabNarrative } from "./vocab-mirror";
export {
  recordCorrection,
  recentCorrections,
  correctionsNarrative,
  type Correction,
} from "./self-correction";
