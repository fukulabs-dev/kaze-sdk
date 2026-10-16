import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  stageBundle,
  unzipBundle,
  MemoryFileSystemAdapter,
  NativeFileSystemAdapter,
  getDefaultFileSystemAdapter,
} from '../src/staging';
import { setNativeOtaModuleForTesting } from '../src/native';
import zlib from 'node:zlib';

function createTestZip(files: Record<string, string>): Uint8Array {
  interface ZipEntry {
    name: string;
    nameBuf: Buffer;
    dataBuf: Buffer;
    compBuf: Buffer;
    lfh: Buffer;
    offset: number;
  }
  const fileEntries: ZipEntry[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name);
    const dataBuf = Buffer.from(content);
    const compBuf = zlib.deflateRawSync(dataBuf);

    const lfh = Buffer.alloc(30 + nameBuf.length);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0, 6);
    lfh.writeUInt16LE(8, 8);
    lfh.writeUInt16LE(0, 10);
    lfh.writeUInt16LE(0, 12);
    lfh.writeUInt32LE(0, 14);
    lfh.writeUInt32LE(compBuf.length, 18);
    lfh.writeUInt32LE(dataBuf.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);
    nameBuf.copy(lfh, 30);

    fileEntries.push({ name, nameBuf, dataBuf, compBuf, lfh, offset });
    offset += lfh.length + compBuf.length;
  }

  const cdStart = offset;
  const cdBuffers: Buffer[] = [];
  for (const entry of fileEntries) {
    const cdh = Buffer.alloc(46 + entry.nameBuf.length);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0, 8);
    cdh.writeUInt16LE(8, 10);
    cdh.writeUInt16LE(0, 12);
    cdh.writeUInt16LE(0, 14);
    cdh.writeUInt32LE(0, 16);
    cdh.writeUInt32LE(entry.compBuf.length, 20);
    cdh.writeUInt32LE(entry.dataBuf.length, 24);
    cdh.writeUInt16LE(entry.nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30);
    cdh.writeUInt16LE(0, 32);
    cdh.writeUInt16LE(0, 34);
    cdh.writeUInt16LE(0, 36);
    cdh.writeUInt32LE(0, 38);
    cdh.writeUInt32LE(entry.offset, 42);
    entry.nameBuf.copy(cdh, 46);
    cdBuffers.push(cdh);
    offset += cdh.length;
  }

  const cdSize = offset - cdStart;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(fileEntries.length, 8);
  eocd.writeUInt16LE(fileEntries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);

  const parts: Buffer[] = [];
  for (const e of fileEntries) {
    parts.push(e.lfh, e.compBuf);
  }
  parts.push(...cdBuffers, eocd);
  return new Uint8Array(Buffer.concat(parts));
}

  beforeEach(() => {
    setNativeOtaModuleForTesting(null);
  });

