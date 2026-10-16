export interface FileSystemAdapter {
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  readFile(path: string): Promise<string | null>;
  exists(path: string): Promise<boolean>;
}

export class MemoryFileSystemAdapter implements FileSystemAdapter {
  files: Record<string, string | Uint8Array> = {};

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    this.files[path] = content;
  }

  async readFile(path: string): Promise<string | null> {
    const val = this.files[path];
    if (val === undefined) return null;
    return typeof val === 'string' ? val : new TextDecoder().decode(val);
  }

  async exists(path: string): Promise<boolean> {
    return this.files[path] !== undefined;
  }
}

export interface StageBundleOptions {
  platform: 'android' | 'ios';
  bundleHash: string;
  files: Record<string, string | Uint8Array>;
  fileSystem: FileSystemAdapter;
  targetDir?: string;
}

export interface StageBundleResult {
  success: boolean;
  activePath?: string;
  error?: string;
}

export async function stageBundle(options: StageBundleOptions): Promise<StageBundleResult> {
  const targetDir = options.targetDir || 'ota/current';
  const expectedEntrypoint = options.platform === 'android' ? 'index.android.bundle' : 'main.jsbundle';

  if (!options.files[expectedEntrypoint]) {
    return {
      success: false,
      error: `Missing entrypoint: ${expectedEntrypoint} is required for ${options.platform}`,
    };
  }

  for (const [relativePath, content] of Object.entries(options.files)) {
    const fullPath = `${targetDir}/${relativePath}`;
    await options.fileSystem.writeFile(fullPath, content);
  }

  await options.fileSystem.writeFile(`${targetDir}/bundle.hash`, options.bundleHash);

  return {
    success: true,
    activePath: `${targetDir}/${expectedEntrypoint}`,
  };
}
