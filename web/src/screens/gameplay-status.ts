import type { GameStatusData } from '../components/sidebar/Sidebar';

/** Loose shape of the game document from Convex. */
export interface ConvexGameDoc {
  state?: {
    hp: number;
    maxHp: number;
    oxygen: number;
    maxOxygen: number;
    suitIntegrity: number;
    characterClass: string;
    missionElapsedMinutes: number;
    currentRoom: string;
    roomsVisited: string[];
    inventory: string[];
    maxInventory: number;
    activeEvents: Array<{ type: string; minutesRemaining: number; effect: string }>;
    metrics?: Record<string, unknown>;
  };
  objectivesOverride?: {
    title: string;
    briefing?: string;
    steps: Array<{ id?: string; description: string; completed: boolean; revealed?: boolean }>;
    currentStepIndex: number;
    completed: boolean;
  };
  isOver: boolean;
  won: boolean;
  turnCount: number;
  characterClass: string;
  difficulty: string;
}

export interface ConvexStationDoc {
  stationName: string;
  data?: {
    rooms?: Record<
      string,
      {
        id: string;
        name: string;
        archetype: string;
        connections: string[];
        depth: number;
        systemFailures?: Array<{
          systemId: string;
          status: string;
          challengeState: string;
          severity: number;
          minutesUntilCascade: number;
        }>;
      }
    >;
    items?: Record<string, { name: string; isKeyItem?: boolean }>;
    npcs?: Record<string, { name: string }>;
    crewRoster?: Array<{ name: string; role: string }>;
    arrivalScenario?: { playerCallsign?: string };
    objectives?: {
      title: string;
      briefing?: string;
      steps: Array<{ id?: string; description: string; completed: boolean; revealed?: boolean }>;
      currentStepIndex: number;
      completed: boolean;
    };
  };
}

/**
 * Extract sidebar-compatible status data from the raw Convex game + station docs.
 */
export function extractGameStatus(
  game: ConvexGameDoc | null | undefined,
  station: ConvexStationDoc | null | undefined,
): GameStatusData | null {
  if (!game?.state || !station?.data) return null;

  const state = game.state;
  const sData = station.data;
  const rooms = sData.rooms;
  const currentRoom = rooms?.[state.currentRoom];
  const roomName = currentRoom?.name ?? state.currentRoom;
  const roomIds = Object.keys(rooms ?? {});
  const roomIndex = roomIds.indexOf(state.currentRoom) + 1;
  const totalRooms = roomIds.length;

  const inventory = state.inventory.map((id) => {
    const item = sData.items?.[id];
    return item?.name ?? id;
  });

  const inventoryKeyFlags = state.inventory.map((id) => {
    const item = sData.items?.[id];
    return item?.isKeyItem ?? false;
  });

  const systemFailures = (currentRoom?.systemFailures ?? []).map((f) => ({
    systemId: f.systemId,
    status: f.status,
    challengeState: f.challengeState,
    severity: f.severity,
    minutesUntilCascade: f.minutesUntilCascade,
  }));

  const objectives = game.objectivesOverride ?? sData.objectives;
  const steps = objectives?.steps ?? [];
  const currentStepIndex = objectives?.currentStepIndex ?? 0;
  const visibleSteps = steps.filter((step, index) => {
    if (typeof step.revealed === 'boolean') {
      return step.revealed;
    }
    return step.completed || index === currentStepIndex;
  });
  const currentVisibleStepIndex = objectives?.completed
    ? visibleSteps.length
    : visibleSteps.findIndex((step) => !step.completed);
  const currentVisibleStep = currentVisibleStepIndex >= 0 ? visibleSteps[currentVisibleStepIndex] : null;

  return {
    hp: state.hp,
    maxHp: state.maxHp,
    oxygen: state.oxygen,
    maxOxygen: state.maxOxygen,
    suitIntegrity: state.suitIntegrity,
    characterClass: state.characterClass,
    missionElapsedMinutes: state.missionElapsedMinutes,
    roomName,
    roomIndex,
    totalRooms,
    inventory,
    inventoryKeyFlags,
    maxInventory: state.maxInventory,
    activeEvents: state.activeEvents,
    objectiveBriefing: objectives?.briefing ?? '',
    objectiveTitle: objectives?.title ?? 'Unknown',
    objectiveStep: currentVisibleStepIndex >= 0 ? currentVisibleStepIndex + 1 : visibleSteps.length,
    objectiveTotal: steps.length,
    objectiveCurrentDesc: currentVisibleStep?.description ?? '',
    objectivesComplete: objectives?.completed ?? false,
    objectiveSteps: visibleSteps.map((s) => ({
      id: s.id,
      description: s.description,
      completed: s.completed,
    })),
    systemFailures,
    environment: null,
  };
}
