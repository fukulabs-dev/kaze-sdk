import type { KeyValueStorage } from './guard';
import { setNativeBundleBlacklisted, setNativeBundleStable } from './native';

export class MemoryStorage implements KeyValueStorage {
  private data = new Map<string, string>();

  get(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  set(key: string, val: string): void {
    this.data.set(key, val);
  }

  remove(key: string): void {
    this.data.delete(key);
  }
}

export class NativeStorage implements KeyValueStorage {
  private cache = new Map<string, string>();

  constructor(private fallback: KeyValueStorage = new MemoryStorage()) {}

  get(key: string): string | null {
    if (this.cache.has(key)) {
      return this.cache.get(key) ?? null;
    }
    return this.fallback.get(key);
  }

  set(key: string, val: string): void {
    this.cache.set(key, val);
    this.fallback.set(key, val);

    if (key.startsWith('ota_blacklisted_')) {
      const hash = key.slice('ota_blacklisted_'.length);
      setNativeBundleBlacklisted(hash);
    } else if (key.startsWith('ota_stable_')) {
      const hash = key.slice('ota_stable_'.length);
      setNativeBundleStable(hash);
    }
  }

  remove(key: string): void {
    this.cache.delete(key);
    this.fallback.remove(key);
  }
}
