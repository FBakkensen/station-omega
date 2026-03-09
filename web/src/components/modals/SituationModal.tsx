import type { GameStatusData } from '../sidebar/Sidebar';
import { formatCost } from '../../utils/format';
import type { CostSummary } from '../../utils/format';

interface SituationModalProps {
  status: GameStatusData | null;
  costSummary?: CostSummary | null;
  onClose: () => void;
}

export function SituationModal({ status, costSummary, onClose }: SituationModalProps) {

  if (!status) {
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
            <h2 className="text-omega-title text-sm uppercase tracking-wider">Situation Report</h2>
            <button
              onClick={onClose}
              className="text-omega-dim hover:text-omega-text text-sm"
            >
              [ESC] Close
            </button>
          </div>
          <p className="text-omega-dim text-sm">Loading status...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <div
        className="border border-omega-border bg-omega-panel max-w-lg w-full mx-4 p-6 max-h-[80vh] overflow-y-auto"
        onClick={(e) => { e.stopPropagation(); }}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-omega-title text-sm uppercase tracking-wider">Situation Report</h2>
          <button
            onClick={onClose}
            className="text-omega-dim hover:text-omega-text text-sm"
          >
            [ESC] Close
          </button>
        </div>

        <div className="space-y-4">
          {/* Location Section */}
          <div className="border-b border-omega-border pb-3">
            <div className="flex items-center justify-between">
              <span className="text-omega-dim text-xs uppercase tracking-wider">Location</span>
              <span className="text-omega-text text-sm">
                {status.roomName} ({status.roomIndex}/{status.totalRooms})
              </span>
            </div>
          </div>

          {/* Systems Section */}
          <div className="border-b border-omega-border pb-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-omega-dim text-xs uppercase tracking-wider">Systems</span>
              <span className="text-sm">
                {status.systemFailures.length === 0 ? (
                  <span className="text-green-400">All nominal</span>
                ) : (
                  <span className="text-red-400">{status.systemFailures.length} failing</span>
                )}
              </span>
            </div>
            {status.systemFailures.length > 0 && (
              <div className="space-y-1">
                {status.systemFailures.map((system) => (
                  <div key={system.systemId} className="flex items-center justify-between text-sm">
                    <span className="text-omega-text">{system.systemId}</span>
                    <span className="text-omega-dim">
                      {system.minutesUntilCascade > 0 ? `${String(system.minutesUntilCascade)} min` : 'Cascade'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Current Objective Section */}
          <div className="border-b border-omega-border pb-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-omega-dim text-xs uppercase tracking-wider">Current Objective</span>
              <span className="text-omega-text text-sm">
                {String(status.objectiveStep)}/{String(status.objectiveTotal)}
              </span>
            </div>
            <p className="text-omega-text text-sm">
              {status.objectivesComplete
                ? 'All objectives complete — find the escape route'
                : status.objectiveCurrentDesc || 'No active objective'}
            </p>
          </div>

          {/* Inventory Section */}
          <div className="border-b border-omega-border pb-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-omega-dim text-xs uppercase tracking-wider">Inventory</span>
              <span className="text-omega-text text-sm">
                {String(status.inventory.length)}/{String(status.maxInventory)}
              </span>
            </div>
            {status.inventory.length === 0 ? (
              <p className="text-omega-dim text-sm">Empty</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {status.inventory.map((item, i) => (
                  <span
                    key={i}
                    className={`text-sm px-2 py-1 border ${
                      status.inventoryKeyFlags[i] ? 'border-omega-title text-omega-title' : 'border-omega-border text-omega-text'
                    }`}
                  >
                    {status.inventoryKeyFlags[i] ? '🔑 ' : '• '}{item}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Hazards Section */}
          <div className="border-b border-omega-border pb-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-omega-dim text-xs uppercase tracking-wider">Hazards</span>
              <span className="text-omega-text text-sm">
                {status.activeEvents.length === 0 ? 'None active' : `${String(status.activeEvents.length)} active`}
              </span>
            </div>
            {status.activeEvents.length > 0 && (
              <div className="space-y-1">
                {status.activeEvents.map((event, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-red-400">{event.type}</span>
                    <span className="text-omega-dim">
                      {event.minutesRemaining > 0 ? `${String(event.minutesRemaining)} min` : 'Active'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* AI Usage Section */}
          {costSummary?.totalCostUsd != null && (() => {
            const combinedCost = costSummary.stationCostUsd + costSummary.totalCostUsd;
            return (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-omega-dim text-xs uppercase tracking-wider">AI Usage</span>
                <span className="text-omega-title text-sm">{formatCost(combinedCost)}</span>
              </div>
              <div className="border-l-2 border-omega-border pl-3 space-y-1">
                {/* Station (shared) costs */}
                {(costSummary.generation.count > 0 || costSummary.video.count > 0) && (
                  <div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-omega-dim text-xs uppercase tracking-wider">Station (shared)</span>
                      <span className="text-omega-text text-sm">{formatCost(costSummary.stationCostUsd)}</span>
                    </div>
                    <div className="pl-3 space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-omega-dim">Generation ({String(costSummary.generation.count)} layers)</span>
                        <span className="text-omega-text">{formatCost(costSummary.generation.costUsd)}</span>
                      </div>
                      {costSummary.video.count > 0 && (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-omega-dim">Video ({String(costSummary.video.count)})</span>
                          <span className="text-omega-text">{formatCost(costSummary.video.costUsd)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {/* This Game costs */}
                <div className="mt-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-omega-dim text-xs uppercase tracking-wider">This Game</span>
                    <span className="text-omega-text text-sm">{formatCost(costSummary.totalCostUsd)}</span>
                  </div>
                  <div className="pl-3 space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-omega-dim">Turns ({String(costSummary.turns.count)})</span>
                      <span className="text-omega-text">{formatCost(costSummary.turns.costUsd)}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-omega-dim">
                        Images ({String(costSummary.images.count)} gen
                        {costSummary.images.cacheHits > 0
                          ? ` + ${String(costSummary.images.cacheHits)} cached`
                          : ''})
                      </span>
                      <span className="text-omega-text">{formatCost(costSummary.images.costUsd)}</span>
                    </div>
                    {costSummary.tts.count > 0 && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-omega-dim">TTS ({String(costSummary.tts.count)} calls)</span>
                        <span className="text-omega-text">{formatCost(costSummary.tts.costUsd)}</span>
                      </div>
                    )}
                  </div>
                </div>
                {/* Combined total */}
                <div className="flex items-center justify-between text-sm border-t border-omega-border pt-1 mt-1">
                  <span className="text-omega-dim">Combined Total</span>
                  <span className="text-omega-title">{formatCost(combinedCost)}</span>
                </div>
              </div>
            </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
