import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';
import { server } from '@/mocks/server';
import { setToken } from '@/lib/authToken';
import { resetState } from '@/mocks/store';
import { markIntroSeen } from '@/lib/intro';

expect.extend(matchers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
// Tests start signed in; auth tests call setToken(null) themselves.
beforeEach(() => { setToken('test-token'); markIntroSeen(); });
afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetState();
});
afterAll(() => server.close());

// jsdom lacks these; components use them defensively.
if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  });
}
