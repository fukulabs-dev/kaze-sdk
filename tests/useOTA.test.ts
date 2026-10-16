import { describe, it, expect, vi } from 'vitest';
import { createOTAController } from '../src/useOTA';
import { computeSha256 } from '../src/sha256';
import { MemoryFileSystemAdapter } from '../src/staging';

describe('useOTA & OTAController State Machine', () => {
  it('initializes with default idle state', () => {
    const controller = createOTAController({
      serverUrl: 'https://ota.example.com',
      appId: 'test-app',
      platform: 'android',
      runtimeVersion: '1.0.0',
    });

    const state = controller.getState();
    expect(state.status).toBe('idle');
    expect(state.isChecking).toBe(false);
    expect(state.isDownloading).toBe(false);
    expect(state.progress).toBe(0);
    expect(state.updateAvailable).toBe(false);
    expect(state.manifest).toBeNull();
    expect(state.error).toBeNull();
  });

  it('updates state to updateAvailable when server returns manifest', async () => {
    const mockManifest = {
      id: 'rel_1',
      appId: 'test-app',
      platform: 'android' as const,
      runtimeVersion: '1.0.0',
      channel: 'production',
      bundleHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      bundleUrl: 'https://ota.example.com/bundles/rel_1.zip',
      bundleSize: 1024,
      isMandatory: false,
      createdAt: new Date().toISOString(),
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ updateAvailable: true, manifest: mockManifest }),
    });

    const controller = createOTAController(
      {
        serverUrl: 'https://ota.example.com',
        appId: 'test-app',
        platform: 'android',
        runtimeVersion: '1.0.0',
      },
      fetchMock as unknown as typeof fetch
    );

    const result = await controller.check();
    expect(result).toEqual(mockManifest);
    expect(controller.getState().updateAvailable).toBe(true);
    expect(controller.getState().manifest?.id).toBe('rel_1');
  });

  it('handles network failure gracefully', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('Network offline'));

    const controller = createOTAController(
      {
        serverUrl: 'https://ota.example.com',
        appId: 'test-app',
        platform: 'android',
        runtimeVersion: '1.0.0',
      },
      fetchMock as unknown as typeof fetch
    );

    const result = await controller.check();
    expect(result).toBeNull();
    expect(controller.getState().error?.message).toBe('Network offline');
  });
  it('executes downloadAndStage and transitions to ready state', async () => {
    const bundleContent = 'console.log("new bundle ready");';
    const bundleBytes = new TextEncoder().encode(bundleContent);
    const bundleHash = computeSha256(bundleBytes);

    const mockManifest = {
      id: 'rel_stage',
      appId: 'test-app',
      platform: 'android' as const,
      runtimeVersion: '1.0.0',
      channel: 'production',
      bundleHash,
      bundleUrl: 'https://ota.example.com/bundles/rel_stage.zip',
      bundleSize: bundleBytes.length,
      isMandatory: false,
      createdAt: new Date().toISOString(),
    };

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/v1/updates/check')) {
        return {
          ok: true,
          json: async () => ({ updateAvailable: true, manifest: mockManifest }),
        };
      }
      if (url.includes('/bundles/rel_stage.zip')) {
        return {
          ok: true,
          headers: { get: () => String(bundleBytes.length) },
          arrayBuffer: async () => bundleBytes.buffer,
        };
      }
      return { ok: false, status: 404 };
    });

    const fs = new MemoryFileSystemAdapter();
    const onStaged = vi.fn();
    const onProgress = vi.fn();

    const controller = createOTAController(
      {
        serverUrl: 'https://ota.example.com',
        appId: 'test-app',
        platform: 'android',
        runtimeVersion: '1.0.0',
        autoApply: 'next-restart',
        fileSystem: fs,
        onUpdateStaged: onStaged,
        onDownloadProgress: onProgress,
      },
      fetchMock as unknown as typeof fetch,
      fs
    );

    await controller.checkForUpdate();
    expect(controller.getState().updateAvailable).toBe(true);

    const success = await controller.downloadAndStage(mockManifest);
    expect(success).toBe(true);
    expect(controller.getState().status).toBe('ready');
    expect(controller.getState().progress).toBe(100);
    expect(onStaged).toHaveBeenCalledWith(mockManifest);
    expect(fs.files['ota/current/index.android.bundle']).toBeDefined();
  });

  it('rejects download when SHA-256 checksum mismatches manifest', async () => {
    const corruptedBytes = new TextEncoder().encode('corrupted data');
    const expectedHash = '0000000000000000000000000000000000000000000000000000000000000000';

    const mockManifest = {
      id: 'rel_corrupt',
      appId: 'test-app',
      platform: 'android' as const,
      runtimeVersion: '1.0.0',
      channel: 'production',
      bundleHash: expectedHash,
      bundleUrl: 'https://ota.example.com/bundles/corrupt.zip',
      bundleSize: corruptedBytes.length,
      isMandatory: false,
      createdAt: new Date().toISOString(),
    };

    const fetchMock = vi.fn().mockImplementation(async () => ({
      ok: true,
      headers: { get: () => String(corruptedBytes.length) },
      arrayBuffer: async () => corruptedBytes.buffer,
    }));

    const onError = vi.fn();
    const controller = createOTAController(
      {
        serverUrl: 'https://ota.example.com',
        appId: 'test-app',
        platform: 'android',
        runtimeVersion: '1.0.0',
        onError,
      },
      fetchMock as unknown as typeof fetch
    );

    const success = await controller.downloadAndStage(mockManifest);
    expect(success).toBe(false);
    expect(controller.getState().status).toBe('error');
    expect(controller.getState().error?.message).toContain('Checksum mismatch');
    expect(onError).toHaveBeenCalled();
  });
});
