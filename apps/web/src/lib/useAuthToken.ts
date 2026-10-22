import { useSyncExternalStore } from 'react';
import { getToken, subscribeToken } from './authToken';

export const useAuthToken = (): string | null => useSyncExternalStore(subscribeToken, getToken, () => null);
