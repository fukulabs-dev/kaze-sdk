import zlib from 'node:zlib';

/** Builds a deflate zip archive in memory, the format OTA bundles are served in. */
export function createTestZip(files: Record<string, string>): Uint8Array {
  interface ZipEntry {
    name: string;
    nameBuf: Buffer;
    dataBuf: Buffer;
    compBuf: Buffer;
    lfh: Buffer;
    offset: number;
  }
  const fileEntries: ZipEntry[] = [];
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

    fileEntries.push({ name, nameBuf, dataBuf, compBuf, lfh, offset });
    offset += lfh.length + compBuf.length;
  }

  const cdStart = offset;
  const cdBuffers: Buffer[] = [];
  for (const entry of fileEntries) {
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
  eocd.writeUInt16LE(fileEntries.length, 8);
  eocd.writeUInt16LE(fileEntries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);

  const parts: Buffer[] = [];
  for (const e of fileEntries) {
    parts.push(e.lfh, e.compBuf);
  }
  parts.push(...cdBuffers, eocd);
  return new Uint8Array(Buffer.concat(parts));
}
