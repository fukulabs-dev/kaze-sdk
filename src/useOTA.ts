import { useState, useEffect, useCallback, useRef } from 'react';
import type { ReleaseManifest, CheckUpdateRequest, CheckUpdateResponse } from './types';

export interface UseOTAOptions {
  serverUrl: string;
  appId: string;
  platform: 'android' | 'ios';
  runtimeVersion: string;
  channel?: string;
  currentHash?: string;
  autoCheck?: boolean;
}

export interface OTAState {
  isChecking: boolean;
  isDownloading: boolean;
  progress: number;
  updateAvailable: boolean;
  manifest: ReleaseManifest | null;
  error: Error | null;
}

export interface OTAController {
  getState: () => OTAState;
  subscribe: (listener: (state: OTAState) => void) => () => void;
  check: () => Promise<ReleaseManifest | null>;
}

export function createOTAController(
  options: UseOTAOptions,
  fetchFn: typeof fetch = fetch
): OTAController {
  let state: OTAState = {
    isChecking: false,
    isDownloading: false,
    progress: 0,
    updateAvailable: false,
    manifest: null,
    error: null,
  };

  const listeners = new Set<(state: OTAState) => void>();

  const updateState = (partial: Partial<OTAState>) => {
    state = { ...state, ...partial };
    for (const listener of listeners) {
      listener(state);
    }
  };

  const check = async (): Promise<ReleaseManifest | null> => {
    updateState({ isChecking: true, error: null });
    try {
      const params = new URLSearchParams({
        appId: options.appId,
        platform: options.platform,
        runtimeVersion: options.runtimeVersion,
        channel: options.channel || 'production',
      });
      if (options.currentHash) {
        params.set('currentHash', options.currentHash);
      }

      const res = await fetchFn(`${options.serverUrl}/api/v1/updates/check?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`Server returned HTTP ${res.status}`);
      }

      const data = (await res.json()) as CheckUpdateResponse;
      if (data.updateAvailable && data.manifest) {
        updateState({
          isChecking: false,
          updateAvailable: true,
          manifest: data.manifest,
        });
        return data.manifest;
      }

      updateState({
        isChecking: false,
        updateAvailable: false,
        manifest: null,
      });
      return null;
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error(String(err));
      updateState({
        isChecking: false,
        updateAvailable: false,
        error: errorObj,
      });
      return null;
    }
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    check,
  };
}

export function useOTA(options: UseOTAOptions) {
  const controllerRef = useRef<OTAController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createOTAController(options);
  }

  const [state, setState] = useState<OTAState>(() => controllerRef.current!.getState());

  useEffect(() => {
    const unsubscribe = controllerRef.current!.subscribe(setState);
    if (options.autoCheck !== false) {
      void controllerRef.current!.check();
    }
    return unsubscribe;
  }, [options.autoCheck]);

  const check = useCallback(async () => {
    return await controllerRef.current!.check();
  }, []);

  return {
    ...state,
    check,
  };
}
