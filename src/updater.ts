import { computeSha256 } from './sha256';
import type { CheckUpdateRequest, CheckUpdateResponse } from './types';

export { computeSha256 };

export function verifyBundleChecksum(data: Uint8Array | ArrayBuffer | string, expectedHash: string): boolean {
  const actual = computeSha256(data);
  return actual.toLowerCase() === expectedHash.toLowerCase();
}

export async function checkUpdate(
  serverUrl: string,
  request: CheckUpdateRequest
): Promise<CheckUpdateResponse> {
  const params = new URLSearchParams({
    appId: request.appId,
    platform: request.platform,
    runtimeVersion: request.runtimeVersion,
    channel: request.channel || 'production',
  });
  if (request.currentHash) {
    params.set('currentHash', request.currentHash);
  }

  const res = await fetch(`${serverUrl}/api/v1/updates/check?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Check update failed with status ${res.status}`);
  }
  return (await res.json()) as CheckUpdateResponse;
}
