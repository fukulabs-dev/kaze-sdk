import { describe, it, expect } from 'vitest';
import { stageBundle, MemoryFileSystemAdapter } from '../src/staging';

describe('Bundle Staging & Native File Bridge', () => {
  it('stages an Android bundle to the ota/current slot with bundle.hash', async () => {
    const fs = new MemoryFileSystemAdapter();
    const result = await stageBundle({
      platform: 'android',
      bundleHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
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

  it('stages an iOS bundle with main.jsbundle entrypoint', async () => {
    const fs = new MemoryFileSystemAdapter();
    const result = await stageBundle({
      platform: 'ios',
      bundleHash: 'f0e1d2c3b4a567890123456789abcdef0123456789abcdef0123456789abcdef0',
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
});
