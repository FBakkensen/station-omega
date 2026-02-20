import { COLORS } from '../../styles/theme';

interface SystemFailureInfo {
  systemId: string;
  status: string;
  challengeState: string;
  severity: number;
  minutesUntilCascade: number;
}

interface SystemsPanelProps {
  failures: SystemFailureInfo[];
}

const SYSTEM_ABBREV: Record<string, string> = {
  life_support: 'LIFE SUP',
  pressure_seal: 'PRESSURE',
  power_relay: 'POWER',
  coolant_loop: 'COOLANT',
  atmosphere_processor: 'ATMO',
  gravity_generator: 'GRAVITY',
  radiation_shielding: 'RAD SHLD',
  communications: 'COMMS',
  fire_suppression: 'FIRE SUP',
  water_recycler: 'WATER',
  thermal_regulator: 'THERMAL',
  structural_integrity: 'STRUCT',
};

function statusColor(status: string): string {
  if (status === 'critical' || status === 'offline') return COLORS.hpLow;
  if (status === 'failing') return '#ff8844';
  if (status === 'degraded') return COLORS.hpMid;
  return COLORS.hpGood;
}

function challengeDots(state: string): string {
  switch (state) {
    case 'detected': return '○○○○';
    case 'characterized': return '●○○○';
    case 'stabilized': return '●●○○';
    case 'resolved': return '●●●●';
    default: return '○○○○';
  }
}

export function SystemsPanel({ failures }: SystemsPanelProps) {
  const active = failures.filter(f => f.challengeState !== 'resolved' && f.challengeState !== 'failed');

  if (active.length === 0) return null;

  return (
    <div className="border border-omega-border p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-omega-dim text-xs uppercase tracking-wider">Systems</span>
        <span className="text-hp-low text-xs">{active.length} FAILING</span>
      </div>

      <div className="space-y-1.5">
        {active.slice(0, 5).map((f) => {
          const abbrev = SYSTEM_ABBREV[f.systemId] ?? f.systemId.slice(0, 8).toUpperCase();
          const sevMarkers = '▲'.repeat(f.severity);
          const hasCascade = f.minutesUntilCascade > 0 && f.minutesUntilCascade <= 30;

          return (
            <div key={f.systemId} className="flex items-center gap-1 text-xs">
              <span className="text-omega-text w-16 truncate">{abbrev}</span>
              <span style={{ color: statusColor(f.status) }}>{sevMarkers}</span>
              <span className="flex-1" />
              {hasCascade ? (
                <span className="text-hp-low">⚡{Math.round(f.minutesUntilCascade)}m</span>
              ) : (
                <span className="text-omega-dim">{challengeDots(f.challengeState)}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
