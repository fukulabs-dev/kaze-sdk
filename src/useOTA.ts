import { useState, useEffect, useCallback, useRef } from 'react';
import type { ReleaseManifest } from './types';
import { checkUpdate, downloadBundle, verifyBundleChecksum, reportUpdateStatus } from './updater';
import {
  stageBundle,
  unzipBundle,
  MemoryFileSystemAdapter,
  getDefaultFileSystemAdapter,
  type FileSystemAdapter,
} from './staging';
import { getNativeRunningBundleInfo, restartApp } from './native';

function resolvePlatform(platform?: 'android' | 'ios'): 'android' | 'ios' {
  if (platform) return platform;
  try {
    const rn = require('react-native');
    if (rn && typeof rn === 'object' && 'Platform' in rn) {
      const p = rn.Platform;
      if (p && typeof p === 'object' && 'OS' in p && (p.OS === 'android' || p.OS === 'ios')) {
        return p.OS;
      }
    }
  } catch {
    // Pure JS / non-React Native environment
  }
  return 'android';
}

export type OTAStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'error';

export interface UseOTAOptions {
  serverUrl: string;
  appId: string;
  platform?: 'android' | 'ios';
  runtimeVersion: string;
  channel?: string;
  /** Hash of the running bundle sent to the server. Defaults to the OTA bundle the native loader booted. */
  currentHash?: string;
  deviceId?: string;
  clientUuid?: string;
  autoCheck?: boolean;
  checkOnResume?: boolean;
  /**
   * What to do once an update is found. 'next-restart' (default) downloads and stages it for the
   * next cold launch, 'immediate' also restarts the app, 'manual' leaves it to downloadAndStage().
   */
  autoApply?: 'next-restart' | 'immediate' | 'manual';
  reportStatus?: boolean;
  fileSystem?: FileSystemAdapter;
  onUpdateAvailable?: (manifest: ReleaseManifest) => void;
  onDownloadProgress?: (progress: number) => void;
  onUpdateStaged?: (manifest: ReleaseManifest) => void;
  onError?: (error: Error) => void;
}

export interface OTAState {
  status: OTAStatus;
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
  checkForUpdate: () => Promise<ReleaseManifest | null>;
  downloadAndStage: (manifest?: ReleaseManifest) => Promise<boolean>;
  applyUpdate: () => Promise<void>;
}

