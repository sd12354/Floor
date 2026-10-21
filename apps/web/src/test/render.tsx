import { render } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { App } from '@/App';

/** Full app on a memory router at `path`, with retries off so failures surface immediately. */
export function renderApp(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 }, mutations: { retry: false } } });
  return render(<App initialPath={path} queryClient={qc} />);
}
