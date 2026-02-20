import { SuitPanel } from './SuitPanel';
import { AtmospherePanel } from './AtmospherePanel';
import { SystemsPanel } from './SystemsPanel';
import { HazardsPanel } from './HazardsPanel';
import { InventoryPanel } from './InventoryPanel';
import { MissionPanel } from './MissionPanel';

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
  objectiveSteps: Array<{ description: string; completed: boolean }>;
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
}

export function Sidebar({ status, stationName }: SidebarProps) {
  if (!status) {
    return (
      <div className="w-72 bg-omega-panel p-4 border-l border-omega-border overflow-y-auto hidden lg:block">
        <h2 className="text-omega-title text-xs tracking-wider uppercase mb-4">{stationName}</h2>
        <p className="text-omega-dim text-xs">Loading status...</p>
      </div>
    );
  }

  return (
    <div className="w-72 bg-omega-panel p-3 border-l border-omega-border overflow-y-auto hidden lg:flex flex-col gap-3">
      {/* Station Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-omega-title text-xs tracking-wider uppercase truncate">{stationName}</h2>
        <span className="text-omega-dim text-xs">
          {status.roomName} ({status.roomIndex}/{status.totalRooms})
        </span>
      </div>

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
        currentStep={status.objectiveStep}
        totalSteps={status.objectiveTotal}
        currentDescription={status.objectiveCurrentDesc}
        steps={status.objectiveSteps}
        isComplete={status.objectivesComplete}
      />
    </div>
  );
}
