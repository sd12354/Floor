import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';
import 'vitest';

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type -- augmenting vitest's Assertion with jest-dom matchers requires an empty extending interface
  interface Assertion<T = any> extends TestingLibraryMatchers<T, void> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- same
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<unknown, void> {}
}
