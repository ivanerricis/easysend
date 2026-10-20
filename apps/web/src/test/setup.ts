import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import i18n from '@/i18n';
import { configureApiClient, setCsrfToken } from '@/lib/api/client';

// Lazy routes plus mocked fetches can exceed the 1 s default when the whole suite runs in parallel.
configure({ asyncUtilTimeout: 5000 });

// jsdom gaps that Radix UI components rely on.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub;
const elementProto = Element.prototype as unknown as Record<string, unknown>;
elementProto['scrollIntoView'] ??= () => undefined;
elementProto['hasPointerCapture'] ??= () => false;
elementProto['setPointerCapture'] ??= () => undefined;
elementProto['releasePointerCapture'] ??= () => undefined;

beforeEach(async () => {
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
  document.documentElement.removeAttribute('style');
  setCsrfToken(null);
  await i18n.changeLanguage('en');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  configureApiClient({});
});
