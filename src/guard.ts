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

  getTestingBundle(): string | null {
    return this.options.storage.get('ota_testing_bundle');
  }

  isBundleTesting(hash: string): boolean {
    return this.options.storage.get('ota_testing_bundle') === hash;
  }

  isBundleBlacklisted(hash: string): boolean {
    return this.options.storage.get(`ota_blacklisted_${hash}`) === 'true';
  }
}

export interface ErrorUtilsLike {
  getGlobalHandler?: () => ((error: Error, isFatal?: boolean) => void) | undefined;
  setGlobalHandler?: (handler: (error: Error, isFatal?: boolean) => void) => void;
}

export function attachGlobalErrorHandler(guard: BootGuard, errorUtils?: ErrorUtilsLike): (() => void) | null {
  let target: ErrorUtilsLike | undefined = errorUtils;
  if (!target && typeof globalThis !== 'undefined' && 'ErrorUtils' in globalThis) {
    const candidate = (globalThis as Record<string, unknown>).ErrorUtils;
    if (candidate && typeof candidate === 'object') {
      target = candidate as ErrorUtilsLike;
    }
  }

  if (!target || typeof target.setGlobalHandler !== 'function') {
    return null;
  }

  const prevHandler = typeof target.getGlobalHandler === 'function' ? target.getGlobalHandler() : undefined;

  const crashHandler = (error: Error, isFatal?: boolean) => {
    const testingBundle = guard.getTestingBundle();
    if (testingBundle) {
      guard.recordCrash(testingBundle, error?.message || 'Fatal boot crash');
    }
    if (prevHandler) {
      prevHandler(error, isFatal);
    }
  };

  target.setGlobalHandler(crashHandler);

  return () => {
    if (prevHandler && typeof target?.setGlobalHandler === 'function') {
      target.setGlobalHandler(prevHandler);
    }
  };
}

export interface InitBootGuardOptions extends BootGuardOptions {
  activeHash?: string;
  attachHandler?: boolean;
  errorUtils?: ErrorUtilsLike;
}

export function initBootGuard(options: InitBootGuardOptions): BootGuard {
  const guard = new BootGuard(options);
  if (options.attachHandler !== false) {
    attachGlobalErrorHandler(guard, options.errorUtils);
  }
  if (options.activeHash) {
    guard.onBundleBoot(options.activeHash);
  }
  return guard;
}
