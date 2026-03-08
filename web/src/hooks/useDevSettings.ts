import { useMemo } from 'react';

const DEFAULT_FAST_CHARS_PER_SEC = 400;
const MIN_FAST_CHARS_PER_SEC = 40;
const MAX_FAST_CHARS_PER_SEC = 5000;

function parseBooleanParam(raw: string | null): boolean | null {
  if (raw === null) return null;
  const normalized = raw.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'yes') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'no') {
    return false;
  }
  return null;
}

function parseRate(raw: string | null): number | null {
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.floor(parsed);
  if (rounded <= 0) return null;
  return Math.max(MIN_FAST_CHARS_PER_SEC, Math.min(MAX_FAST_CHARS_PER_SEC, rounded));
}

export interface DevSettings {
  enabled: boolean;
  forceMute: boolean;
  typewriterCharsPerSec: number;
}

export function useDevSettings(): DevSettings {
  return useMemo(() => {
    const search = typeof window !== 'undefined' ? window.location.search : '';
    const params = new URLSearchParams(search);

    const explicitToggle = parseBooleanParam(params.get('devfast'))
      ?? parseBooleanParam(params.get('fastmode'));
    const enabled = explicitToggle ?? import.meta.env.DEV;
    const explicitRate = parseRate(params.get('devfastRate'))
      ?? parseRate(params.get('fastmodeRate'));

    return {
      enabled,
      forceMute: enabled,
      typewriterCharsPerSec: enabled
        ? (explicitRate ?? DEFAULT_FAST_CHARS_PER_SEC)
        : 20,
    };
  }, []);
}
