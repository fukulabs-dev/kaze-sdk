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

  // Validate against path traversal
  for (const relativePath of Object.keys(options.files)) {
    if (relativePath.includes('..') || relativePath.startsWith('/') || relativePath.startsWith('\\')) {
      return {
        success: false,
        error: `Security error: path traversal detected: ${relativePath}`,
      };
    }
  }

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

export async function unzipBundle(
  data: Uint8Array,
  platform: 'android' | 'ios'
): Promise<Record<string, string | Uint8Array>> {
  // Check PK\x03\x04 signature (0x04034b50)
  if (data.length < 4 || data[0] !== 0x50 || data[1] !== 0x4b || data[2] !== 0x03 || data[3] !== 0x04) {
    const entrypoint = platform === 'android' ? 'index.android.bundle' : 'main.jsbundle';
    return { [entrypoint]: data };
  }

  const files: Record<string, string | Uint8Array> = {};
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // Find End of Central Directory (EOCD): signature 0x06054b50
  let eocdOffset = -1;
  for (let i = data.length - 22; i >= 0 && i >= data.length - 65557; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset !== -1) {
    const totalEntries = view.getUint16(eocdOffset + 10, true);
    const cdOffset = view.getUint32(eocdOffset + 16, true);
    let curr = cdOffset;

    for (let entry = 0; entry < totalEntries && curr < eocdOffset; entry++) {
      if (view.getUint32(curr, true) !== 0x02014b50) break;
      const method = view.getUint16(curr + 10, true);
      const compressedSize = view.getUint32(curr + 20, true);
      const fileNameLen = view.getUint16(curr + 28, true);
      const extraLen = view.getUint16(curr + 30, true);
      const commentLen = view.getUint16(curr + 32, true);
      const localHeaderOffset = view.getUint32(curr + 42, true);

      const fileNameBytes = data.subarray(curr + 46, curr + 46 + fileNameLen);
      const fileName = new TextDecoder().decode(fileNameBytes);

      if (fileName.includes('..') || fileName.startsWith('/') || fileName.startsWith('\\')) {
        throw new Error(`Security error: path traversal in archive entry: ${fileName}`);
      }

      curr += 46 + fileNameLen + extraLen + commentLen;

      if (fileName.endsWith('/')) {
        continue;
      }

      if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
        throw new Error(`Corrupt zip: invalid local header for entry ${fileName}`);
      }
      const localNameLen = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const compData = data.subarray(dataStart, dataStart + compressedSize);

      if (method === 0) {
        files[fileName] = compData;
      } else if (method === 8) {
        if (typeof DecompressionStream !== 'undefined') {
          const ds = new DecompressionStream('deflate-raw');
          const writer = ds.writable.getWriter();
          writer.write(compData);
          writer.close();
          const res = new Response(ds.readable);
          files[fileName] = new Uint8Array(await res.arrayBuffer());
        } else {
          throw new Error('DecompressionStream is not supported in this runtime environment');
        }
      } else {
        throw new Error(`Unsupported compression method ${method} in zip archive`);
      }
    }
    return files;
  }

  // Fallback: sequential local header parsing
  let offset = 0;
  while (offset + 30 <= data.length) {
    if (view.getUint32(offset, true) !== 0x04034b50) break;
    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const fileNameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);

    const fileNameBytes = data.subarray(offset + 30, offset + 30 + fileNameLen);
    const fileName = new TextDecoder().decode(fileNameBytes);

    if (fileName.includes('..') || fileName.startsWith('/') || fileName.startsWith('\\')) {
      throw new Error(`Security error: path traversal in archive entry: ${fileName}`);
    }

    const dataStart = offset + 30 + fileNameLen + extraLen;
    const compData = data.subarray(dataStart, dataStart + compressedSize);

    if (!fileName.endsWith('/')) {
      if (method === 0) {
        files[fileName] = compData;
      } else if (method === 8 && typeof DecompressionStream !== 'undefined') {
        const ds = new DecompressionStream('deflate-raw');
        const writer = ds.writable.getWriter();
        writer.write(compData);
        writer.close();
        const res = new Response(ds.readable);
        files[fileName] = new Uint8Array(await res.arrayBuffer());
      }
    }

    offset = dataStart + compressedSize;
  }

  return files;
}