export function createOTAController(
  options: UseOTAOptions,
  fetchFn: typeof fetch = fetch,
  fileSystemAdapter?: FileSystemAdapter
): OTAController {
  let state: OTAState = {
    status: 'idle',
    isChecking: false,
    isDownloading: false,
    progress: 0,
    updateAvailable: false,
    manifest: null,
    error: null,
  };

  const listeners = new Set<(state: OTAState) => void>();
  const fs = options.fileSystem || fileSystemAdapter || getDefaultFileSystemAdapter();
  const platform = resolvePlatform(options.platform);
  const runningHash = options.currentHash ?? getNativeRunningBundleInfo()?.hash ?? undefined;
  // Bundle staged by this controller and waiting for the next launch; not downloaded again.
  let stagedHash: string | null = null;
  let inFlight: { hash: string; promise: Promise<boolean> } | null = null;

  const updateState = (partial: Partial<OTAState>) => {
    state = { ...state, ...partial };
    for (const listener of listeners) {
      listener(state);
    }
  };

  const applyUpdate = async (): Promise<void> => {
    restartApp();
  };

  const downloadAndStage = async (targetManifest?: ReleaseManifest): Promise<boolean> => {
    const manifestToDownload = targetManifest || state.manifest;
    if (!manifestToDownload) {
      return false;
    }
    const targetHash = manifestToDownload.bundleHash.toLowerCase();
    if (targetHash === stagedHash) {
      return true;
    }
    // A second call for the same bundle (e.g. auto-download plus a manual call) joins the first.
    if (inFlight?.hash === targetHash) {
      return inFlight.promise;
    }
    const promise = runDownloadAndStage(manifestToDownload, targetHash).finally(() => {
      if (inFlight?.promise === promise) {
        inFlight = null;
      }
    });
    inFlight = { hash: targetHash, promise };
    return promise;
  };

  const runDownloadAndStage = async (manifestToDownload: ReleaseManifest, targetHash: string): Promise<boolean> => {

    updateState({
      status: 'downloading',
      isDownloading: true,
      progress: 0,
      error: null,
    });

    try {
      const resolvedUrl =
        manifestToDownload.bundleUrl.startsWith('http://') ||
        manifestToDownload.bundleUrl.startsWith('https://')
          ? manifestToDownload.bundleUrl
          : `${options.serverUrl.replace(/\/+$/, '')}/${manifestToDownload.bundleUrl.replace(/^\/+/, '')}`;

      const bundleBytes = await downloadBundle(
        resolvedUrl,
        (percent) => {
          updateState({ progress: percent });
          options.onDownloadProgress?.(percent);
        },
        fetchFn
      );

      const isValid = verifyBundleChecksum(bundleBytes, manifestToDownload.bundleHash);
      if (!isValid) {
        throw new Error(
          `Checksum mismatch: expected ${manifestToDownload.bundleHash}`
        );
      }

      const files = await unzipBundle(bundleBytes, platform);
      const stageResult = await stageBundle({
        platform,
        bundleHash: manifestToDownload.bundleHash,
        files,
        fileSystem: fs,
      });

      if (!stageResult.success) {
        throw new Error(stageResult.error || 'Failed to stage bundle');
      }
      stagedHash = targetHash;

      updateState({
        status: 'ready',
        isDownloading: false,
        progress: 100,
      });

      options.onUpdateStaged?.(manifestToDownload);

      if (options.reportStatus !== false) {
        reportUpdateStatus(
          options.serverUrl,
          {
            appId: options.appId,
            releaseId: manifestToDownload.id,
            status: 'staged',
            platform,
            runtimeVersion: options.runtimeVersion,
            bundleHash: manifestToDownload.bundleHash,
            deviceId: options.deviceId,
            clientUuid: options.clientUuid,
          },
          fetchFn
        ).catch(() => {});
      }

      if (options.autoApply === 'immediate') {
        await applyUpdate();
      }

      return true;
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error(String(err));
      updateState({
        status: 'error',
        isDownloading: false,
        error: errorObj,
      });
      options.onError?.(errorObj);
      if (options.reportStatus !== false && manifestToDownload) {
        reportUpdateStatus(
          options.serverUrl,
          {
            appId: options.appId,
            releaseId: manifestToDownload.id,
            status: 'failed',
            platform,
            runtimeVersion: options.runtimeVersion,
            bundleHash: manifestToDownload.bundleHash,
            reason: errorObj.message,
            error: errorObj.message,
            deviceId: options.deviceId,
            clientUuid: options.clientUuid,
          },
          fetchFn
        ).catch(() => {});
      }
      return false;
    }
  };

  const check = async (): Promise<ReleaseManifest | null> => {
    updateState({ status: 'checking', isChecking: true, error: null });
    try {
      const data = await checkUpdate(
        options.serverUrl,
        {
          appId: options.appId,
          platform,
          runtimeVersion: options.runtimeVersion,
          channel: options.channel || 'production',
          currentHash: runningHash,
          deviceId: options.deviceId,
          clientUuid: options.clientUuid,
        },
        fetchFn
      );

      const offeredHash = data.manifest?.bundleHash.toLowerCase();
      if (data.updateAvailable && data.manifest && offeredHash === stagedHash) {
        // Already downloaded; it activates on the next launch.
        updateState({
          status: 'ready',
          isChecking: false,
          updateAvailable: true,
          manifest: data.manifest,
        });
        return data.manifest;
      }

      if (data.updateAvailable && data.manifest && offeredHash !== runningHash?.toLowerCase()) {
        updateState({
          status: 'idle',
          isChecking: false,
          updateAvailable: true,
          manifest: data.manifest,
        });
        options.onUpdateAvailable?.(data.manifest);

        if ((options.autoApply ?? 'next-restart') !== 'manual') {
          void downloadAndStage(data.manifest);
        }

        return data.manifest;
      }

      updateState({
        status: 'idle',
        isChecking: false,
        updateAvailable: false,
        manifest: null,
      });
      return null;
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error(String(err));
      updateState({
        status: 'error',
        isChecking: false,
        updateAvailable: false,
        error: errorObj,
      });
      options.onError?.(errorObj);
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
    checkForUpdate: check,
    downloadAndStage,
    applyUpdate,
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

  useEffect(() => {
    if (!options.checkOnResume) return;
    try {
      const rn = require('react-native');
      if (rn && rn.AppState && typeof rn.AppState.addEventListener === 'function') {
        const sub = rn.AppState.addEventListener('change', (nextState: string) => {
          if (nextState === 'active') {
            void controllerRef.current?.check();
          }
        });
        return () => {
          sub?.remove?.();
        };
      }
    } catch {
      // Non-React Native environment
    }
  }, [options.checkOnResume]);

  const check = useCallback(async () => {
    return await controllerRef.current!.check();
  }, []);

  const downloadAndStage = useCallback(async (manifest?: ReleaseManifest) => {
    return await controllerRef.current!.downloadAndStage(manifest);
  }, []);

  const applyUpdate = useCallback(async () => {
    return await controllerRef.current!.applyUpdate();
  }, []);

  return {
    ...state,
    check,
    checkForUpdate: check,
    downloadAndStage,
    applyUpdate,
  };
}
