/**
 * Serialization helpers for converting between in-memory GeneratedStation
 * (with Maps/Sets) and Convex-storable plain objects (with Records/Arrays).
 */

import type {
  GeneratedStation,
  MapLayout,
  Room,
  Item,
  GameState,
} from "../../src/types.js";
import { normalizeObjectiveChainWithLegacySupport } from "../../src/objectives.js";

// ─── Serialized Types ──────────────────────────────────────────────────────

export interface SerializedStation {
  config: GeneratedStation["config"];
  stationName: string;
  briefing: string;
  backstory: string;
  rooms: Record<string, Omit<Room, never>>;
  items: Record<string, Omit<Item, never>>;
  objectives: GeneratedStation["objectives"];
  entryRoomId: string;
  escapeRoomId: string;
  crewRoster: GeneratedStation["crewRoster"];
  arrivalScenario: GeneratedStation["arrivalScenario"];
  mapLayout: SerializedMapLayout;
  visualStyleGuide?: string;
  briefingVideoPrompt?: string;
}

interface SerializedMapLayout {
  seed: number;
  positions: Record<string, { x: number; y: number }>;
  bounds: MapLayout["bounds"];
  scaleHint: MapLayout["scaleHint"];
}

// ─── Station Serialization ──────────────────────────────────────────────────

export function serializeStation(station: GeneratedStation): SerializedStation {
  const rooms = Object.fromEntries(station.rooms) as SerializedStation["rooms"];

  const items = Object.fromEntries(station.items) as SerializedStation["items"];

  const mapLayout: SerializedMapLayout = {
    seed: station.mapLayout.seed,
    positions: Object.fromEntries(station.mapLayout.positions) as Record<
      string,
      { x: number; y: number }
    >,
    bounds: station.mapLayout.bounds,
    scaleHint: station.mapLayout.scaleHint,
  };

  return {
    config: station.config,
    stationName: station.stationName,
    briefing: station.briefing,
    backstory: station.backstory,
    rooms,
    items,
    objectives: station.objectives,
    entryRoomId: station.entryRoomId,
    escapeRoomId: station.escapeRoomId,
    crewRoster: station.crewRoster,
    arrivalScenario: station.arrivalScenario,
    mapLayout,
    visualStyleGuide: station.visualStyleGuide,
    briefingVideoPrompt: station.briefingVideoPrompt,
  };
}

export function deserializeStation(data: SerializedStation): GeneratedStation {
  const rooms = new Map(Object.entries(data.rooms));

  const items = new Map(Object.entries(data.items));

  const mapLayout: MapLayout = {
    seed: data.mapLayout.seed,
    positions: new Map(Object.entries(data.mapLayout.positions)),
    bounds: data.mapLayout.bounds,
    scaleHint: data.mapLayout.scaleHint,
  };

  return {
    config: data.config,
    stationName: data.stationName,
    briefing: data.briefing,
    backstory: data.backstory,
    rooms,
    items,
    objectives: normalizeObjectiveChainWithLegacySupport(data.objectives),
    entryRoomId: data.entryRoomId,
    escapeRoomId: data.escapeRoomId,
    crewRoster: data.crewRoster,
    arrivalScenario: data.arrivalScenario,
    mapLayout,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
    visualStyleGuide: data.visualStyleGuide ?? (data as any).visualStyleSeed as string | undefined,
    briefingVideoPrompt: data.briefingVideoPrompt,
  };
}

// ─── Game State Serialization ───────────────────────────────────────────────

