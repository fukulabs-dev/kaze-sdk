import { describe, it, expect } from 'vitest';
import { verifyBundleChecksum, checkUpdate, computeSha256 } from '../src/updater';

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
});
