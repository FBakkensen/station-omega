export interface ConversationMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChoiceOption {
  label: string;
  description: string;
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
}> {
  return choiceSet.choices.map((choice, index) => ({
    id: String(index),
    label: choice.label,
    description: choice.description,
  }));
}
