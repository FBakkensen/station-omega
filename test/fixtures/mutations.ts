export function duplicateRoomId<T extends { rooms: Array<{ id: string }> }>(
  value: T,
  sourceIndex: number,
  targetIndex: number,
): T {
  const copy = structuredClone(value);
  const source = copy.rooms[sourceIndex];
  const target = copy.rooms[targetIndex];
  target.id = source.id;
  return copy;
}

export function withInvalidObjectiveRoom<
  T extends { objectives: { steps: Array<{ roomId: string }> } },
>(
  value: T,
  stepIndex: number,
  roomId: string,
): T {
  const copy = structuredClone(value);
  const step = copy.objectives.steps[stepIndex];
  step.roomId = roomId;
  return copy;
}

export function withInvalidRequiredItem<
  T extends { objectives: { steps: Array<{ requiredItemId: string | null }> } },
>(
  value: T,
  stepIndex: number,
  itemId: string,
): T {
  const copy = structuredClone(value);
  const step = copy.objectives.steps[stepIndex];
  step.requiredItemId = itemId;
  return copy;
}
