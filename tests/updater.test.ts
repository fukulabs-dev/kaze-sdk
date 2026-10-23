import { describe, it, expect } from 'vitest';
import {
  verifyBundleChecksum,
  checkUpdate,
  downloadBundle,
  reportUpdateStatus,
  computeSha256,
  TimeoutError,
} from '../src/updater';
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

describe('Network timeouts and download retries', () => {
  const okResponse = (bytes: Uint8Array) => ({
    ok: true,
    headers: { get: () => null },
    arrayBuffer: async () => bytes.buffer,
  });

  // Never settles unless the request is aborted, like a server that accepted the connection and went quiet.
  const hangingFetch = () =>
    vi.fn((_url: string, init?: RequestInit) => {
      return new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });

  const request = { appId: 'my-app', platform: 'android' as const, runtimeVersion: '1.0.0' };

  it('times out a check that never responds and aborts the request', async () => {
    const fetchMock = hangingFetch();
    await expect(
      checkUpdate('https://ota.example.com', request, fetchMock as unknown as typeof fetch, { timeoutMs: 20 })
    ).rejects.toThrow(TimeoutError);
    const signal = fetchMock.mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(true);
  });

  it('times out even when fetch ignores the abort signal', async () => {
    const fetchMock = vi.fn(() => new Promise(() => {}));
    await expect(
      reportUpdateStatus(
        'https://ota.example.com',
        { appId: 'my-app', releaseId: 'rel_1', status: 'staged' },
        fetchMock as unknown as typeof fetch,
        { timeoutMs: 20 }
      )
    ).rejects.toThrow('Report update status timed out after 20 ms');
  });

  it('retries a download after a 503 and a timeout, then succeeds', async () => {
    const bytes = new TextEncoder().encode('bundle');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce(okResponse(bytes));

    const result = await downloadBundle('https://cdn.example.com/b.zip', undefined, fetchMock as unknown as typeof fetch, {
      timeoutMs: 20,
      retries: 2,
      retryDelayMs: 1,
    });

    expect(result).toEqual(bytes);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry a 404', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    await expect(
      downloadBundle('https://cdn.example.com/b.zip', undefined, fetchMock as unknown as typeof fetch, {
        retries: 2,
        retryDelayMs: 1,
      })
    ).rejects.toThrow('status 404');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after the configured number of retries', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Network request failed'));
    await expect(
      downloadBundle('https://cdn.example.com/b.zip', undefined, fetchMock as unknown as typeof fetch, {
        retries: 2,
        retryDelayMs: 1,
      })
    ).rejects.toThrow('Network request failed');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
