import { describe, it, expect } from 'vitest';
import { verifyBundleChecksum, checkUpdate, downloadBundle, reportUpdateStatus, computeSha256 } from '../src/updater';
import { vi } from 'vitest';

describe('Bundle Checksum Verification & Pure SHA-256', () => {
  it('computes exact SHA-256 matching NIST test vectors without node:crypto', () => {
    // NIST Test vector 1: Empty string
    expect(computeSha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');

    // NIST Test vector 2: "The quick brown fox jumps over the lazy dog"
    const sentence = 'The quick brown fox jumps over the lazy dog';
    expect(computeSha256(sentence)).toBe('d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592');
  });

  it('validates matching SHA-256 and rejects mismatched checksums with Uint8Array data', () => {
    const data = new TextEncoder().encode('console.log("safe update");');
    const validHash = computeSha256(data);

    expect(verifyBundleChecksum(data, validHash)).toBe(true);
    expect(verifyBundleChecksum(data, '0000000000000000000000000000000000000000000000000000000000000000')).toBe(false);
    expect(verifyBundleChecksum(data, 'wrong-hash')).toBe(false);
  });
  it('downloads bundle with progress reporting', async () => {
    const sampleData = new TextEncoder().encode('bundle payload chunk');
    const progressHistory: number[] = [];

    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (h: string) => (h.toLowerCase() === 'content-length' ? String(sampleData.length) : null),
      },
      arrayBuffer: async () => sampleData.buffer,
    });

    const downloaded = await downloadBundle(
      'https://ota.example.com/bundle.zip',
      (percent) => {
        progressHistory.push(percent);
      },
      fakeFetch as unknown as typeof fetch
    );

    expect(downloaded).toEqual(sampleData);
    expect(progressHistory).toContain(100);
  });

  it('throws error when download returns non-200 HTTP code', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });

    await expect(
      downloadBundle('https://ota.example.com/notfound.zip', undefined, fakeFetch as unknown as typeof fetch)
    ).rejects.toThrow('Download bundle failed with status 404');
  });

  it('reports update status successfully to server', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    const result = await reportUpdateStatus(
      'https://ota.example.com',
      {
        appId: 'my-app',
        releaseId: 'rel_1',
        deviceId: 'dev_123',
        status: 'installed',
      },
      fakeFetch as unknown as typeof fetch
    );

    expect(result.success).toBe(true);
    expect(fakeFetch).toHaveBeenCalledWith(
      'https://ota.example.com/api/v1/updates/report',
      expect.objectContaining({
        method: 'POST',
      })
    );
  });
});
