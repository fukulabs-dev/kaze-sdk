import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  getCurrentBundlePath(): Promise<string | null>;
  setBundleBlacklisted(hash: string): boolean;
  getRunningBundleInfo(): { hash: string | null; slot: string | null; stable: boolean };
  isBundleBlacklisted(hash: string): Promise<boolean>;
  setBundleStable(hash: string): void;
  clearBlacklist(): void;
  setBootVerificationEnabled(enabled: boolean): void;
  restartApp(): void;
  writeBundleFile(relativePath: string, content: string, isBase64: boolean): Promise<boolean>;
  readBundleFile(relativePath: string): Promise<string | null>;
  bundleFileExists(relativePath: string): Promise<boolean>;
  deleteBundlePath(relativePath: string): Promise<boolean>;
  unzipBundleFile(zipRelativePath: string, targetSlotDir: string): Promise<boolean>;
  getActiveSlot(): Promise<string | null>;
  switchActiveSlot(newSlot: string): Promise<boolean>;
  getRollbackSlot(): Promise<string | null>;
}

export default TurboModuleRegistry.get<Spec>('KazeModule');