export interface SerializedGameState {
  hp: number;
  maxHp: number;
  oxygen: number;
  maxOxygen: number;
  suitIntegrity: number;
  inventory: string[];
  maxInventory: number;
  currentRoom: string;
  roomsVisited: string[];
  itemsTaken: string[];
  revealedItems: string[];
  hasObjectiveItem: boolean;
  gameOver: boolean;
  won: boolean;
  repairedSystems: string[];
  craftedItems: string[];
  systemsCascaded: number;
  improvizedSolutions: number;
  roomVisitCount: Record<string, number>;
  turnCount: number;
  moveCount: number;
  characterClass: GameState["characterClass"];
  activeEvents: GameState["activeEvents"];
  moralProfile: {
    choices: GameState["moralProfile"]["choices"];
    tendencies: GameState["moralProfile"]["tendencies"];
    endingFlags: string[];
  };
  metrics: Omit<GameState["metrics"], "roomsVisited"> & {
    roomsVisited: string[];
  };
  fieldSurgeryUsedInRoom: string[];
  missionElapsedMinutes: number;
  eventCooldowns?: Record<string, number>;
}

export function serializeGameState(state: GameState): SerializedGameState {
  return {
    hp: state.hp,
    maxHp: state.maxHp,
    oxygen: state.oxygen,
    maxOxygen: state.maxOxygen,
    suitIntegrity: state.suitIntegrity,
    inventory: [...state.inventory],
    maxInventory: state.maxInventory,
    currentRoom: state.currentRoom,
    roomsVisited: Array.from(state.roomsVisited),
    itemsTaken: Array.from(state.itemsTaken),
    revealedItems: Array.from(state.revealedItems),
    hasObjectiveItem: state.hasObjectiveItem,
    gameOver: state.gameOver,
    won: state.won,
    repairedSystems: Array.from(state.repairedSystems),
    craftedItems: [...state.craftedItems],
    systemsCascaded: state.systemsCascaded,
    improvizedSolutions: state.improvizedSolutions,
    roomVisitCount: Object.fromEntries(state.roomVisitCount),
    turnCount: state.turnCount,
    moveCount: state.moveCount,
    characterClass: state.characterClass,
    activeEvents: [...state.activeEvents],
    moralProfile: {
      choices: [...state.moralProfile.choices],
      tendencies: { ...state.moralProfile.tendencies },
      endingFlags: Array.from(state.moralProfile.endingFlags),
    },
    metrics: {
      ...state.metrics,
      roomsVisited: Array.from(state.metrics.roomsVisited),
    },
    fieldSurgeryUsedInRoom: Array.from(state.fieldSurgeryUsedInRoom),
    missionElapsedMinutes: state.missionElapsedMinutes,
    eventCooldowns: state.eventCooldowns,
  };
}

export function deserializeGameState(data: SerializedGameState): GameState {
  return {
    hp: data.hp,
    maxHp: data.maxHp,
    oxygen: data.oxygen,
    maxOxygen: data.maxOxygen,
    suitIntegrity: data.suitIntegrity,
    inventory: [...data.inventory],
    maxInventory: data.maxInventory,
    currentRoom: data.currentRoom,
    roomsVisited: new Set(data.roomsVisited),
    itemsTaken: new Set(data.itemsTaken),
    revealedItems: new Set(data.revealedItems),
    hasObjectiveItem: data.hasObjectiveItem,
    gameOver: data.gameOver,
    won: data.won,
    repairedSystems: new Set(data.repairedSystems),
    craftedItems: [...data.craftedItems],
    systemsCascaded: data.systemsCascaded,
    improvizedSolutions: data.improvizedSolutions,
    roomVisitCount: new Map(Object.entries(data.roomVisitCount)),
    turnCount: data.turnCount,
    moveCount: data.moveCount,
    characterClass: data.characterClass,
    activeEvents: [...data.activeEvents],
    moralProfile: {
      choices: [...data.moralProfile.choices],
      tendencies: { ...data.moralProfile.tendencies },
      endingFlags: new Set(data.moralProfile.endingFlags),
    },
    metrics: {
      ...data.metrics,
      roomsVisited: new Set(data.metrics.roomsVisited),
    },
    fieldSurgeryUsedInRoom: new Set(data.fieldSurgeryUsedInRoom),
    missionElapsedMinutes: data.missionElapsedMinutes,
    eventCooldowns: data.eventCooldowns ?? {},
  };
}
