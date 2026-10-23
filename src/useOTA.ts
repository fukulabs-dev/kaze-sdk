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
import { getNativeRunningBundleInfo, isNativeBundleBlacklisted, restartApp } from './native';

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
  /** Timeout for update checks and status reports, in milliseconds. 0 disables it. Default 15000. */
  requestTimeoutMs?: number;
  /** Timeout for one bundle download attempt, in milliseconds. 0 disables it. Default 120000. */
  downloadTimeoutMs?: number;
  /** Extra download attempts after a network error, timeout, or 5xx/408/429 response. Default 2. */
  downloadRetries?: number;
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
  const requestOptions = { timeoutMs: options.requestTimeoutMs };

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
      if (await isNativeBundleBlacklisted(manifestToDownload.bundleHash)) {
        throw new Error(
          `Bundle ${manifestToDownload.bundleHash} was rolled back on this device and will not be installed again`
        );
      }

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
        fetchFn,
        { timeoutMs: options.downloadTimeoutMs, retries: options.downloadRetries }
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
        releaseId: manifestToDownload.id,
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
          fetchFn,
          requestOptions
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
          fetchFn,
          requestOptions
        ).catch(() => {});
      }
      return false;
    }
  };

  // Reports what happened on earlier launches that the server has not heard about yet: a bundle the
  // boot guard rolled back (the process dies right after blacklisting it, so this is the first
  // chance), and the running bundle once the guard has marked it stable. A marker file in the slot
  // keeps each report from being sent twice. Runs before the check so the rolled-back slot is
  // reported before a new download overwrites it.
  const reportOutcome = async (slot: string, hash: string, status: 'active' | 'rolled_back'): Promise<void> => {
    const marker = `ota/${slot}/${status}.reported`;
    if (await fs.exists(marker)) {
      return;
    }
    const releaseId = (await fs.readFile(`ota/${slot}/release.id`))?.trim();
    if (!releaseId) {
      return;
    }
    await reportUpdateStatus(
      options.serverUrl,
      {
        appId: options.appId,
        releaseId,
        status,
        platform,
        runtimeVersion: options.runtimeVersion,
        bundleHash: hash,
        reason: status === 'rolled_back' ? 'Crashed during startup and was rolled back' : undefined,
        deviceId: options.deviceId,
        clientUuid: options.clientUuid,
      },
      fetchFn,
      requestOptions
    );
    await fs.writeFile(marker, new Date().toISOString());
  };

  let reportingOutcomes: Promise<void> | null = null;
  const reportOutcomes = (): Promise<void> => {
    if (options.reportStatus === false) {
      return Promise.resolve();
    }
    reportingOutcomes ??= (async () => {
      const running = getNativeRunningBundleInfo();
      for (const slot of ['slot_a', 'slot_b']) {
        try {
          const hash = (await fs.readFile(`ota/${slot}/bundle.hash`))?.trim();
          if (!hash) continue;
          if (running?.hash === hash && running.slot === slot) {
            if (running.stable) {
              await reportOutcome(slot, hash, 'active');
            }
          } else if (await isNativeBundleBlacklisted(hash)) {
            await reportOutcome(slot, hash, 'rolled_back');
          }
        } catch {
          // Retried on the next check.
        }
      }
    })().finally(() => {
      reportingOutcomes = null;
    });
    return reportingOutcomes;
  };

  // A check can run while a download is in progress (e.g. checkOnResume); the status keeps showing
  // the download until it finishes, which then sets 'ready' or 'error' itself.
  const statusAfterCheck = (status: OTAStatus): OTAStatus => (state.isDownloading ? 'downloading' : status);

  const check = async (): Promise<ReleaseManifest | null> => {
    updateState({ status: statusAfterCheck('checking'), isChecking: true, error: null });
    await reportOutcomes().catch(() => {});
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
        fetchFn,
        requestOptions
      );

      const offeredHash = data.manifest?.bundleHash.toLowerCase();
      if (data.updateAvailable && data.manifest && offeredHash === stagedHash) {
        // Already downloaded; it activates on the next launch.
        updateState({
          status: statusAfterCheck('ready'),
          isChecking: false,
          updateAvailable: true,
          manifest: data.manifest,
        });
        return data.manifest;
      }

      // This device already rolled the bundle back and the native loader will never boot it again.
      const rolledBack =
        data.updateAvailable && data.manifest ? await isNativeBundleBlacklisted(data.manifest.bundleHash) : false;

      if (data.updateAvailable && data.manifest && offeredHash !== runningHash?.toLowerCase() && !rolledBack) {
        updateState({
          status: statusAfterCheck('idle'),
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
        status: statusAfterCheck('idle'),
        isChecking: false,
        updateAvailable: false,
        manifest: null,
      });
      return null;
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error(String(err));
      updateState({
        status: statusAfterCheck('error'),
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
