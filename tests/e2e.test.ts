import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import zlib from 'node:zlib';
import { createOTAController } from '../src/useOTA';
import { MemoryFileSystemAdapter } from '../src/staging';
import { computeSha256, reportUpdateStatus } from '../src/updater';
import { BootGuard } from '../src/guard';
import { MemoryStorage } from '../src/storage';

function createZipArchive(files: Record<string, string>): Uint8Array {
  interface Entry {
    nameBuf: Buffer;
    dataBuf: Buffer;
    compBuf: Buffer;
    lfh: Buffer;
    offset: number;
  }
  const entries: Entry[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name);
    const dataBuf = Buffer.from(content);
    const compBuf = zlib.deflateRawSync(dataBuf);

    const lfh = Buffer.alloc(30 + nameBuf.length);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0, 6);
    lfh.writeUInt16LE(8, 8);
    lfh.writeUInt16LE(0, 10);
    lfh.writeUInt16LE(0, 12);
    lfh.writeUInt32LE(0, 14);
    lfh.writeUInt32LE(compBuf.length, 18);
    lfh.writeUInt32LE(dataBuf.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);
    nameBuf.copy(lfh, 30);

    entries.push({ nameBuf, dataBuf, compBuf, lfh, offset });
    offset += lfh.length + compBuf.length;
  }

  const cdStart = offset;
  const cdBuffers: Buffer[] = [];
  for (const entry of entries) {
    const cdh = Buffer.alloc(46 + entry.nameBuf.length);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0, 8);
    cdh.writeUInt16LE(8, 10);
    cdh.writeUInt16LE(0, 12);
    cdh.writeUInt16LE(0, 14);
    cdh.writeUInt32LE(0, 16);
    cdh.writeUInt32LE(entry.compBuf.length, 20);
    cdh.writeUInt32LE(entry.dataBuf.length, 24);
    cdh.writeUInt16LE(entry.nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30);
    cdh.writeUInt16LE(0, 32);
    cdh.writeUInt16LE(0, 34);
    cdh.writeUInt16LE(0, 36);
    cdh.writeUInt32LE(0, 38);
    cdh.writeUInt32LE(entry.offset, 42);
    entry.nameBuf.copy(cdh, 46);
    cdBuffers.push(cdh);
    offset += cdh.length;
  }

  const cdSize = offset - cdStart;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);

  const parts: Buffer[] = [];
  for (const e of entries) {
    parts.push(e.lfh, e.compBuf);
  }
  parts.push(...cdBuffers, eocd);
  return new Uint8Array(Buffer.concat(parts));
}

describe('Live End-to-End OTA Integration', () => {
  let server: http.Server;
  let serverUrl: string;
  let receivedReports: Array<{ appId: string; releaseId: string; status: string }> = [];
  let updateAvailableState = true;

  const bundleJsCode = 'console.log("Kaze live bundle production v1.0.1");';
  const zipBytes = createZipArchive({
    'index.android.bundle': bundleJsCode,
  });
  const expectedHash = computeSha256(zipBytes);

  beforeAll(async () => {
    receivedReports = [];
    server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);

      if (url.pathname === '/api/v1/updates/check') {
        if (!updateAvailableState) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ updateAvailable: false }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            updateAvailable: true,
            manifest: {
              id: 'rel_live_test_101',
              appId: 'showcase',
              platform: 'android',
              runtimeVersion: '1.0.0',
              bundleHash: expectedHash,
              bundleUrl: `${serverUrl}/bundles/release.zip`,
              bundleSize: zipBytes.length,
              isMandatory: false,
              createdAt: '2026-10-15T12:00:00.000Z',
            },
          })
        );
        return;
      }

      if (url.pathname === '/bundles/release.zip') {
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Length': String(zipBytes.length),
        });
        res.end(Buffer.from(zipBytes));
        return;
      }

      if (url.pathname === '/api/v1/updates/report' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          const payload = JSON.parse(body);
          receivedReports.push(payload);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        });
        return;
      }

      res.writeHead(404);
      res.end('Not Found');
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as AddressInfo;
        serverUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('performs live update check, bundle download, SHA-256 verification, and staging', async () => {
    const fs = new MemoryFileSystemAdapter();
    const progressUpdates: number[] = [];
    let stagedManifestId: string | null = null;

    const controller = createOTAController({
      appId: 'showcase',
      serverUrl,
      platform: 'android',
      runtimeVersion: '1.0.0',
      channel: 'production',
      fileSystem: fs,
      onDownloadProgress: (p) => {
        progressUpdates.push(p);
      },
      onUpdateStaged: (manifest) => {
        stagedManifestId = manifest.id;
      },
    });

    // 1. Initial State
    expect(controller.getState().status).toBe('idle');
    expect(controller.getState().updateAvailable).toBe(false);

    // 2. Live HTTP Check
    const manifest = await controller.check();
    expect(manifest).not.toBeNull();
    expect(manifest?.bundleHash).toBe(expectedHash);
    expect(controller.getState().updateAvailable).toBe(true);

    // 3. Live Download and Staging
    const staged = await controller.downloadAndStage();
    expect(staged).toBe(true);
    expect(progressUpdates).toContain(100);
    expect(stagedManifestId).toBe('rel_live_test_101');
    expect(controller.getState().status).toBe('ready');

    // 4. Verify Staged Files in FileSystemAdapter
    const stagedBundle = await fs.readFile('ota/current/index.android.bundle');
    const stagedHash = await fs.readFile('ota/current/bundle.hash');
    expect(stagedBundle).toBe(bundleJsCode);
    expect(stagedHash).toBe(expectedHash);

    // 5. Send Telemetry Report over HTTP
    const reportRes = await reportUpdateStatus(serverUrl, {
      appId: 'showcase',
      releaseId: 'rel_live_test_101',
      deviceId: 'test_phone_001',
      status: 'installed',
    });
    expect(reportRes.success).toBe(true);
    expect(receivedReports).toHaveLength(2);
    expect(receivedReports[0]).toMatchObject({
      appId: 'showcase',
      releaseId: 'rel_live_test_101',
      status: 'staged',
    });
    expect(receivedReports[1]).toMatchObject({
      appId: 'showcase',
      releaseId: 'rel_live_test_101',
      status: 'installed',
    });

    // 6. Test BootGuard Watchdog Behavior
    const storage = new MemoryStorage();
    let rolledBackHash: string | null = null;
    const guard = new BootGuard({
      storage,
      stabilityTimeoutMs: 5000,
      onCrashRollback: (hash) => {
        rolledBackHash = hash;
      },
    });

    guard.onBundleBoot(expectedHash);
    expect(guard.isBundleTesting(expectedHash)).toBe(true);
    expect(guard.isBundleStable(expectedHash)).toBe(false);

    // Simulate fatal crash during boot window
    guard.recordCrash(expectedHash, 'Simulated fatal crash in React render');
    expect(rolledBackHash).toBe(expectedHash);
    expect(guard.isBundleBlacklisted(expectedHash)).toBe(true);
    expect(guard.getTestingBundle()).toBeNull();

    // 7. Verify Rollback behavior on subsequent check
    updateAvailableState = false;
    const checkAfterRollback = await controller.check();
    expect(checkAfterRollback).toBeNull();
    expect(controller.getState().updateAvailable).toBe(false);
  });
});
