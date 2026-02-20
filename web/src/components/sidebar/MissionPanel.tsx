interface ObjectiveStep {
  description: string;
  completed: boolean;
}

interface MissionPanelProps {
  title: string;
  currentStep: number;
  totalSteps: number;
  currentDescription: string;
  steps: ObjectiveStep[];
  isComplete: boolean;
}

export function MissionPanel({ title, currentStep, totalSteps, currentDescription, steps, isComplete }: MissionPanelProps) {
  return (
    <div className="border border-omega-border p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-omega-dim text-xs uppercase tracking-wider">Mission</span>
        <span className="text-omega-dim text-xs">
          {currentStep}/{totalSteps}
        </span>
      </div>

      <h3 className="text-omega-title text-xs mb-2 truncate">{title}</h3>

      {isComplete ? (
        <p className="text-grade-a text-xs">All objectives complete!</p>
      ) : (
        <p className="text-omega-text text-xs mb-2">{currentDescription}</p>
      )}

      {/* Step checklist */}
      <div className="space-y-0.5 mt-2">
        {steps.map((step, i) => (
          <div key={i} className="flex items-start gap-1.5 text-xs">
            <span className={step.completed ? 'text-grade-a' : 'text-omega-dim'}>
              {step.completed ? '✓' : '○'}
            </span>
            <span className={step.completed ? 'text-omega-dim line-through' : 'text-omega-text'}>
              {step.description}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
