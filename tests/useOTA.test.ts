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

  it('automatically reports status staged upon successful staging', async () => {
    const bundleContent = 'console.log("report test bundle");';
    const bundleBytes = new TextEncoder().encode(bundleContent);
    const bundleHash = computeSha256(bundleBytes);

    const mockManifest = {
      id: 'rel_telemetry_1',
      appId: 'test-app',
      platform: 'android' as const,
      runtimeVersion: '1.0.0',
      channel: 'production',
      bundleHash,
      bundleUrl: 'https://ota.example.com/bundles/rel_telemetry.zip',
      bundleSize: bundleBytes.length,
      isMandatory: false,
      createdAt: new Date().toISOString(),
    };

    interface CapturedReport {
      url: string;
      body: Record<string, unknown>;
    }
    const reportCalls: CapturedReport[] = [];
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/api/v1/updates/check')) {
        return {
          ok: true,
          json: async () => ({ updateAvailable: true, manifest: mockManifest }),
        };
      }
      if (url.includes('/bundles/rel_telemetry.zip')) {
        return {
          ok: true,
          headers: { get: () => String(bundleBytes.length) },
          arrayBuffer: async () => bundleBytes.buffer,
        };
      }
      if (url.includes('/api/v1/updates/report')) {
        reportCalls.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
        return {
          ok: true,
          json: async () => ({ success: true }),
        };
      }
      return { ok: false, status: 404 };
    });

    const controller = createOTAController(
      {
        serverUrl: 'https://ota.example.com',
        appId: 'test-app',
        platform: 'android',
        runtimeVersion: '1.0.0',
        clientUuid: 'device-uuid-1234',
        reportStatus: true,
      },
      fetchMock as unknown as typeof fetch,
      new MemoryFileSystemAdapter()
    );

    const success = await controller.downloadAndStage(mockManifest);
    expect(success).toBe(true);
    expect(reportCalls.length).toBe(1);
    expect(reportCalls[0].body).toEqual({
      appId: 'test-app',
      releaseId: 'rel_telemetry_1',
      status: 'staged',
      platform: 'android',
      runtimeVersion: '1.0.0',
      bundleHash,
      clientUuid: 'device-uuid-1234',
    });
  });

  it('automatically reports status failed upon download/verification error', async () => {
    const corruptedBytes = new TextEncoder().encode('corrupted bytes');
    const mockManifest = {
      id: 'rel_telemetry_fail',
      appId: 'test-app',
      platform: 'android' as const,
      runtimeVersion: '1.0.0',
      channel: 'production',
      bundleHash: 'expected_correct_hash_99999999999999999999999999999999999999999999',
      bundleUrl: 'https://ota.example.com/bundles/fail.zip',
      bundleSize: corruptedBytes.length,
      isMandatory: false,
      createdAt: new Date().toISOString(),
    };

    interface CapturedReport {
      url: string;
      body: Record<string, unknown>;
    }
    const reportCalls: CapturedReport[] = [];
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/bundles/fail.zip')) {
        return {
          ok: true,
          headers: { get: () => String(corruptedBytes.length) },
          arrayBuffer: async () => corruptedBytes.buffer,
        };
      }
      if (url.includes('/api/v1/updates/report')) {
        reportCalls.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
        return {
          ok: true,
          json: async () => ({ success: true }),
        };
      }
      return { ok: false, status: 404 };
    });

    const controller = createOTAController(
      {
        serverUrl: 'https://ota.example.com',
        appId: 'test-app',
        platform: 'android',
        runtimeVersion: '1.0.0',
        reportStatus: true,
      },
      fetchMock as unknown as typeof fetch
    );

    await controller.downloadAndStage(mockManifest);
    expect(reportCalls.length).toBe(1);
    expect(reportCalls[0].body.status).toBe('failed');
    expect(reportCalls[0].body.reason).toContain('Checksum mismatch');
  });

  it('does not report status when reportStatus is set to false', async () => {
    const bundleContent = 'console.log("no report bundle");';
    const bundleBytes = new TextEncoder().encode(bundleContent);
    const bundleHash = computeSha256(bundleBytes);

    const mockManifest = {
      id: 'rel_no_report',
      appId: 'test-app',
      platform: 'android' as const,
      runtimeVersion: '1.0.0',
      channel: 'production',
      bundleHash,
      bundleUrl: 'https://ota.example.com/bundles/no_report.zip',
      bundleSize: bundleBytes.length,
      isMandatory: false,
      createdAt: new Date().toISOString(),
    };

    const reportCalls: Array<{ url: string }> = [];
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/bundles/no_report.zip')) {
        return {
          ok: true,
          headers: { get: () => String(bundleBytes.length) },
          arrayBuffer: async () => bundleBytes.buffer,
        };
      }
      if (url.includes('/api/v1/updates/report')) {
        reportCalls.push({ url });
        return { ok: true, json: async () => ({ success: true }) };
      }
      return { ok: false, status: 404 };
    });

    const controller = createOTAController(
      {
        serverUrl: 'https://ota.example.com',
        appId: 'test-app',
        platform: 'android',
        runtimeVersion: '1.0.0',
        reportStatus: false,
      },
      fetchMock as unknown as typeof fetch,
      new MemoryFileSystemAdapter()
    );

    await controller.downloadAndStage(mockManifest);
    expect(reportCalls.length).toBe(0);
  });
});
