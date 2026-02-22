import '@testing-library/jest-dom/vitest';
import { afterAll } from 'vitest';

const networkError = (api: string): Error =>
  new Error(
    `Deterministic web tests forbid outbound network calls. Blocked via ${api}. ` +
      'Mock the dependency instead of making live requests.',
  );

type FetchFn = typeof globalThis.fetch;

const originalFetch: FetchFn = globalThis.fetch;

const xhrPrototype =
  typeof globalThis.XMLHttpRequest === 'function' ? globalThis.XMLHttpRequest.prototype : null;
let originalXHROpenDescriptor: PropertyDescriptor | undefined;
let originalXHRSendDescriptor: PropertyDescriptor | undefined;
let xhrPatched = false;

globalThis.fetch = (() => Promise.reject(networkError('fetch'))) as FetchFn;

if (xhrPrototype) {
  originalXHROpenDescriptor = Object.getOwnPropertyDescriptor(xhrPrototype, 'open');
  originalXHRSendDescriptor = Object.getOwnPropertyDescriptor(xhrPrototype, 'send');

  Object.defineProperty(xhrPrototype, 'open', {
    configurable: true,
    writable: true,
    value: () => {
      throw networkError('XMLHttpRequest.open');
    },
  });

  Object.defineProperty(xhrPrototype, 'send', {
    configurable: true,
    writable: true,
    value: () => {
      throw networkError('XMLHttpRequest.send');
    },
  });

  xhrPatched = true;
}

afterAll(() => {
  globalThis.fetch = originalFetch;
  if (xhrPatched && xhrPrototype && originalXHROpenDescriptor) {
    Object.defineProperty(xhrPrototype, 'open', originalXHROpenDescriptor);
  }
  if (xhrPatched && xhrPrototype && originalXHRSendDescriptor) {
    Object.defineProperty(xhrPrototype, 'send', originalXHRSendDescriptor);
  }
});
