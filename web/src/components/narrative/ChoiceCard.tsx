import type { Choice } from '../../engine/types';
import { COLORS } from '../../styles/theme';

interface ChoiceCardProps {
  title: string;
  choices: Choice[];
  onChoice: (choiceId: string) => void;
}

const RISK_COLORS: Record<NonNullable<Choice['risk']>, string> = {
  low: COLORS.gradeA,
  medium: COLORS.hpMid,
  high: COLORS.gradeD,
  critical: COLORS.gradeF,
};

function riskLabel(risk: Choice['risk']): string | null {
  if (!risk) return null;
  return `${risk.toUpperCase()} RISK`;
}

export function ChoiceCard({ title, choices, onChoice }: ChoiceCardProps) {
  return (
    <div
      className="p-3 border-l-2"
      style={{
        backgroundColor: COLORS.cmdCardBg,
        borderColor: COLORS.title,
      }}
    >
      <p className="text-omega-dim text-xs uppercase tracking-wider mb-2">
        {title}
      </p>
      <div className="space-y-1.5">
        {choices.map((choice) => (
          <button
            key={choice.id}
            onClick={() => { onChoice(choice.id); }}
            className="w-full text-left px-3 py-2 text-sm border transition-colors
                       hover:bg-omega-input-focus focus:bg-omega-input-focus outline-none"
            style={{
              color: COLORS.text,
              borderColor: COLORS.border,
              backgroundColor: COLORS.inputBg,
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold" style={{ color: COLORS.title }}>
                  {choice.label}
                </div>
                {choice.description && (
                  <div className="text-omega-dim text-xs mt-0.5">{choice.description}</div>
                )}
              </div>
              {choice.risk && (
                <span
                  className="text-[10px] font-semibold tracking-wide whitespace-nowrap"
                  style={{ color: RISK_COLORS[choice.risk] }}
                >
                  {riskLabel(choice.risk)}
                </span>
              )}
            </div>
            {(choice.timeCost || choice.consequence) && (
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-omega-dim">
                {choice.timeCost && (
                  <span>TIME: {choice.timeCost}</span>
                )}
                {choice.consequence && (
                  <span>TRADEOFF: {choice.consequence}</span>
                )}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
