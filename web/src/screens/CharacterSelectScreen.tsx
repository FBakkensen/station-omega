import { useState } from 'react';
import type { CharacterClassId, Difficulty } from '../hooks/useGameSetup';

interface CharacterSelectScreenProps {
  selectedClass: CharacterClassId | null;
  selectedDifficulty: Difficulty;
  onSelectClass: (classId: CharacterClassId) => void;
  onSelectDifficulty: (difficulty: Difficulty) => void;
  onConfirm: () => void;
  onBack: () => void;
}

interface CharacterBuild {
  id: CharacterClassId;
  name: string;
  description: string;
  baseHp: number;
  proficiencies: string[];
  weaknesses: string[];
  startingItem: string | null;
  maxInventory: number;
}

const CHARACTER_BUILDS: CharacterBuild[] = [
  {
    id: 'engineer',
    name: 'Systems Engineer',
    description: 'A resourceful technician who can bypass failing systems with duct tape, wire, and sheer stubbornness.',
    baseHp: 100,
    proficiencies: ['tech', 'survival'],
    weaknesses: ['medical', 'command'],
    startingItem: 'Multitool',
    maxInventory: 6,
  },
  {
    id: 'scientist',
    name: 'Research Scientist',
    description: 'An analytical mind who synthesizes solutions from first principles. Needs fewer materials to craft.',
    baseHp: 85,
    proficiencies: ['science', 'tech'],
    weaknesses: ['survival', 'command'],
    startingItem: 'Diagnostic Scanner',
    maxInventory: 5,
  },
  {
    id: 'medic',
    name: 'Flight Surgeon',
    description: 'A trauma specialist who keeps one body functioning through creative medicine and an alarming willingness to improvise.',
    baseHp: 110,
    proficiencies: ['medical', 'science'],
    weaknesses: ['tech', 'command'],
    startingItem: 'First Aid Kit',
    maxInventory: 5,
  },
  {
    id: 'commander',
    name: 'Operations Lead',
    description: 'A crisis coordinator who sees the whole failure graph. Can assess cascade timers in adjacent rooms and stay decisive under pressure.',
    baseHp: 100,
    proficiencies: ['survival', 'command'],
    weaknesses: ['science', 'tech'],
    startingItem: null,
    maxInventory: 5,
  },
];

const DIFFICULTIES: { id: Difficulty; label: string; color: string }[] = [
  { id: 'normal', label: 'Normal', color: 'text-hp-good' },
  { id: 'hard', label: 'Hard', color: 'text-hp-mid' },
  { id: 'nightmare', label: 'Nightmare', color: 'text-hp-low' },
];

const CLASS_ICONS: Record<CharacterClassId, string> = {
  engineer: '🔧',
  scientist: '🔬',
  medic: '⚕️',
  commander: '⭐',
};

export function CharacterSelectScreen({
  selectedClass,
  selectedDifficulty,
  onSelectClass,
  onSelectDifficulty,
  onConfirm,
  onBack,
}: CharacterSelectScreenProps) {
  const [hoveredClass, setHoveredClass] = useState<CharacterClassId | null>(null);
  const displayedBuild = CHARACTER_BUILDS.find(
    b => b.id === (hoveredClass ?? selectedClass)
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-omega-border">
        <button
          onClick={onBack}
          className="text-omega-dim hover:text-omega-text transition-colors text-sm"
        >
          ← Back
        </button>
        <h1 className="text-omega-title text-lg tracking-wider uppercase">Select Specialist Profile</h1>
        <div className="w-16" /> {/* Spacer for centering */}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col lg:flex-row gap-6 p-6 overflow-auto">
        {/* Character Cards */}
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {CHARACTER_BUILDS.map(build => {
            const isSelected = selectedClass === build.id;
            return (
              <button
                key={build.id}
                onClick={() => { onSelectClass(build.id); }}
                onMouseEnter={() => { setHoveredClass(build.id); }}
                onMouseLeave={() => { setHoveredClass(null); }}
                className={`
                  text-left p-5 border transition-all duration-200
                  ${isSelected
                    ? 'border-omega-title bg-omega-title/5'
                    : 'border-omega-border bg-omega-panel hover:border-omega-dim'
                  }
                `}
              >
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-2xl">{CLASS_ICONS[build.id]}</span>
                  <div>
                    <h3 className={`text-sm font-bold ${isSelected ? 'text-omega-title' : 'text-omega-text'}`}>
                      {build.name}
                    </h3>
                    <span className="text-xs text-omega-dim">HP: {build.baseHp}</span>
                  </div>
                </div>
                <p className="text-xs text-omega-dim leading-relaxed">{build.description}</p>
              </button>
            );
          })}
        </div>

        {/* Details Panel */}
        <div className="w-full lg:w-80 border border-omega-border bg-omega-panel p-5 flex flex-col gap-4">
          {displayedBuild ? (
            <>
              <h2 className="text-omega-title text-sm tracking-wider uppercase border-b border-omega-border pb-2">
                {displayedBuild.name}
              </h2>

              <div>
                <h3 className="text-xs text-omega-dim uppercase mb-1">Proficiencies</h3>
                <div className="flex gap-2">
                  {displayedBuild.proficiencies.map(p => (
                    <span key={p} className="text-xs px-2 py-0.5 bg-hp-good/10 text-hp-good border border-hp-good/30">
                      {p}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-xs text-omega-dim uppercase mb-1">Weaknesses</h3>
                <div className="flex gap-2">
                  {displayedBuild.weaknesses.map(w => (
                    <span key={w} className="text-xs px-2 py-0.5 bg-hp-low/10 text-hp-low border border-hp-low/30">
                      {w}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-xs text-omega-dim uppercase mb-1">Starting Item</h3>
                <span className="text-xs text-omega-text">
                  {displayedBuild.startingItem ?? 'None (extra leadership skills)'}
                </span>
              </div>

              <div>
                <h3 className="text-xs text-omega-dim uppercase mb-1">Inventory Slots</h3>
                <span className="text-xs text-omega-text">{displayedBuild.maxInventory}</span>
              </div>
            </>
          ) : (
            <p className="text-omega-dim text-sm text-center py-8">
              Select a specialist profile to view details
            </p>
          )}

          {/* Difficulty Selector */}
          <div className="mt-auto pt-4 border-t border-omega-border">
            <h3 className="text-xs text-omega-dim uppercase mb-2">Difficulty</h3>
            <div className="flex gap-2">
              {DIFFICULTIES.map(d => (
                <button
                  key={d.id}
                  onClick={() => { onSelectDifficulty(d.id); }}
                  className={`
                    flex-1 text-xs py-1.5 border transition-colors
                    ${selectedDifficulty === d.id
                      ? `${d.color} border-current bg-current/10`
                      : 'text-omega-dim border-omega-border hover:border-omega-dim'
                    }
                  `}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {/* Confirm Button */}
          <button
            onClick={onConfirm}
            disabled={!selectedClass}
            className={`
              w-full py-3 text-sm tracking-wider uppercase transition-colors
              ${selectedClass
                ? 'border border-omega-title text-omega-title hover:bg-omega-title/10'
                : 'border border-omega-border text-omega-dim cursor-not-allowed'
              }
            `}
          >
            {selectedClass ? 'Continue →' : 'Select a Class'}
          </button>
        </div>
      </div>
    </div>
  );
}
