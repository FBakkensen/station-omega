export type RawGameDoc = {
  _id: string;
  npcOverrides?: unknown;
  state?: {
    npcAllies?: unknown;
    metrics?: {
      npcInteractions?: unknown;
    };
  };
};

export type RawTurnSegmentDoc = {
  gameId?: string;
  segment?: {
    entityRefs?: unknown;
  };
};

export type LegacyReason =
  | "npcOverrides"
  | "state.npcAllies"
  | "state.metrics.npcInteractions"
  | "turnSegments.entityRefs.npc";

export type LegacyGameEntry = {
  id: string;
  reasons: LegacyReason[];
};

export function parseJsonLines<T>(rawOutput: string): T[] {
  return rawOutput
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export function detectLegacyReasons(doc: RawGameDoc): LegacyReason[] {
  const reasons: LegacyReason[] = [];
  if (Object.prototype.hasOwnProperty.call(doc, "npcOverrides")) {
    reasons.push("npcOverrides");
  }
  if (Object.prototype.hasOwnProperty.call(doc.state ?? {}, "npcAllies")) {
    reasons.push("state.npcAllies");
  }
  if (Object.prototype.hasOwnProperty.call(doc.state?.metrics ?? {}, "npcInteractions")) {
    reasons.push("state.metrics.npcInteractions");
  }
  return reasons;
}

export function hasLegacyNpcEntityRefs(doc: RawTurnSegmentDoc): boolean {
  if (!Array.isArray(doc.segment?.entityRefs)) {
    return false;
  }

  return doc.segment.entityRefs.some((ref) => {
    if (typeof ref !== "object" || ref === null) {
      return false;
    }

    return (ref as { type?: unknown }).type === "npc";
  });
}

function addLegacyReasons(
  entries: Map<string, Set<LegacyReason>>,
  gameId: string | undefined,
  reasons: LegacyReason[],
): void {
  if (!gameId || reasons.length === 0) {
    return;
  }

  let existing = entries.get(gameId);
  if (!existing) {
    existing = new Set<LegacyReason>();
    entries.set(gameId, existing);
  }

  for (const reason of reasons) {
    existing.add(reason);
  }
}

export function collectLegacyGameEntries(
  gameDocs: RawGameDoc[],
  turnSegmentDocs: RawTurnSegmentDoc[],
): LegacyGameEntry[] {
  const entries = new Map<string, Set<LegacyReason>>();

  for (const doc of gameDocs) {
    addLegacyReasons(entries, doc._id, detectLegacyReasons(doc));
  }

  for (const doc of turnSegmentDocs) {
    if (hasLegacyNpcEntityRefs(doc)) {
      addLegacyReasons(entries, doc.gameId, ["turnSegments.entityRefs.npc"]);
    }
  }

  return [...entries.entries()]
    .map(([id, reasons]) => ({
      id,
      reasons: [...reasons].sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}