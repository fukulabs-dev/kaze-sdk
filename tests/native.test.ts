import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  restartApp,
  getCurrentBundlePath,
  getNativeOtaModule,
  setNativeBundleBlacklisted,
  isNativeBundleBlacklisted,
  setNativeBundleStable,
  clearNativeBlacklist,
  nativeWriteBundleFile,
  nativeReadBundleFile,
  nativeBundleFileExists,
  getNativeActiveSlot,
  switchNativeActiveSlot,
  getNativeRollbackSlot,
  nativeUnzipBundleFile,
  setNativeOtaModuleForTesting,
  setReactNativeResolverForTesting,
} from '../src/native';
import { NativeStorage } from '../src/storage';

describe('Native Module Bridge', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setNativeOtaModuleForTesting(null);
    setReactNativeResolverForTesting(null);
  });
  it('safely handles environments without react-native', async () => {
    expect(() => restartApp()).not.toThrow();
    await expect(getCurrentBundlePath()).resolves.toBeNull();
    expect(getNativeOtaModule()).toBeNull();
    expect(() => setNativeBundleBlacklisted('hash_1')).not.toThrow();
    await expect(isNativeBundleBlacklisted('hash_1')).resolves.toBe(false);
    expect(() => setNativeBundleStable('hash_1')).not.toThrow();
    expect(() => clearNativeBlacklist()).not.toThrow();
    await expect(nativeWriteBundleFile('ota/test.txt', 'hello')).resolves.toBe(false);
    await expect(nativeReadBundleFile('ota/test.txt')).resolves.toBeNull();
    await expect(nativeBundleFileExists('ota/test.txt')).resolves.toBe(false);
    await expect(getNativeActiveSlot()).resolves.toBeNull();
    await expect(switchNativeActiveSlot('slot_b')).resolves.toBe(false);
    await expect(getNativeRollbackSlot()).resolves.toBeNull();
    await expect(nativeUnzipBundleFile('ota/staging.zip', 'ota/slot_a')).resolves.toBe(false);
  });

  it('NativeStorage sets and gets keys with native synchronization', () => {
    const storage = new NativeStorage();
    storage.set('custom_key', 'custom_value');
    expect(storage.get('custom_key')).toBe('custom_value');

    // Setting blacklisted hash syncs to native bridge
    storage.set('ota_blacklisted_bad_hash_99', 'true');
    expect(storage.get('ota_blacklisted_bad_hash_99')).toBe('true');

    // Setting stable hash syncs to native bridge
    storage.set('ota_stable_good_hash_88', 'true');
    expect(storage.get('ota_stable_good_hash_88')).toBe('true');

    storage.remove('custom_key');
    expect(storage.get('custom_key')).toBeNull();
  });

  it('delegates to NativeModules.OtaModule when present', async () => {
    const mockOta = {
      getCurrentBundlePath: vi.fn().mockResolvedValue('/data/user/0/app/files/ota/current/index.android.bundle'),
      restartApp: vi.fn(),
      setBundleBlacklisted: vi.fn(),
      isBundleBlacklisted: vi.fn().mockResolvedValue(true),
      setBundleStable: vi.fn(),
      clearBlacklist: vi.fn(),
      writeBundleFile: vi.fn().mockResolvedValue(true),
      readBundleFile: vi.fn().mockResolvedValue('file-contents'),
      bundleFileExists: vi.fn().mockResolvedValue(true),
      getActiveSlot: vi.fn().mockResolvedValue('slot_a'),
      switchActiveSlot: vi.fn().mockResolvedValue(true),
      getRollbackSlot: vi.fn().mockResolvedValue(null),
      unzipBundleFile: vi.fn().mockResolvedValue(true),
    };

    setNativeOtaModuleForTesting(mockOta);

    const path = await getCurrentBundlePath();
    expect(path).toBe('/data/user/0/app/files/ota/current/index.android.bundle');

    restartApp();
    expect(mockOta.restartApp).toHaveBeenCalledTimes(1);

    setNativeBundleBlacklisted('crash_hash_404');
    expect(mockOta.setBundleBlacklisted).toHaveBeenCalledWith('crash_hash_404');

    const isBlacklisted = await isNativeBundleBlacklisted('crash_hash_404');
    expect(isBlacklisted).toBe(true);

    setNativeBundleStable('stable_hash_200');
    expect(mockOta.setBundleStable).toHaveBeenCalledWith('stable_hash_200');

    clearNativeBlacklist();
    expect(mockOta.clearBlacklist).toHaveBeenCalledTimes(1);

    const writeOk = await nativeWriteBundleFile('ota/test.txt', 'hello', false);
    expect(writeOk).toBe(true);
    expect(mockOta.writeBundleFile).toHaveBeenCalledWith('ota/test.txt', 'hello', false);

    const content = await nativeReadBundleFile('ota/test.txt');
    expect(content).toBe('file-contents');
    expect(mockOta.readBundleFile).toHaveBeenCalledWith('ota/test.txt');

    const exists = await nativeBundleFileExists('ota/test.txt');
    expect(exists).toBe(true);
    expect(mockOta.bundleFileExists).toHaveBeenCalledWith('ota/test.txt');

    const activeSlot = await getNativeActiveSlot();
    expect(activeSlot).toBe('slot_a');
    expect(mockOta.getActiveSlot).toHaveBeenCalledTimes(1);

    const switched = await switchNativeActiveSlot('slot_b');
    expect(switched).toBe(true);
    expect(mockOta.switchActiveSlot).toHaveBeenCalledWith('slot_b');

    const rollbackSlot = await getNativeRollbackSlot();
    expect(rollbackSlot).toBeNull();
    expect(mockOta.getRollbackSlot).toHaveBeenCalledTimes(1);

    const unzipped = await nativeUnzipBundleFile('ota/staging.zip', 'ota/slot_a');
    expect(unzipped).toBe(true);
    expect(mockOta.unzipBundleFile).toHaveBeenCalledWith('ota/staging.zip', 'ota/slot_a');
  });

  it('resolves OtaModule from TurboModuleRegistry when available', () => {
    const mockTurboModule = {
      getCurrentBundlePath: vi.fn().mockResolvedValue('/turbo/slot_a/bundle.js'),
    };
    setReactNativeResolverForTesting(() => ({
      TurboModuleRegistry: {
        get: vi.fn((name: string) => (name === 'OtaModule' ? mockTurboModule : null)),
      },
      NativeModules: {},
    }));

    const mod = getNativeOtaModule();
    expect(mod).toBe(mockTurboModule);
  });

  it('falls back to NativeModules when TurboModuleRegistry returns null', () => {
    const mockLegacyModule = {
      getCurrentBundlePath: vi.fn().mockResolvedValue('/legacy/slot_a/bundle.js'),
    };
    setReactNativeResolverForTesting(() => ({
      TurboModuleRegistry: {
        get: vi.fn(() => null),
      },
      NativeModules: {
        OtaModule: mockLegacyModule,
      },
    }));

    const mod = getNativeOtaModule();
    expect(mod).toBe(mockLegacyModule);
  });

  it('falls back to NativeModules when TurboModuleRegistry is absent or throws', () => {
    const mockLegacyModule = {
      getCurrentBundlePath: vi.fn().mockResolvedValue('/legacy/slot_a/bundle.js'),
    };
    setReactNativeResolverForTesting(() => ({
      TurboModuleRegistry: {
        get: vi.fn(() => {
          throw new Error('JSI binding error');
        }),
      },
      NativeModules: {
        OtaModule: mockLegacyModule,
      },
    }));

    const mod = getNativeOtaModule();
    expect(mod).toBe(mockLegacyModule);
  });
});
