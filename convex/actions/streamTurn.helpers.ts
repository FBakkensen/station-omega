import { SEGMENT_TYPES } from "../../src/schema";

export interface ConversationMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChoiceOption {
  label: string;
  description: string;
  risk?: "low" | "medium" | "high" | "critical";
  timeCost?: string;
  consequence?: string;
}

export interface ChoiceSetInput {
  title: string;
  choices: ChoiceOption[];
}

export function buildTurnMessages(
  conversationHistory: ConversationMessage[],
  turnContext: string | null | undefined,
  playerInput: string,
): ConversationMessage[] {
  return [
    ...conversationHistory,
    ...(turnContext ? [{ role: "system", content: turnContext } satisfies ConversationMessage] : []),
    { role: "user", content: playerInput },
  ];
}

export function mapChoicesForPersistence(choiceSet: ChoiceSetInput): Array<{
  id: string;
  label: string;
  description: string;
  risk?: "low" | "medium" | "high" | "critical";
  timeCost?: string;
  consequence?: string;
}> {
  return choiceSet.choices.map((choice, index) => ({
    id: String(index),
    label: choice.label,
    description: choice.description,
    ...(choice.risk ? { risk: choice.risk } : {}),
    ...(choice.timeCost ? { timeCost: choice.timeCost } : {}),
    ...(choice.consequence ? { consequence: choice.consequence } : {}),
  }));
}

const VALID_SEGMENT_TYPES = new Set<string>(SEGMENT_TYPES);

const SOCIAL_KEYWORDS_RE = /\b(talk|speak|ask|negotiate|greet|hello|address)\b/i;

export function isValidSegmentType(type: string): boolean {
  return VALID_SEGMENT_TYPES.has(type);
}

export function shouldDowngradeDialogue(segType: string, playerInput: string): boolean {
  return segType === "dialogue" && !SOCIAL_KEYWORDS_RE.test(playerInput);
}
