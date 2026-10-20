import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stageBundle, MemoryFileSystemAdapter, NativeFileSystemAdapter } from '../src/staging';
import { setNativeOtaModuleForTesting } from '../src/native';
import { createOTAController } from '../src/useOTA';
import { checkUpdate } from '../src/updater';
import { computeSha256 } from '../src/sha256';

const RUNNING_HASH = 'a'.repeat(64);

function makeManifest(bundleBytes: Uint8Array, overrides: Record<string, unknown> = {}) {
  return {
    id: 'rel_loop',
    appId: 'test-app',
    platform: 'android' as const,
    runtimeVersion: '1.0.0',
    channel: 'production',
    bundleHash: computeSha256(bundleBytes),
    bundleUrl: 'https://ota.example.com/bundles/rel_loop.js',
    bundleSize: bundleBytes.length,
    isMandatory: false,
    rolloutPercentage: 100,
    createdAt: '2026-10-16T10:00:00.000Z',
    ...overrides,
  };
}

function makeFetch(manifest: ReturnType<typeof makeManifest>, bundleBytes: Uint8Array) {
  const checkUrls: string[] = [];
  const fetchMock = vi.fn().mockImplementation(async (url: string) => {
    if (url.includes('/api/v1/updates/check')) {
      checkUrls.push(url);
      return { ok: true, json: async () => ({ updateAvailable: true, manifest }) };
    }
    if (url.includes('/bundles/')) {
      return { ok: true, headers: { get: () => null }, arrayBuffer: async () => bundleBytes.buffer };
    }
    return { ok: true, json: async () => ({ success: true }) };
  });
  const downloadCount = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('/bundles/')).length;
  return { fetchMock, checkUrls, downloadCount };
}

describe('staging slot selection', () => {
  beforeEach(() => {
    setNativeOtaModuleForTesting(null);
  });

  it('never stages into the slot the app is running from', async () => {
    let activeSlot = 'slot_b';
    setNativeOtaModuleForTesting({
      // Running slot_a while an earlier update already sits staged in slot_b.
      getRunningBundleInfo: () => ({ hash: RUNNING_HASH, slot: 'slot_a', stable: true }),
      getActiveSlot: () => activeSlot,
      switchActiveSlot: (slot: string) => {
        activeSlot = slot;
        return true;
      },
    });

    const fs = new MemoryFileSystemAdapter();
    const result = await stageBundle({
      platform: 'android',
      bundleHash: 'b'.repeat(64),
      files: { 'index.android.bundle': 'v2' },
      fileSystem: fs,
    });

    expect(result.slot).toBe('slot_b');
    expect(activeSlot).toBe('slot_b');
  });

  it('clears leftovers from the target slot and writes bundle.hash last', async () => {
    const fs = new MemoryFileSystemAdapter();
    fs.files['ota/slot_a/index.android.bundle'] = 'old';
    fs.files['ota/slot_a/drawable-mdpi/old.png'] = 'old image';
    fs.files['ota/slot_a/bundle.hash'] = 'old hash';
    fs.files['ota/slot_b/index.android.bundle'] = 'untouched';

    const writes: string[] = [];
    const originalWrite = fs.writeFile.bind(fs);
    fs.writeFile = async (path, content) => {
      writes.push(path);
      await originalWrite(path, content);
    };

    await stageBundle({
      platform: 'android',
      bundleHash: 'c'.repeat(64),
      files: { 'index.android.bundle': 'new', 'drawable-mdpi/new.png': 'new image' },
      fileSystem: fs,
      slot: 'slot_a',
    });

    expect(fs.files['ota/slot_a/drawable-mdpi/old.png']).toBeUndefined();
    expect(fs.files['ota/slot_a/index.android.bundle']).toBe('new');
    expect(fs.files['ota/slot_b/index.android.bundle']).toBe('untouched');
    expect(writes[writes.length - 1]).toBe('ota/slot_a/bundle.hash');
  });

  it('NativeFileSystemAdapter.remove delegates to native deleteBundlePath', async () => {
    const deleteBundlePath = vi.fn().mockResolvedValue(true);
    setNativeOtaModuleForTesting({ deleteBundlePath });

    await new NativeFileSystemAdapter().remove('ota/slot_b');
    expect(deleteBundlePath).toHaveBeenCalledWith('ota/slot_b');
  });
});

