import { SuitPanel } from './SuitPanel';
import { AtmospherePanel } from './AtmospherePanel';
import { SystemsPanel } from './SystemsPanel';
import { HazardsPanel } from './HazardsPanel';
import { InventoryPanel } from './InventoryPanel';
import { MissionPanel } from './MissionPanel';
import { SceneImage } from './SceneImage';
import type { StationImage } from '../../hooks/useStationImages';

/** Shape of the game status data from Convex (deserialized). */
export interface GameStatusData {
  hp: number;
  maxHp: number;
  oxygen: number;
  maxOxygen: number;
  suitIntegrity: number;
  characterClass: string;
  missionElapsedMinutes: number;
  roomName: string;
  roomIndex: number;
  totalRooms: number;
  inventory: string[];
  inventoryKeyFlags: boolean[];
  maxInventory: number;
  activeEvents: Array<{ type: string; minutesRemaining: number; effect: string }>;
  objectiveTitle: string;
  objectiveStep: number;
  objectiveTotal: number;
  objectiveCurrentDesc: string;
  objectivesComplete: boolean;
  objectiveBriefing: string;
  objectiveSteps: Array<{ id?: string; description: string; completed: boolean }>;
  systemFailures: Array<{
    systemId: string;
    status: string;
    challengeState: string;
    severity: number;
    minutesUntilCascade: number;
  }>;
  environment: {
    oxygenPct: number;
    co2Ppm: number;
    pressureKpa: number;
    temperatureC: number;
    radiationMsv: number;
    structuralPct: number;
  } | null;
}

interface SidebarProps {
  status: GameStatusData | null;
  stationName: string;
  stationImages?: Map<string, StationImage>;
  currentRoomId?: string;
}

export function Sidebar({ status, stationName, stationImages, currentRoomId }: SidebarProps) {
  // Resolve the current scene image: room image or none
  const sceneImage = stationImages?.get(`room:${currentRoomId ?? ''}`)
    ?? undefined;

  if (!status) {
    return (
      <div className="w-96 bg-omega-panel p-4 border-l border-omega-border overflow-y-auto hidden lg:block">
        <h2 className="text-omega-title text-xs tracking-wider uppercase mb-4">{stationName}</h2>
        <p className="text-omega-dim text-xs">Loading status...</p>
      </div>
    );
  }

  return (
    <div className="w-96 bg-omega-panel border-l border-omega-border overflow-y-auto hidden lg:flex flex-col">
      {/* Scene Image */}
      <SceneImage
        image={sceneImage}
        stationName={stationName}
        roomName={status.roomName}
        roomIndex={status.roomIndex}
        totalRooms={status.totalRooms}
      />

      {/* Panels */}
      <div className="flex flex-col gap-3 p-4">
        <SuitPanel
          hp={status.hp}
          maxHp={status.maxHp}
          oxygen={status.oxygen}
          maxOxygen={status.maxOxygen}
          suitIntegrity={status.suitIntegrity}
          characterClass={status.characterClass}
          missionElapsedMinutes={status.missionElapsedMinutes}
        />

        <AtmospherePanel environment={status.environment} />

        <SystemsPanel failures={status.systemFailures} />

        <HazardsPanel events={status.activeEvents} />

        <InventoryPanel
          items={status.inventory}
          maxInventory={status.maxInventory}
          keyFlags={status.inventoryKeyFlags}
        />

        <MissionPanel
          title={status.objectiveTitle}
          briefing={status.objectiveBriefing}
          currentStep={status.objectiveStep}
          totalSteps={status.objectiveTotal}
          currentDescription={status.objectiveCurrentDesc}
          steps={status.objectiveSteps}
          isComplete={status.objectivesComplete}
        />
      </div>
    </div>
  );
}
