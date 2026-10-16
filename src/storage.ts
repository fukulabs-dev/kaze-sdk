import type { KeyValueStorage } from './guard';

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
