export interface NativeOtaModuleLike {
  getCurrentBundlePath?: () => Promise<string | null> | string | null;
  restartApp?: () => void;
  setBundleBlacklisted?: (hash: string) => void;
  isBundleBlacklisted?: (hash: string) => Promise<boolean> | boolean;
  setBundleStable?: (hash: string) => void;
  clearBlacklist?: () => void;
}

let testingNativeModule: NativeOtaModuleLike | null = null;

export function setNativeOtaModuleForTesting(mod: NativeOtaModuleLike | null): void {
  testingNativeModule = mod;
}

export function getNativeOtaModule(): NativeOtaModuleLike | null {
  if (testingNativeModule) {
    return testingNativeModule;
  }

  try {
    // Platform-optional dependency: react-native is resolved at runtime in app hosts
    const rn = require('react-native');
    if (rn && typeof rn === 'object' && 'NativeModules' in rn) {
      const nm = rn.NativeModules;
      if (nm && typeof nm === 'object' && 'OtaModule' in nm) {
        const ota = nm.OtaModule;
        if (ota && typeof ota === 'object') {
          return ota as NativeOtaModuleLike;
        }
      }
    }
  } catch {
    // Not in React Native environment
  }
  return null;
}

export function restartApp(): void {
  const mod = getNativeOtaModule();
  if (mod && typeof mod.restartApp === 'function') {
    mod.restartApp();
  }
}

export async function getCurrentBundlePath(): Promise<string | null> {
  const mod = getNativeOtaModule();
  if (mod && typeof mod.getCurrentBundlePath === 'function') {
    return await mod.getCurrentBundlePath();
  }
  return null;
}

export function setNativeBundleBlacklisted(hash: string): void {
  const mod = getNativeOtaModule();
  if (mod && typeof mod.setBundleBlacklisted === 'function') {
    mod.setBundleBlacklisted(hash);
  }
}

export async function isNativeBundleBlacklisted(hash: string): Promise<boolean> {
  const mod = getNativeOtaModule();
  if (mod && typeof mod.isBundleBlacklisted === 'function') {
    return await mod.isBundleBlacklisted(hash);
  }
  return false;
}

export function setNativeBundleStable(hash: string): void {
  const mod = getNativeOtaModule();
  if (mod && typeof mod.setBundleStable === 'function') {
    mod.setBundleStable(hash);
  }
}

export function clearNativeBlacklist(): void {
  const mod = getNativeOtaModule();
  if (mod && typeof mod.clearBlacklist === 'function') {
    mod.clearBlacklist();
  }
}
