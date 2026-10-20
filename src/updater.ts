import { computeSha256 } from './sha256';
import { CheckUpdateResponseSchema } from './types';
import type { CheckUpdateRequest, CheckUpdateResponse, ReportUpdateRequest } from './types';

export { computeSha256 };

export function verifyBundleChecksum(data: Uint8Array | ArrayBuffer | string, expectedHash: string): boolean {
  const actual = computeSha256(data);
  return actual.toLowerCase() === expectedHash.toLowerCase();
}

export async function checkUpdate(
  serverUrl: string,
  request: CheckUpdateRequest,
  fetchFn: typeof fetch = fetch
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
  if (request.deviceId) {
    params.set('deviceId', request.deviceId);
  }
  if (request.clientUuid) {
    params.set('clientUuid', request.clientUuid);
  }

  const res = await fetchFn(`${serverUrl}/api/v1/updates/check?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Check update failed with status ${res.status}`);
  }
  const parsed = CheckUpdateResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Invalid check update response: ${issue.path.join('.') || 'body'}: ${issue.message}`);
  }
  const data = parsed.data;
  if (data.updateAvailable && data.manifest) {
    if (data.manifest.platform !== request.platform) {
      throw new Error(`Server offered a ${data.manifest.platform} bundle to a ${request.platform} client`);
    }
    if (data.manifest.runtimeVersion !== request.runtimeVersion) {
      throw new Error(
        `Server offered a bundle for runtime ${data.manifest.runtimeVersion}, client runs ${request.runtimeVersion}`
      );
    }
  }
  return data;
}

interface ReadableStreamReaderLike {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
}

export async function downloadBundle(
  url: string,
  onProgress?: (percent: number, loaded: number, total: number) => void,
  fetchFn: typeof fetch = fetch
): Promise<Uint8Array> {
  const res = await fetchFn(url);
  if (!res.ok) {
    throw new Error(`Download bundle failed with status ${res.status}`);
  }

  const contentLengthHeader = res.headers?.get?.('content-length');
  const total = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;
  const body = res.body;

  if (body && typeof body === 'object' && 'getReader' in body && typeof body.getReader === 'function') {
    const candidate = body.getReader();
    if (candidate && typeof candidate === 'object' && 'read' in candidate && typeof candidate.read === 'function') {
      const reader = candidate as ReadableStreamReaderLike;
      const chunks: Uint8Array[] = [];
      let loaded = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          loaded += value.length;
          if (total > 0 && onProgress) {
            const percent = Math.min(100, Math.round((loaded / total) * 100));
            onProgress(percent, loaded, total);
          }
        }
      }

      const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      onProgress?.(100, totalLength, totalLength);
      return result;
    }
  }

  const buf = await res.arrayBuffer();
  const result = new Uint8Array(buf);
  onProgress?.(100, result.length, result.length);
  return result;
}

export async function reportUpdateStatus(
  serverUrl: string,
  request: ReportUpdateRequest,
  fetchFn: typeof fetch = fetch
): Promise<{ success: boolean }> {
  const res = await fetchFn(`${serverUrl}/api/v1/updates/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    throw new Error(`Report update status failed with status ${res.status}`);
  }
  return (await res.json()) as { success: boolean };
}
