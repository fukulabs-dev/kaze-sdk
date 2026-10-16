import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BootGuard } from '../src/guard';

describe('BootGuard Rollback Safeguard', () => {
  let mockStorage: Record<string, string>;

  beforeEach(() => {
    mockStorage = {};
  });

  const storageAdapter = {
    get: (key: string) => mockStorage[key] || null,
    set: (key: string, val: string) => { mockStorage[key] = val; },
    remove: (key: string) => { delete mockStorage[key]; },
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
});
