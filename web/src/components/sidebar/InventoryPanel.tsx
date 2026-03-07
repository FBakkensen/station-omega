import { COLORS } from '../../styles/theme';

interface InventoryPanelProps {
  items: string[];
  maxInventory: number;
  keyFlags: boolean[];
}

export function InventoryPanel({ items, maxInventory, keyFlags }: InventoryPanelProps) {
  const slotPct = maxInventory > 0 ? items.length / maxInventory : 0;
  const slotColor = slotPct >= 1 ? COLORS.hpLow : slotPct >= 0.8 ? COLORS.hpMid : COLORS.hpGood;

  return (
    <div className="border border-omega-border p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-omega-dim text-xs uppercase tracking-wider">Inventory</span>
        <span className="text-xs" style={{ color: slotColor }}>
          {items.length}/{maxInventory}
        </span>
      </div>

      {items.length === 0 ? (
        <p className="text-omega-dim/50 text-xs">Empty</p>
      ) : (
        <ul className="space-y-0.5">
          {items.map((item, i) => (
            <li key={i} className="text-xs flex items-center gap-1.5">
              <span className="text-omega-dim">{keyFlags[i] ? '🔑' : '•'}</span>
              <span className="text-omega-text truncate">{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
