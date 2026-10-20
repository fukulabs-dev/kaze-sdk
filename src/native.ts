export interface RunningBundleInfo {
  /** Hash of the OTA bundle this process booted, or null when running the embedded bundle. */
  hash: string | null;
  /** Slot directory name (e.g. slot_a) of that bundle, or null for the embedded bundle. */
  slot?: string | null;
  /** Whether that bundle already survived a boot guard window on an earlier launch. */
  stable: boolean;
}

export interface NativeKazeModuleLike {
  getCurrentBundlePath?: () => Promise<string | null> | string | null;
  restartApp?: () => void;
  setBundleBlacklisted?: (hash: string) => boolean | void;
  getRunningBundleInfo?: () => RunningBundleInfo | null;
  isBundleBlacklisted?: (hash: string) => Promise<boolean> | boolean;
  setBundleStable?: (hash: string) => void;
  clearBlacklist?: () => void;
  writeBundleFile?: (path: string, content: string, isBase64?: boolean) => Promise<boolean> | boolean;
  readBundleFile?: (path: string) => Promise<string | null> | string | null;
  bundleFileExists?: (path: string) => Promise<boolean> | boolean;
  getActiveSlot?: () => Promise<string | null> | string | null;
  switchActiveSlot?: (newSlot: string) => Promise<boolean> | boolean;
  getRollbackSlot?: () => Promise<string | null> | string | null;
  deleteBundlePath?: (relativePath: string) => Promise<boolean> | boolean;
  unzipBundleFile?: (zipRelativePath: string, targetSlotDir: string) => Promise<boolean> | boolean;
}

let testingNativeModule: NativeKazeModuleLike | null = null;
let testingReactNativeResolver: (() => Record<string, unknown> | null) | null = null;

export function setNativeKazeModuleForTesting(mod: NativeKazeModuleLike | null): void {
  testingNativeModule = mod;
}

export function setReactNativeResolverForTesting(resolver: (() => Record<string, unknown> | null) | null): void {
  testingReactNativeResolver = resolver;
}

export function getNativeKazeModule(): NativeKazeModuleLike | null {
  if (testingNativeModule) {
    return testingNativeModule;
  }

  try {
    // Platform-optional dependency: react-native is resolved at runtime in app hosts
    const rn = testingReactNativeResolver
      ? testingReactNativeResolver()
      : (require('react-native') as Record<string, unknown> | null);
    if (rn && typeof rn === 'object') {
      // 1. Prefer TurboModuleRegistry (React Native New Architecture)
      try {
        if ('TurboModuleRegistry' in rn && rn.TurboModuleRegistry && typeof rn.TurboModuleRegistry === 'object') {
          const tmRegistry = rn.TurboModuleRegistry as { get?: (name: string) => unknown };
          if (typeof tmRegistry.get === 'function') {
            const tm = tmRegistry.get('KazeModule');
            if (tm && typeof tm === 'object') {
              return tm as NativeKazeModuleLike;
            }
          }
        }
      } catch {
        // Fall through to NativeModules if TurboModule resolution fails
      }

      // 2. Fall back to NativeModules (Legacy Bridge & Interop Layer)
      if ('NativeModules' in rn && rn.NativeModules && typeof rn.NativeModules === 'object') {
        const nm = rn.NativeModules as Record<string, unknown>;
        const ota = nm['KazeModule'];
        if (ota && typeof ota === 'object') {
          return ota as NativeKazeModuleLike;
        }
      }
    }
  } catch {
    // Not in React Native environment
  }
  return null;
}

export function restartApp(): void {
  const mod = getNativeKazeModule();
  if (mod && typeof mod.restartApp === 'function') {
    mod.restartApp();
  }
}

export async function getCurrentBundlePath(): Promise<string | null> {
  const mod = getNativeKazeModule();
  if (mod && typeof mod.getCurrentBundlePath === 'function') {
    return await mod.getCurrentBundlePath();
  }
  return null;
}

export function setNativeBundleBlacklisted(hash: string): void {
  const mod = getNativeKazeModule();
  if (mod && typeof mod.setBundleBlacklisted === 'function') {
    mod.setBundleBlacklisted(hash);
  }
}

export function getNativeRunningBundleInfo(): RunningBundleInfo | null {
  const mod = getNativeKazeModule();
  if (mod && typeof mod.getRunningBundleInfo === 'function') {
    return mod.getRunningBundleInfo() ?? null;
  }
  return null;
}

export async function isNativeBundleBlacklisted(hash: string): Promise<boolean> {
  const mod = getNativeKazeModule();
  if (mod && typeof mod.isBundleBlacklisted === 'function') {
    return await mod.isBundleBlacklisted(hash);
  }
  return false;
}

export function setNativeBundleStable(hash: string): void {
  const mod = getNativeKazeModule();
  if (mod && typeof mod.setBundleStable === 'function') {
    mod.setBundleStable(hash);
  }
}

export function clearNativeBlacklist(): void {
  const mod = getNativeKazeModule();
  if (mod && typeof mod.clearBlacklist === 'function') {
    mod.clearBlacklist();
  }
}

export async function nativeWriteBundleFile(path: string, content: string, isBase64 = false): Promise<boolean> {
  const mod = getNativeKazeModule();
  if (mod && typeof mod.writeBundleFile === 'function') {
    const res = await mod.writeBundleFile(path, content, isBase64);
    return res !== false;
  }
  return false;
}

export async function nativeReadBundleFile(path: string): Promise<string | null> {
  const mod = getNativeKazeModule();
  if (mod && typeof mod.readBundleFile === 'function') {
    return await mod.readBundleFile(path);
  }
  return null;
}

export async function nativeBundleFileExists(path: string): Promise<boolean> {
  const mod = getNativeKazeModule();
  if (mod && typeof mod.bundleFileExists === 'function') {
    return await mod.bundleFileExists(path);
  }
  return false;
}

export async function nativeDeleteBundlePath(path: string): Promise<boolean> {
  const mod = getNativeKazeModule();
  if (mod && typeof mod.deleteBundlePath === 'function') {
    const res = await mod.deleteBundlePath(path);
    return res !== false;
  }
  return false;
}

export async function getNativeActiveSlot(): Promise<string | null> {
  const mod = getNativeKazeModule();
  if (mod && typeof mod.getActiveSlot === 'function') {
    return await mod.getActiveSlot();
  }
  return null;
}

export async function switchNativeActiveSlot(newSlot: string): Promise<boolean> {
  const mod = getNativeKazeModule();
  if (mod && typeof mod.switchActiveSlot === 'function') {
    const res = await mod.switchActiveSlot(newSlot);
    return res !== false;
  }
  return false;
}

export async function getNativeRollbackSlot(): Promise<string | null> {
  const mod = getNativeKazeModule();
  if (mod && typeof mod.getRollbackSlot === 'function') {
    return await mod.getRollbackSlot();
  }
  return null;
}

export async function nativeUnzipBundleFile(zipRelativePath: string, targetSlotDir: string): Promise<boolean> {
  const mod = getNativeKazeModule();
  if (mod && typeof mod.unzipBundleFile === 'function') {
    return await mod.unzipBundleFile(zipRelativePath, targetSlotDir);
  }
  return false;
}
