import { describe, it, expect, vi } from 'vitest';
import { createOTAController } from '../src/useOTA';

describe('useOTA & OTAController State Machine', () => {
  it('initializes with default idle state', () => {
    const controller = createOTAController({
      serverUrl: 'https://ota.example.com',
      appId: 'test-app',
      platform: 'android',
      runtimeVersion: '1.0.0',
    });

    const state = controller.getState();
    expect(state.isChecking).toBe(false);
    expect(state.isDownloading).toBe(false);
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
});
