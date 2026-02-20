import type { Choice } from '../../engine/types';
import { COLORS } from '../../styles/theme';

interface ChoiceCardProps {
  choices: Choice[];
  onChoice: (choiceId: string) => void;
}

export function ChoiceCard({ choices, onChoice }: ChoiceCardProps) {
  return (
    <div
      className="p-3 border-l-2"
      style={{
        backgroundColor: COLORS.cmdCardBg,
        borderColor: COLORS.title,
      }}
    >
      <p className="text-omega-dim text-xs uppercase tracking-wider mb-2">
        Suggested Actions
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
            <span className="font-semibold" style={{ color: COLORS.title }}>
              {choice.label}
            </span>
            {choice.description && (
              <span className="text-omega-dim text-xs ml-2">{choice.description}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
