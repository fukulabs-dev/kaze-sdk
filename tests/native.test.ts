import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  restartApp,
  getCurrentBundlePath,
  getNativeOtaModule,
  setNativeBundleBlacklisted,
  isNativeBundleBlacklisted,
  setNativeBundleStable,
  clearNativeBlacklist,
  setNativeOtaModuleForTesting,
} from '../src/native';
import { NativeStorage } from '../src/storage';

describe('Native Module Bridge', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setNativeOtaModuleForTesting(null);
  });

  it('safely handles environments without react-native', async () => {
    expect(() => restartApp()).not.toThrow();
    await expect(getCurrentBundlePath()).resolves.toBeNull();
    expect(getNativeOtaModule()).toBeNull();
    expect(() => setNativeBundleBlacklisted('hash_1')).not.toThrow();
    await expect(isNativeBundleBlacklisted('hash_1')).resolves.toBe(false);
    expect(() => setNativeBundleStable('hash_1')).not.toThrow();
    expect(() => clearNativeBlacklist()).not.toThrow();
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
  });
});
