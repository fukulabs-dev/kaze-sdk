import { computeSha256 } from './sha256';
import { CheckUpdateResponseSchema } from './types';
import type { CheckUpdateRequest, CheckUpdateResponse, ReportUpdateRequest } from './types';

export { computeSha256 };

export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
export const DEFAULT_DOWNLOAD_TIMEOUT_MS = 120_000;
export const DEFAULT_DOWNLOAD_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 1_000;

export interface RequestOptions {
  /** Abort the request after this many milliseconds. 0 disables the timeout. */
  timeoutMs?: number;
}

export interface DownloadOptions extends RequestOptions {
  /** Extra attempts after a network error, timeout, or 5xx/408/429 response. */
  retries?: number;
  /** Delay before the first retry; doubles on each further retry. */
  retryDelayMs?: number;
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

export class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'HttpError';
  }
}

// Races `run` against a timer that also aborts the request, so a server that stops responding
// (or a fetch implementation that ignores the signal) can't leave the caller waiting forever.
async function withTimeout<T>(
  timeoutMs: number,
  what: string,
  run: (signal: AbortSignal | undefined) => Promise<T>
): Promise<T> {
  if (!(timeoutMs > 0)) {
    return run(undefined);
  }
  const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();
      reject(new TimeoutError(`${what} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller?.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function isRetryable(err: unknown): boolean {
  if (err instanceof HttpError) {
    return err.status >= 500 || err.status === 408 || err.status === 429;
  }
  return true;
}

export function verifyBundleChecksum(data: Uint8Array | ArrayBuffer | string, expectedHash: string): boolean {
  const actual = computeSha256(data);
  return actual.toLowerCase() === expectedHash.toLowerCase();
}

export async function checkUpdate(
  serverUrl: string,
  request: CheckUpdateRequest,
  fetchFn: typeof fetch = fetch,
  options: RequestOptions = {}
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

  const body = await withTimeout(options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS, 'Check update', async (signal) => {
    const res = await fetchFn(`${serverUrl}/api/v1/updates/check?${params.toString()}`, { signal });
    if (!res.ok) {
      throw new HttpError(`Check update failed with status ${res.status}`, res.status);
    }
    return res.json();
  });
  const parsed = CheckUpdateResponseSchema.safeParse(body);
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
  fetchFn: typeof fetch = fetch,
  options: DownloadOptions = {}
): Promise<Uint8Array> {
  const retries = Math.max(0, options.retries ?? DEFAULT_DOWNLOAD_RETRIES);
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      return await withTimeout(options.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS, 'Download bundle', (signal) =>
        downloadOnce(url, onProgress, fetchFn, signal)
      );
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs * 2 ** attempt));
    }
  }
}

async function downloadOnce(
  url: string,
  onProgress: ((percent: number, loaded: number, total: number) => void) | undefined,
  fetchFn: typeof fetch,
  signal: AbortSignal | undefined
): Promise<Uint8Array> {
  const res = await fetchFn(url, { signal });
  if (!res.ok) {
    throw new HttpError(`Download bundle failed with status ${res.status}`, res.status);
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
  fetchFn: typeof fetch = fetch,
  options: RequestOptions = {}
): Promise<{ success: boolean }> {
  return withTimeout(options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS, 'Report update status', async (signal) => {
    const res = await fetchFn(`${serverUrl}/api/v1/updates/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
    if (!res.ok) {
      throw new HttpError(`Report update status failed with status ${res.status}`, res.status);
    }
    return (await res.json()) as { success: boolean };
  });
}