describe('Bundle Staging & Native File Bridge', () => {
  it('stages an Android bundle to explicit targetDir with bundle.hash', async () => {
    const fs = new MemoryFileSystemAdapter();
    const result = await stageBundle({
      platform: 'android',
      bundleHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      targetDir: 'ota/current',
      files: {
        'index.android.bundle': 'console.log("v2");',
        'assets/logo.png': 'png-bytes',
      },
      fileSystem: fs,
    });

    expect(result.success).toBe(true);
    expect(fs.files['ota/current/index.android.bundle']).toBe('console.log("v2");');
    expect(fs.files['ota/current/bundle.hash']).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('stages an iOS bundle with main.jsbundle entrypoint to explicit targetDir', async () => {
    const fs = new MemoryFileSystemAdapter();
    const result = await stageBundle({
      platform: 'ios',
      bundleHash: 'f0e1d2c3b4a567890123456789abcdef0123456789abcdef0123456789abcdef0',
      targetDir: 'ota/current',
      files: {
        'main.jsbundle': 'console.log("ios v2");',
      },
      fileSystem: fs,
    });

    expect(result.success).toBe(true);
    expect(fs.files['ota/current/main.jsbundle']).toBe('console.log("ios v2");');
    expect(fs.files['ota/current/bundle.hash']).toBe('f0e1d2c3b4a567890123456789abcdef0123456789abcdef0123456789abcdef0');
  });

  it('rejects a bundle missing the platform-specific entrypoint', async () => {
    const fs = new MemoryFileSystemAdapter();
    const result = await stageBundle({
      platform: 'android',
      bundleHash: 'a1b2c3d4...',
      files: {
        'wrong_file.js': 'console.log("invalid");',
      },
      fileSystem: fs,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Missing entrypoint');
  });
  it('rejects bundle with path traversal entry names', async () => {
    const fs = new MemoryFileSystemAdapter();
    const result = await stageBundle({
      platform: 'android',
      bundleHash: 'hash_abc',
      files: {
        'index.android.bundle': 'console.log("ok");',
        '../../etc/passwd': 'evil',
      },
      fileSystem: fs,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('path traversal');
  });

  it('unzips a valid zip archive into entry files', async () => {
    const zipBytes = createTestZip({
      'index.android.bundle': 'console.log("unzipped v1");',
      'assets/logo.png': 'png-data',
    });

    const extracted = await unzipBundle(zipBytes, 'android');
    expect(extracted['index.android.bundle']).toBeDefined();
    const text = new TextDecoder().decode(extracted['index.android.bundle'] as Uint8Array);
    expect(text).toBe('console.log("unzipped v1");');
  });

  it('rejects zip archive containing directory traversal paths', async () => {
    const zipBytes = createTestZip({
      'index.android.bundle': 'console.log("fine");',
      '../dangerous.txt': 'payload',
    });

    await expect(unzipBundle(zipBytes, 'android')).rejects.toThrow('path traversal');
  });

  it('falls back to raw bundle entrypoint if bytes do not contain PK signature', async () => {
    const rawBytes = new TextEncoder().encode('console.log("raw js");');
    const extracted = await unzipBundle(rawBytes, 'ios');
    expect(extracted['main.jsbundle']).toEqual(rawBytes);
  });

  it('NativeFileSystemAdapter delegates writes (string and binary), reads, and exists to native bridge', async () => {
    const mockOta = {
      writeBundleFile: vi.fn().mockResolvedValue(true),
      readBundleFile: vi.fn().mockResolvedValue('read-content'),
      bundleFileExists: vi.fn().mockResolvedValue(true),
    };
    setNativeOtaModuleForTesting(mockOta);

    const adapter = new NativeFileSystemAdapter();

    await adapter.writeFile('ota/current/file.txt', 'hello world');
    expect(mockOta.writeBundleFile).toHaveBeenCalledWith('ota/current/file.txt', 'hello world', false);

    // Uint8Array bytes [72, 105] ("Hi") in base64 is "SGk="
    const binaryBytes = new Uint8Array([72, 105]);
    await adapter.writeFile('ota/current/file.bin', binaryBytes);
    expect(mockOta.writeBundleFile).toHaveBeenCalledWith('ota/current/file.bin', 'SGk=', true);

    const readVal = await adapter.readFile('ota/current/file.txt');
    expect(readVal).toBe('read-content');
    expect(mockOta.readBundleFile).toHaveBeenCalledWith('ota/current/file.txt');

    const exists = await adapter.exists('ota/current/file.txt');
    expect(exists).toBe(true);
    expect(mockOta.bundleFileExists).toHaveBeenCalledWith('ota/current/file.txt');
  });

  it('NativeFileSystemAdapter transparently falls back to in-memory storage when no native module is installed', async () => {
    setNativeOtaModuleForTesting(null);
    const adapter = new NativeFileSystemAdapter();

    expect(await adapter.exists('test.txt')).toBe(false);
    await adapter.writeFile('test.txt', 'in-memory-fallback');
    expect(await adapter.exists('test.txt')).toBe(true);
    expect(await adapter.readFile('test.txt')).toBe('in-memory-fallback');
  });

  it('getDefaultFileSystemAdapter returns a NativeFileSystemAdapter instance', () => {
    const adapter = getDefaultFileSystemAdapter();
    expect(adapter).toBeInstanceOf(NativeFileSystemAdapter);
  });

  it('stageBundle works with NativeFileSystemAdapter writing bundle and hash', async () => {
    const mockOta = {
      writeBundleFile: vi.fn().mockResolvedValue(true),
      readBundleFile: vi.fn().mockResolvedValue(null),
      bundleFileExists: vi.fn().mockResolvedValue(true),
    };
    setNativeOtaModuleForTesting(mockOta);

    const adapter = new NativeFileSystemAdapter();
    const result = await stageBundle({
      platform: 'android',
      bundleHash: 'stage_hash_999',
      targetDir: 'ota/current',
      files: {
        'index.android.bundle': 'console.log("android staged bundle");',
      },
      fileSystem: adapter,
    });

    expect(result.success).toBe(true);
    expect(mockOta.writeBundleFile).toHaveBeenCalledWith(
      'ota/current/index.android.bundle',
      'console.log("android staged bundle");',
      false
    );
    expect(mockOta.writeBundleFile).toHaveBeenCalledWith(
      'ota/current/bundle.hash',
      'stage_hash_999',
      false
    );
  });

  it('alternates between slot_a and slot_b when targetDir is omitted and switches active slot', async () => {
    let activeSlot: string | null = null;
    const mockOta = {
      getActiveSlot: vi.fn().mockImplementation(() => activeSlot),
      switchActiveSlot: vi.fn().mockImplementation((newSlot: string) => {
        activeSlot = newSlot;
        return true;
      }),
    };
    setNativeOtaModuleForTesting(mockOta);

    const fs = new MemoryFileSystemAdapter();

    // 1st staging: starting from null -> slot_a
    const res1 = await stageBundle({
      platform: 'android',
      bundleHash: 'hash_v1',
      files: { 'index.android.bundle': 'v1 code' },
      fileSystem: fs,
    });
    expect(res1.success).toBe(true);
    expect(res1.slot).toBe('slot_a');
    expect(res1.activePath).toBe('ota/slot_a');
    expect(fs.files['ota/slot_a/index.android.bundle']).toBe('v1 code');
    expect(mockOta.switchActiveSlot).toHaveBeenCalledWith('slot_a');
    expect(activeSlot).toBe('slot_a');

    // 2nd staging: starting from slot_a -> slot_b
    const res2 = await stageBundle({
      platform: 'android',
      bundleHash: 'hash_v2',
      files: { 'index.android.bundle': 'v2 code' },
      fileSystem: fs,
    });
    expect(res2.success).toBe(true);
    expect(res2.slot).toBe('slot_b');
    expect(res2.activePath).toBe('ota/slot_b');
    expect(fs.files['ota/slot_b/index.android.bundle']).toBe('v2 code');
    expect(mockOta.switchActiveSlot).toHaveBeenCalledWith('slot_b');
    expect(activeSlot).toBe('slot_b');

    // 3rd staging: starting from slot_b -> slot_a
    const res3 = await stageBundle({
      platform: 'android',
      bundleHash: 'hash_v3',
      files: { 'index.android.bundle': 'v3 code' },
      fileSystem: fs,
    });
    expect(res3.success).toBe(true);
    expect(res3.slot).toBe('slot_a');
    expect(res3.activePath).toBe('ota/slot_a');
    expect(fs.files['ota/slot_a/index.android.bundle']).toBe('v3 code');
    expect(mockOta.switchActiveSlot).toHaveBeenCalledWith('slot_a');
    expect(activeSlot).toBe('slot_a');
  });
});
