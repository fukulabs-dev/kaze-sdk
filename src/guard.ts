export interface KeyValueStorage {
  get(key: string): string | null;
  set(key: string, val: string): void;
  remove(key: string): void;
}

export interface BootGuardOptions {
  storage: KeyValueStorage;
  stabilityTimeoutMs?: number;
  onCrashRollback?: (hash: string, reason: string) => void;
}

export class BootGuard {
  private timeoutId?: NodeJS.Timeout;

  constructor(private options: BootGuardOptions) {}

  onBundleBoot(hash: string) {
    if (this.isBundleBlacklisted(hash)) {
      throw new Error(`Cannot boot blacklisted bundle: ${hash}`);
    }

    this.options.storage.set('ota_testing_bundle', hash);
    const timeout = this.options.stabilityTimeoutMs ?? 5000;

    this.timeoutId = setTimeout(() => {
      this.options.storage.set(`ota_stable_${hash}`, 'true');
      this.options.storage.remove('ota_testing_bundle');
    }, timeout);
  }

  recordCrash(hash: string, reason: string) {
    clearTimeout(this.timeoutId);
    this.options.storage.set(`ota_blacklisted_${hash}`, 'true');
    this.options.storage.remove('ota_testing_bundle');
    this.options.onCrashRollback?.(hash, reason);
  }

  isBundleStable(hash: string): boolean {
    return this.options.storage.get(`ota_stable_${hash}`) === 'true';
  }

  isBundleTesting(hash: string): boolean {
    return this.options.storage.get('ota_testing_bundle') === hash;
  }

  isBundleBlacklisted(hash: string): boolean {
    return this.options.storage.get(`ota_blacklisted_${hash}`) === 'true';
  }
}