describe('update loop', () => {
  beforeEach(() => {
    setNativeOtaModuleForTesting(null);
  });

  it('sends the native running bundle hash as currentHash by default', async () => {
    setNativeOtaModuleForTesting({
      getRunningBundleInfo: () => ({ hash: RUNNING_HASH, slot: 'slot_a', stable: true }),
    });
    const bytes = new TextEncoder().encode('console.log("v2");');
    const { fetchMock, checkUrls } = makeFetch(makeManifest(bytes), bytes);

    const controller = createOTAController(
      { serverUrl: 'https://ota.example.com', appId: 'test-app', platform: 'android', runtimeVersion: '1.0.0', autoApply: 'manual' },
      fetchMock as unknown as typeof fetch,
      new MemoryFileSystemAdapter()
    );
    await controller.check();

    expect(new URL(checkUrls[0]).searchParams.get('currentHash')).toBe(RUNNING_HASH);
  });

  it('does not download an update again once it is staged', async () => {
    const bytes = new TextEncoder().encode('console.log("staged once");');
    const { fetchMock, downloadCount } = makeFetch(makeManifest(bytes), bytes);

    const controller = createOTAController(
      { serverUrl: 'https://ota.example.com', appId: 'test-app', platform: 'android', runtimeVersion: '1.0.0', reportStatus: false },
      fetchMock as unknown as typeof fetch,
      new MemoryFileSystemAdapter()
    );

    await controller.check();
    await vi.waitFor(() => expect(controller.getState().status).toBe('ready'));

    // e.g. checkOnResume firing again before the next cold start
    await controller.check();
    await controller.check();

    expect(downloadCount()).toBe(1);
    expect(controller.getState().status).toBe('ready');
  });

  it('joins a download that is already running for the same bundle', async () => {
    const bytes = new TextEncoder().encode('console.log("once");');
    const manifest = makeManifest(bytes);
    const { fetchMock, downloadCount } = makeFetch(manifest, bytes);

    const controller = createOTAController(
      { serverUrl: 'https://ota.example.com', appId: 'test-app', platform: 'android', runtimeVersion: '1.0.0', reportStatus: false, autoApply: 'manual' },
      fetchMock as unknown as typeof fetch,
      new MemoryFileSystemAdapter()
    );

    const [first, second] = await Promise.all([
      controller.downloadAndStage(manifest),
      controller.downloadAndStage(manifest),
    ]);

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(downloadCount()).toBe(1);
  });

  it('ignores an offered bundle that is already running', async () => {
    const bytes = new TextEncoder().encode('console.log("running");');
    const manifest = makeManifest(bytes);
    const { fetchMock, downloadCount } = makeFetch(manifest, bytes);

    const controller = createOTAController(
      {
        serverUrl: 'https://ota.example.com',
        appId: 'test-app',
        platform: 'android',
        runtimeVersion: '1.0.0',
        currentHash: manifest.bundleHash,
      },
      fetchMock as unknown as typeof fetch,
      new MemoryFileSystemAdapter()
    );

    expect(await controller.check()).toBeNull();
    expect(controller.getState().updateAvailable).toBe(false);
    expect(downloadCount()).toBe(0);
  });
});

describe('check response validation', () => {
  const request = { appId: 'test-app', platform: 'android' as const, runtimeVersion: '1.0.0', channel: 'production' };
  const respond = (body: unknown) =>
    vi.fn().mockResolvedValue({ ok: true, json: async () => body }) as unknown as typeof fetch;

  it('rejects a malformed manifest', async () => {
    const bad = { updateAvailable: true, manifest: { id: 'x', bundleHash: 'not-a-hash' } };
    await expect(checkUpdate('https://ota.example.com', request, respond(bad))).rejects.toThrow(
      /Invalid check update response/
    );
  });

  it('rejects a manifest for another runtime version', async () => {
    const bytes = new TextEncoder().encode('x');
    const body = { updateAvailable: true, manifest: makeManifest(bytes, { runtimeVersion: '2.0.0' }) };
    await expect(checkUpdate('https://ota.example.com', request, respond(body))).rejects.toThrow(/runtime 2\.0\.0/);
  });

  it('rejects a manifest for another platform', async () => {
    const bytes = new TextEncoder().encode('x');
    const body = { updateAvailable: true, manifest: makeManifest(bytes, { platform: 'ios' }) };
    await expect(checkUpdate('https://ota.example.com', request, respond(body))).rejects.toThrow(/ios bundle/);
  });

  it('accepts relative bundle URLs and timestamps with an offset', async () => {
    const bytes = new TextEncoder().encode('x');
    const body = {
      updateAvailable: true,
      manifest: makeManifest(bytes, { bundleUrl: '/bundles/x.zip', createdAt: '2026-10-16T17:00:00+07:00' }),
    };
    const res = await checkUpdate('https://ota.example.com', request, respond(body));
    expect(res.manifest?.bundleUrl).toBe('/bundles/x.zip');
  });
});
