import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';

interface StationPickerScreenProps {
  onGenerate: () => void;
  onSelectStation: (stationId: string) => void;
  onBack: () => void;
}

export function StationPickerScreen({ onGenerate, onSelectStation, onBack }: StationPickerScreenProps) {
  const stations = useQuery(api.stations.list);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-omega-border">
        <button
          onClick={onBack}
          className="text-omega-dim hover:text-omega-text transition-colors text-sm"
        >
          &larr; Back
        </button>
        <h1 className="text-omega-title text-lg tracking-wider uppercase">Select Station</h1>
        <div className="w-16" />
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center gap-8 p-6 overflow-y-auto">
        {/* Generate New */}
        <button
          onClick={onGenerate}
          className="w-full max-w-md p-6 border border-omega-title text-left
                     hover:bg-omega-title/5 transition-colors"
        >
          <h3 className="text-omega-title text-sm tracking-wider uppercase mb-2">
            Generate New Station
          </h3>
          <p className="text-omega-dim text-xs">
            Create a unique procedurally-generated station with AI-crafted rooms, NPCs, and objectives.
          </p>
        </button>

        {/* Saved Stations */}
        <div className="w-full max-w-md">
          <h3 className="text-omega-dim text-sm tracking-wider uppercase mb-3">
            Saved Stations
          </h3>

          {stations === undefined ? (
            <p className="text-omega-dim/50 text-xs text-center py-4">Loading...</p>
          ) : stations.length === 0 ? (
            <p className="text-omega-dim/50 text-xs text-center py-4">
              No saved stations yet. Generate one above.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {stations.map((station) => (
                <button
                  key={station._id}
                  onClick={() => { onSelectStation(station._id); }}
                  className="p-4 border border-omega-border text-left
                             hover:border-omega-dim hover:bg-omega-panel transition-colors"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-omega-text text-sm">{station.stationName}</span>
                    <span className={`text-xs ${
                      station.difficulty === 'nightmare' ? 'text-hp-low' :
                      station.difficulty === 'hard' ? 'text-hp-mid' :
                      'text-hp-good'
                    }`}>
                      {station.difficulty}
                    </span>
                  </div>
                  <p className="text-omega-dim text-xs truncate">{station.briefing}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
