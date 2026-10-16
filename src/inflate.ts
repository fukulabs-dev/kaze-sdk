/**
 * Pure TypeScript implementation of raw DEFLATE decompressor (RFC 1951).
 * Zero runtime dependencies, compatible with Hermes, JSC, V8, and browser engines.
 */

interface HuffmanTree {
  table: Map<number, number>;
  maxLen: number;
}

function buildHuffman(lengths: number[]): HuffmanTree {
  let maxLen = 0;
  for (let i = 0; i < lengths.length; i++) {
    if (lengths[i] > maxLen) maxLen = lengths[i];
  }
  const count = new Array(maxLen + 1).fill(0);
  for (let i = 0; i < lengths.length; i++) {
    const l = lengths[i];
    if (l > 0) count[l]++;
  }
  const nextCode = new Array(maxLen + 1).fill(0);
  let code = 0;
  for (let i = 1; i <= maxLen; i++) {
    code = (code + count[i - 1]) << 1;
    nextCode[i] = code;
  }
  const table = new Map<number, number>();
  for (let sym = 0; sym < lengths.length; sym++) {
    const len = lengths[sym];
    if (len > 0) {
      table.set((len << 16) | nextCode[len], sym);
      nextCode[len]++;
    }
  }
  return { table, maxLen };
}

const FIXED_LIT_LENGTHS = new Array(288);
for (let i = 0; i < 144; i++) FIXED_LIT_LENGTHS[i] = 8;
for (let i = 144; i < 256; i++) FIXED_LIT_LENGTHS[i] = 9;
for (let i = 256; i < 280; i++) FIXED_LIT_LENGTHS[i] = 7;
for (let i = 280; i < 288; i++) FIXED_LIT_LENGTHS[i] = 8;

const FIXED_LIT_TREE: HuffmanTree = buildHuffman(FIXED_LIT_LENGTHS);
const FIXED_DIST_TREE: HuffmanTree = buildHuffman(new Array(32).fill(5));

const LENS = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
const LEXT = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
const DISTS = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
const DEXT = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
const CL_ORDER = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];

export function inflateRaw(input: Uint8Array): Uint8Array {
  let bitBuf = 0;
  let bitLen = 0;
  let bytePos = 0;

  function readBits(n: number): number {
    while (bitLen < n) {
      if (bytePos >= input.length) {
        throw new Error('Unexpected EOF in deflate stream');
      }
      bitBuf |= input[bytePos++] << bitLen;
      bitLen += 8;
    }
    const val = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitLen -= n;
    return val;
  }

  function decodeSymbol(huffman: HuffmanTree): number {
    let curCode = 0;
    for (let len = 1; len <= huffman.maxLen; len++) {
      curCode = (curCode << 1) | readBits(1);
      const key = (len << 16) | curCode;
      const sym = huffman.table.get(key);
      if (sym !== undefined) {
        return sym;
      }
    }
    throw new Error('Invalid Huffman code in deflate stream');
  }

  const out: number[] = [];
  let bfinal = 0;

  while (!bfinal) {
    bfinal = readBits(1);
    const btype = readBits(2);
    if (btype === 0) {
      bitBuf = 0;
      bitLen = 0;
      const len = input[bytePos] | (input[bytePos + 1] << 8);
      bytePos += 4;
      for (let i = 0; i < len; i++) {
        out.push(input[bytePos++]);
      }
    } else {
      let litTree: HuffmanTree;
      let distTree: HuffmanTree;
      if (btype === 1) {
        litTree = FIXED_LIT_TREE;
        distTree = FIXED_DIST_TREE;
      } else if (btype === 2) {
        const hlit = readBits(5) + 257;
        const hdist = readBits(5) + 1;
        const hclen = readBits(4) + 4;
        const clLengths = new Array(19).fill(0);
        for (let i = 0; i < hclen; i++) {
          clLengths[CL_ORDER[i]] = readBits(3);
        }
        const clTree = buildHuffman(clLengths);
        const codeLengths: number[] = [];
        while (codeLengths.length < hlit + hdist) {
          const sym = decodeSymbol(clTree);
          if (sym < 16) {
            codeLengths.push(sym);
          } else if (sym === 16) {
            const repeat = readBits(2) + 3;
            const prev = codeLengths[codeLengths.length - 1];
            for (let r = 0; r < repeat; r++) codeLengths.push(prev);
          } else if (sym === 17) {
            const repeat = readBits(3) + 3;
            for (let r = 0; r < repeat; r++) codeLengths.push(0);
          } else if (sym === 18) {
            const repeat = readBits(7) + 11;
            for (let r = 0; r < repeat; r++) codeLengths.push(0);
          }
        }
        litTree = buildHuffman(codeLengths.slice(0, hlit));
        distTree = buildHuffman(codeLengths.slice(hlit));
      } else {
        throw new Error(`Unsupported deflate block type: ${btype}`);
      }

      while (true) {
        const sym = decodeSymbol(litTree);
        if (sym < 256) {
          out.push(sym);
        } else if (sym === 256) {
          break;
        } else {
          const lIdx = sym - 257;
          const matchLen = LENS[lIdx] + readBits(LEXT[lIdx]);
          const dSym = decodeSymbol(distTree);
          const matchDist = DISTS[dSym] + readBits(DEXT[dSym]);
          for (let k = 0; k < matchLen; k++) {
            out.push(out[out.length - matchDist]);
          }
        }
      }
    }
  }

  return new Uint8Array(out);
}
