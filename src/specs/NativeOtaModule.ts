import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  getCurrentBundlePath(): Promise<string | null>;
  setBundleBlacklisted(hash: string): void;
  isBundleBlacklisted(hash: string): Promise<boolean>;
  setBundleStable(hash: string): void;
  clearBlacklist(): void;
  restartApp(): void;
  writeBundleFile(relativePath: string, content: string, isBase64: boolean): Promise<boolean>;
  readBundleFile(relativePath: string): Promise<string | null>;
  bundleFileExists(relativePath: string): Promise<boolean>;
  unzipBundleFile(zipRelativePath: string, targetSlotDir: string): Promise<boolean>;
  getActiveSlot(): Promise<string | null>;
  switchActiveSlot(newSlot: string): Promise<boolean>;
  getRollbackSlot(): Promise<string | null>;
}

export default TurboModuleRegistry.get<Spec>('OtaModule');
