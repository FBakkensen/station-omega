import { COLORS } from '../../styles/theme';

interface EnvironmentReadout {
  oxygenPct: number;
  co2Ppm: number;
  pressureKpa: number;
  temperatureC: number;
  radiationMsv: number;
  structuralPct: number;
}

interface AtmospherePanelProps {
  environment: EnvironmentReadout | null;
}

function levelColor(level: 'green' | 'yellow' | 'red'): string {
  if (level === 'green') return COLORS.hpGood;
  if (level === 'yellow') return COLORS.hpMid;
  return COLORS.hpLow;
}

function o2Level(pct: number): 'green' | 'yellow' | 'red' {
  if (pct >= 19) return 'green';
  if (pct >= 16) return 'yellow';
  return 'red';
}

function co2Level(ppm: number): 'green' | 'yellow' | 'red' {
  if (ppm <= 2000) return 'green';
  if (ppm <= 4000) return 'yellow';
  return 'red';
}

function pressureLevel(kpa: number): 'green' | 'yellow' | 'red' {
  if (kpa >= 85 && kpa <= 105) return 'green';
  if (kpa >= 70 && kpa <= 115) return 'yellow';
  return 'red';
}

function tempLevel(c: number): 'green' | 'yellow' | 'red' {
  if (c >= 15 && c <= 30) return 'green';
  if (c >= 5 && c <= 40) return 'yellow';
  return 'red';
}

function radLevel(msv: number): 'green' | 'yellow' | 'red' {
  if (msv <= 1) return 'green';
  if (msv <= 5) return 'yellow';
  return 'red';
}

function structLevel(pct: number): 'green' | 'yellow' | 'red' {
  if (pct >= 70) return 'green';
  if (pct >= 40) return 'yellow';
  return 'red';
}

interface MetricRowProps {
  label: string;
  value: string;
  level: 'green' | 'yellow' | 'red';
  pct: number;
}

function MetricRow({ label, value, level, pct }: MetricRowProps) {
  const color = levelColor(level);
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-omega-dim w-8">{label}</span>
      <div className="flex-1 h-1.5 bg-omega-border overflow-hidden">
        <div
          className="h-full transition-all duration-300"
          style={{ width: `${String(Math.min(pct, 100))}%`, backgroundColor: color }}
        />
      </div>
      <span className="w-16 text-right" style={{ color }}>{value}</span>
    </div>
  );
}

export function AtmospherePanel({ environment }: AtmospherePanelProps) {
  if (!environment) {
    return (
      <div className="border border-omega-border p-3">
        <span className="text-omega-dim text-xs uppercase tracking-wider">Atmosphere</span>
        <p className="text-omega-dim/50 text-xs mt-2">No sensor data</p>
      </div>
    );
  }

  const { oxygenPct, co2Ppm, pressureKpa, temperatureC, radiationMsv, structuralPct } = environment;

  return (
    <div className="border border-omega-border p-3">
      <span className="text-omega-dim text-xs uppercase tracking-wider">Atmosphere</span>

      <div className="mt-2 space-y-1">
        <MetricRow label="O₂" value={`${oxygenPct.toFixed(1)}%`} level={o2Level(oxygenPct)} pct={(oxygenPct / 21) * 100} />
        <MetricRow label="CO₂" value={`${String(Math.round(co2Ppm))}ppm`} level={co2Level(co2Ppm)} pct={(co2Ppm / 6000) * 100} />
        <MetricRow label="kPa" value={pressureKpa.toFixed(1)} level={pressureLevel(pressureKpa)} pct={(pressureKpa / 101) * 100} />
        <MetricRow label="Temp" value={`${String(Math.round(temperatureC))}°C`} level={tempLevel(temperatureC)} pct={(temperatureC / 55) * 100} />
        <MetricRow label="Rad" value={`${radiationMsv.toFixed(1)}mSv`} level={radLevel(radiationMsv)} pct={(radiationMsv / 10) * 100} />
        <MetricRow label="Str" value={`${String(Math.round(structuralPct))}%`} level={structLevel(structuralPct)} pct={structuralPct} />
      </div>
    </div>
  );
}
