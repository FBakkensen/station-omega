import { COLORS } from '../../styles/theme';

interface SuitPanelProps {
  hp: number;
  maxHp: number;
  oxygen: number;
  maxOxygen: number;
  suitIntegrity: number;
  characterClass: string;
  missionElapsedMinutes: number;
}

const CLASS_ICONS: Record<string, string> = {
  engineer: '🔧',
  scientist: '🔬',
  medic: '⚕️',
  commander: '⭐',
};

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="flex-1 h-2 bg-omega-border overflow-hidden">
      <div className="h-full transition-all duration-300" style={{ width: `${String(pct)}%`, backgroundColor: color }} />
    </div>
  );
}

function hpColor(hp: number, max: number): string {
  const pct = hp / max;
  if (pct >= 0.6) return COLORS.hpGood;
  if (pct >= 0.25) return COLORS.hpMid;
  return COLORS.hpLow;
}

export function SuitPanel({ hp, maxHp, oxygen, maxOxygen, suitIntegrity, characterClass, missionElapsedMinutes }: SuitPanelProps) {
  const icon = CLASS_ICONS[characterClass] ?? '🧑';
  const hours = Math.floor(missionElapsedMinutes / 60);
  const mins = missionElapsedMinutes % 60;
  const met = `T+${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;

  return (
    <div className="border border-omega-border p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-omega-dim text-xs uppercase tracking-wider">Suit Status</span>
        <span className="text-omega-dim text-xs">{icon} {met}</span>
      </div>

      {/* HP */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-omega-dim text-xs w-8">HP</span>
        <ProgressBar value={hp} max={maxHp} color={hpColor(hp, maxHp)} />
        <span className="text-xs w-14 text-right" style={{ color: hpColor(hp, maxHp) }}>
          {hp}/{maxHp}
        </span>
      </div>

      {/* O2 */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-omega-dim text-xs w-8">O₂</span>
        <ProgressBar value={oxygen} max={maxOxygen} color={hpColor(oxygen, maxOxygen)} />
        <span className="text-xs w-14 text-right" style={{ color: hpColor(oxygen, maxOxygen) }}>
          {oxygen}%
        </span>
      </div>

      {/* Suit */}
      <div className="flex items-center gap-2">
        <span className="text-omega-dim text-xs w-8">SUIT</span>
        <ProgressBar value={suitIntegrity} max={100} color={hpColor(suitIntegrity, 100)} />
        <span className="text-xs w-14 text-right" style={{ color: hpColor(suitIntegrity, 100) }}>
          {suitIntegrity}%
        </span>
      </div>
    </div>
  );
}
