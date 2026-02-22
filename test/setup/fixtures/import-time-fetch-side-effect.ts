type NoNetworkGlobal = typeof globalThis & {
  __stationOmegaNoNetworkInstalled?: boolean;
};

if (!(globalThis as NoNetworkGlobal).__stationOmegaNoNetworkInstalled) {
  throw new Error('No-network guard was not installed during module evaluation.');
}

const fetchError = await fetch('data:text/plain,station-omega')
  .then(() => null)
  .catch((error: unknown) => error);

if (!(fetchError instanceof Error) || !fetchError.message.includes('Blocked via fetch')) {
  throw new Error('Import-time fetch side effect was not blocked.');
}

export const importTimeFetchSideEffectChecked = true;
