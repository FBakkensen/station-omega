interface ObjectiveStep {
  description: string;
  completed: boolean;
}

interface MissionModalProps {
  title: string;
  steps: ObjectiveStep[];
  currentStepIndex: number;
  isComplete: boolean;
  onClose: () => void;
}

export function MissionModal({ title, steps, currentStepIndex, isComplete, onClose }: MissionModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <div
        className="border border-omega-border bg-omega-panel max-w-lg w-full mx-4 p-6"
        onClick={(e) => { e.stopPropagation(); }}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-omega-title text-sm uppercase tracking-wider">Mission Objectives</h2>
          <button
            onClick={onClose}
            className="text-omega-dim hover:text-omega-text text-sm"
          >
            [ESC] Close
          </button>
        </div>

        <h3 className="text-omega-text font-bold mb-4">{title}</h3>

        {isComplete && (
          <div className="mb-4 px-3 py-2 border border-green-700 bg-green-900/20 text-green-400 text-xs uppercase tracking-wider">
            All objectives complete — find the escape route
          </div>
        )}

        <div className="space-y-2">
          {steps.map((step, i) => {
            const isCurrent = i === currentStepIndex && !isComplete;
            const isDone = step.completed;

            return (
              <div
                key={i}
                className={`flex items-start gap-3 px-3 py-2 text-sm ${
                  isCurrent ? 'border-l-2 border-omega-title bg-omega-title/5' : ''
                }`}
              >
                <span className={`mt-0.5 ${isDone ? 'text-green-400' : 'text-omega-dim'}`}>
                  {isDone ? '✓' : isCurrent ? '►' : '○'}
                </span>
                <span className={isDone ? 'text-omega-dim line-through' : (isCurrent ? 'text-omega-text' : 'text-omega-dim')}>
                  {step.description}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
