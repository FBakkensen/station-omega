import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';

interface StationPickerScreenProps {
  onGenerate: () => void;
  onSelectStation: (stationId: string) => void;
  onBack: () => void;
}

type StationListRow = {
  _id: string;
  stationName: string;
  briefing: string;
  difficulty: 'normal' | 'hard' | 'nightmare';
};

type PendingDeleteState = {
  stationId: string;
  stationName: string;
};

export function StationPickerScreen({ onGenerate, onSelectStation, onBack }: StationPickerScreenProps) {
  const stations = useQuery(api.stations.list) as StationListRow[] | undefined;
  const removeStation = useMutation(api.stations.remove);
  const [pendingDelete, setPendingDelete] = useState<PendingDeleteState | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleConfirmDelete() {
    if (!pendingDelete || isDeleting) return;

    setIsDeleting(true);
    setDeleteError(null);

    try {
      await removeStation({ id: pendingDelete.stationId as Id<'stations'> });
      setPendingDelete(null);
    } catch {
      setDeleteError('Unable to delete station. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  }

  function handleOpenDelete(station: StationListRow) {
    setDeleteError(null);
    setPendingDelete({
      stationId: station._id,
      stationName: station.stationName,
    });
  }

  function handleCloseDelete() {
    if (isDeleting) return;
    setDeleteError(null);
    setPendingDelete(null);
  }

  return (
    <>
      <div className="flex flex-col h-full">
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

        <div className="flex-1 flex flex-col items-center gap-8 p-6 overflow-y-auto">
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
                  <div
                    key={station._id}
                    className="group flex items-stretch gap-2 border border-omega-border transition-colors hover:border-omega-dim focus-within:border-omega-dim hover:bg-omega-panel focus-within:bg-omega-panel"
                  >
                    <button
                      onClick={() => { onSelectStation(station._id); }}
                      className="min-w-0 flex-1 p-4 text-left outline-none"
                    >
                      <div className="flex items-center justify-between mb-1 gap-4">
                        <span className="text-omega-text text-sm">{station.stationName}</span>
                        <span
                          className={`text-xs ${
                            station.difficulty === 'nightmare' ? 'text-hp-low' :
                            station.difficulty === 'hard' ? 'text-hp-mid' :
                            'text-hp-good'
                          }`}
                        >
                          {station.difficulty}
                        </span>
                      </div>
                      <p className="text-omega-dim text-xs truncate">{station.briefing}</p>
                    </button>

                    <button
                      type="button"
                      aria-label={`Delete ${station.stationName}`}
                      onClick={() => { handleOpenDelete(station); }}
                      className="flex items-center justify-center px-4 text-omega-dim transition-all hover:text-red-300 focus:text-red-300 focus:outline-none opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                    >
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M3 6h18" />
                        <path d="M8 6V4h8v2" />
                        <path d="M6 6l1 14h10l1-14" />
                        <path d="M10 10v6" />
                        <path d="M14 10v6" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {pendingDelete ? (
        <StationDeleteModal
          stationName={pendingDelete.stationName}
          isDeleting={isDeleting}
          error={deleteError}
          onCancel={handleCloseDelete}
          onConfirm={() => { void handleConfirmDelete(); }}
        />
      ) : null}
    </>
  );
}

interface StationDeleteModalProps {
  stationName: string;
  isDeleting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

function StationDeleteModal({
  stationName,
  isDeleting,
  error,
  onCancel,
  onConfirm,
}: StationDeleteModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Delete Station"
        className="border border-red-700/70 bg-omega-panel max-w-lg w-full mx-4 p-6"
        onClick={(event) => { event.stopPropagation(); }}
      >
        <div className="flex justify-between items-center mb-4 gap-4">
          <h2 className="text-red-300 text-sm uppercase tracking-wider">Delete Station</h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            className="text-omega-dim hover:text-omega-text text-sm disabled:opacity-50"
          >
            Cancel
          </button>
        </div>

        <p className="text-omega-text text-sm mb-3">
          Delete <span className="text-red-300">{stationName}</span>?
        </p>
        <p className="text-omega-dim text-sm mb-4">
          This removes the station and all linked run history, messages, segments, and saved progress.
        </p>

        {error ? (
          <p className="mb-4 text-xs text-red-300">{error}</p>
        ) : null}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            className="px-4 py-2 text-xs text-omega-dim hover:text-omega-text transition-colors disabled:opacity-50"
          >
            Keep Station
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="px-4 py-2 text-xs bg-red-900/50 border border-red-700 text-red-300 hover:bg-red-900/70 transition-colors disabled:opacity-50"
          >
            Delete Station
          </button>
        </div>
      </div>
    </div>
  );
}
