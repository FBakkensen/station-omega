import { request as httpRequest } from 'node:http';

type NoNetworkGlobal = typeof globalThis & {
  __stationOmegaNoNetworkInstalled?: boolean;
};

if (!(globalThis as NoNetworkGlobal).__stationOmegaNoNetworkInstalled) {
  throw new Error('No-network guard was not installed during module evaluation.');
}

let blocked = false;
try {
  httpRequest('http://example.com');
} catch (error) {
  if (error instanceof Error && error.message.includes('Blocked via http.request')) {
    blocked = true;
  } else {
    throw error;
  }
}

if (!blocked) {
  throw new Error('Import-time http.request side effect was not blocked.');
}

export const importTimeHttpSideEffectChecked = true;
