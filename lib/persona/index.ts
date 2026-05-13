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

// v0.2.6 — theory-of-mind + conversation arc
export {
  updateFromUserMessage as updateTheoryOfMind,
  readBeliefs,
  theoryOfMindNarrative,
  type TopicBelief,
  type ConfidenceLevel,
} from "./theory-of-mind";
export {
  readArc,
  arcNarrative,
  type ConversationArc,
  type ConversationPhase,
} from "./conversation-arc";

// v0.2.7 — emotional realism tensors
export {
  updateSentimentArc,
  getSentimentArc,
  sentimentArcNarrative,
  type SentimentArc,
} from "./sentiment-arc";
export {
  updateRhythm,
  rhythmPhase,
  rhythmNarrative,
  type RhythmState,
  type RhythmPhase,
} from "./rhythm";
export {
  recordInnerThought,
  readInnerThoughts,
  innerVoiceNarrative,
  type InnerThought,
} from "./inner-voice";

// v0.2.8 — topic-affinity (which topics light THIS user up)
export {
  bumpAffinity,
  engagementFromTurn,
  readAffinities,
  affinityNarrative,
  type TopicAffinity,
} from "./topic-affinity";
