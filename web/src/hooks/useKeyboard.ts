import { useEffect } from 'react';

interface KeyboardShortcuts {
  onF1?: () => void;
  onF2?: () => void;
  onEscape?: () => void;
}

/**
 * Global keyboard shortcuts for the game.
 * F1 = Map modal, F2 = Mission modal, Escape = close modals.
 */
export function useKeyboard({ onF1, onF2, onEscape }: KeyboardShortcuts): void {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't intercept if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === 'Escape') {
          onEscape?.();
          return;
        }
        return;
      }

      switch (e.key) {
        case 'F1':
          e.preventDefault();
          onF1?.();
          break;
        case 'F2':
          e.preventDefault();
          onF2?.();
          break;
        case 'Escape':
          onEscape?.();
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => { window.removeEventListener('keydown', handleKeyDown); };
  }, [onF1, onF2, onEscape]);
}
