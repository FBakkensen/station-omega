interface ObjectiveVideoModalProps {
  stepDescription: string;
  videoUrl?: string;
  onClose: () => void;
  muted?: boolean;
}

export function ObjectiveVideoModal({ stepDescription, videoUrl, onClose, muted }: ObjectiveVideoModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <div
        className="border border-omega-border bg-omega-panel max-w-2xl w-full mx-4 p-6"
        onClick={(e) => { e.stopPropagation(); }}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-omega-title text-sm uppercase tracking-wider">Objective Complete</h2>
          <button
            onClick={onClose}
            className="text-omega-dim hover:text-omega-text text-sm"
          >
            [ESC] Close
          </button>
        </div>

        {videoUrl ? (
          <div className="relative mb-4 overflow-hidden">
            <video
              src={videoUrl}
              controls
              playsInline
              autoPlay
              muted={muted}
              className="w-full max-h-72 object-contain bg-black"
            />
            {/* Scanline overlay */}
            <div
              className="absolute inset-0 pointer-events-none opacity-10"
              style={{
                backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.4) 2px, rgba(0,0,0,0.4) 4px)',
              }}
            />
          </div>
        ) : (
          <div className="mb-4 flex items-center justify-center h-48 bg-black/50 border border-omega-border">
            <div className="text-omega-dim text-sm animate-pulse">
              Generating completion cinematic...
            </div>
          </div>
        )}

        <div className="px-3 py-2 border border-green-700 bg-green-900/20 text-green-400 text-xs uppercase tracking-wider">
          {stepDescription}
        </div>
      </div>
    </div>
  );
}
