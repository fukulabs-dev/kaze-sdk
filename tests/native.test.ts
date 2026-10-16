import { describe, it, expect, vi, beforeEach } from 'vitest';
import { restartApp, getCurrentBundlePath, getNativeOtaModule } from '../src/native';

describe('Native Module Bridge', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('safely handles environments without react-native', () => {
    expect(() => restartApp()).not.toThrow();
    expect(getCurrentBundlePath()).toBeNull();
    expect(getNativeOtaModule()).toBeNull();
  });
});
