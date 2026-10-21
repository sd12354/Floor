import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';
import { resetState } from './store';

// `?fresh` on the URL starts the demo as a brand-new account so onboarding can be exercised.
if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('fresh')) {
  resetState({ fresh: true });
}

export const worker = setupWorker(...handlers);
