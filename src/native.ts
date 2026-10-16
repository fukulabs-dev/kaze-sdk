export interface NativeOtaModuleLike {
  getCurrentBundlePath?: () => string | null;
  restartApp?: () => void;
}

export function getNativeOtaModule(): NativeOtaModuleLike | null {
  try {
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

export function getCurrentBundlePath(): string | null {
  const mod = getNativeOtaModule();
  if (mod && typeof mod.getCurrentBundlePath === 'function') {
    return mod.getCurrentBundlePath();
  }
  return null;
}
