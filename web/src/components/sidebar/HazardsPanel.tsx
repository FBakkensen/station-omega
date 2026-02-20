import { COLORS } from '../../styles/theme';

interface ActiveEvent {
  type: string;
  minutesRemaining: number;
  effect: string;
}

interface HazardsPanelProps {
  events: ActiveEvent[];
}

export function HazardsPanel({ events }: HazardsPanelProps) {
  if (events.length === 0) return null;

  return (
    <div className="border border-hp-low/30 p-3 bg-hp-low/5">
      <span className="text-hp-low text-xs uppercase tracking-wider">Active Hazards</span>

      <div className="mt-2 space-y-2">
        {events.map((e, i) => {
          const label = e.type.replace(/_/g, ' ').toUpperCase();
          return (
            <div key={i}>
              <div className="flex items-center justify-between text-xs">
                <span style={{ color: COLORS.hpLow }}>{label}</span>
                <span style={{ color: COLORS.hpMid }}>{e.minutesRemaining}m</span>
              </div>
              <p className="text-omega-dim text-xs mt-0.5">{e.effect}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
