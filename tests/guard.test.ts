import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BootGuard, attachGlobalErrorHandler, initBootGuard } from '../src/guard';
import type { ErrorUtilsLike } from '../src/guard';
import { setNativeOtaModuleForTesting } from '../src/native';

describe('BootGuard Rollback Safeguard', () => {
  let mockStorage: Record<string, string>;

  beforeEach(() => {
    mockStorage = {};
    vi.restoreAllMocks();
    setNativeOtaModuleForTesting(null);
  });

  const storageAdapter = {
    get: (key: string) => mockStorage[key] || null,
    set: (key: string, val: string) => {
      mockStorage[key] = val;
    },
    remove: (key: string) => {
      delete mockStorage[key];
    },
  };

  it('marks a new bundle as testing and confirms stable after 5s', () => {
    vi.useFakeTimers();
    const guard = new BootGuard({ storage: storageAdapter, stabilityTimeoutMs: 5000 });

    guard.onBundleBoot('hash_123');
    expect(guard.isBundleTesting('hash_123')).toBe(true);

    vi.advanceTimersByTime(5000);
    expect(guard.isBundleStable('hash_123')).toBe(true);
    expect(guard.isBundleTesting('hash_123')).toBe(false);
    vi.useRealTimers();
  });

  it('blacklists bundle if crash occurs during boot window', () => {
    const guard = new BootGuard({ storage: storageAdapter });
    guard.onBundleBoot('bad_hash');
    guard.recordCrash('bad_hash', 'ReferenceError: invalid JS');

    expect(guard.isBundleBlacklisted('bad_hash')).toBe(true);
  });

  it('intercepts fatal error via ErrorUtils handler and blacklists active testing bundle', () => {
    let currentHandler: ((error: Error, isFatal?: boolean) => void) | undefined;
    const mockErrorUtils: ErrorUtilsLike = {
      getGlobalHandler: () => currentHandler,
      setGlobalHandler: (h) => {
        currentHandler = h;
      },
    };

    const guard = initBootGuard({
      storage: storageAdapter,
      activeHash: 'failing_bundle_hash',
      errorUtils: mockErrorUtils,
    });

    expect(guard.isBundleTesting('failing_bundle_hash')).toBe(true);
    expect(currentHandler).toBeDefined();

    // Simulate fatal error
    currentHandler!(new Error('ReferenceError: crash in component mount'), true);

    expect(guard.isBundleBlacklisted('failing_bundle_hash')).toBe(true);
    expect(guard.isBundleTesting('failing_bundle_hash')).toBe(false);
  });

  it('unsubscribes and restores original handler when cleanup callback is called', () => {
    const originalHandler = vi.fn();
    let installedHandler: ((error: Error, isFatal?: boolean) => void) | undefined = originalHandler;
    const mockErrorUtils: ErrorUtilsLike = {
      getGlobalHandler: () => installedHandler,
      setGlobalHandler: (h) => {
        installedHandler = h;
      },
    };

    const guard = new BootGuard({ storage: storageAdapter });
    const detach = attachGlobalErrorHandler(guard, mockErrorUtils);
    expect(installedHandler).not.toBe(originalHandler);

    detach?.();
    expect(installedHandler).toBe(originalHandler);
  });

  it('synchronizes crash blacklisting and stability directly to native module', () => {
    vi.useFakeTimers();
    const mockOta = {
      setBundleBlacklisted: vi.fn(),
      setBundleStable: vi.fn(),
    };
    setNativeOtaModuleForTesting(mockOta);

    const guard = initBootGuard({
      activeHash: 'test_sync_hash',
      stabilityTimeoutMs: 3000,
      attachHandler: false,
    });

    vi.advanceTimersByTime(3000);
    expect(mockOta.setBundleStable).toHaveBeenCalledWith('test_sync_hash');

    guard.recordCrash('crash_sync_hash', 'Fatal test crash');
    expect(mockOta.setBundleBlacklisted).toHaveBeenCalledWith('crash_sync_hash');
    vi.useRealTimers();
  });
});
