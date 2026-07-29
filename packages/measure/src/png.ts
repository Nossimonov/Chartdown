/**
 * A PNG decoder over `node:zlib` — the whole of this package's image input.
 *
 * Written rather than depended on, per ADR 0029. Image decoders are among the
 * most CVE-prone libraries in any ecosystem because their job is parsing
 * hostile binary from strangers, and this tool's input is "a satellite image
 * you downloaded". Decoding PNG is chunk parsing, one inflate that Node
 * already provides, and five per-scanline filters — a few hundred lines of
 * ordinary array work with nothing third-party between a stranger's file and
 * the user's machine.
 *
 * Formats we can decline are declined BY NAME. A baseline JPEG decoder is real
 * engineering, and no format worth one line of "convert it first" is worth the
 * risk surface. The same goes for interlacing and exotic bit depths: refused
 * with the reason, never half-supported.
 */

import { inflateSync } from "node:zlib";

/** Straight RGBA, four bytes per pixel, top-left origin. */
export interface Raster {
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * Bounds checked BEFORE anything is allocated (ADR 0029 rule 2).
 *
 * A decompression bomb is a denial of service in JavaScript exactly as in C —
 * the header is written by whoever supplied the file, so a header claiming
 * 60000x60000 must be refused rather than believed and multiplied.
 */
export interface Limits {
  maxDimension: number;
  maxPixels: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxDimension: 30_000,
  maxPixels: 120_000_000,
};

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Channel count per PNG colour type; `undefined` where we decline the type. */
const CHANNELS: Record<number, number | undefined> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array, from: number, to: number): number {
  let c = 0xffffffff;
  for (let i = from; i < to; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** A failure an author can act on: what was wrong, and what to do about it. */
export class ImageError extends Error {}

const read32 = (b: Uint8Array, at: number): number =>
  ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;

export function decodePng(bytes: Uint8Array, limits: Limits = DEFAULT_LIMITS): Raster {
  if (bytes.length < 8 || SIGNATURE.some((v, i) => bytes[i] !== v)) {
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
    throw new ImageError(
      jpeg
        ? "this is a JPEG. This tool reads PNG only — convert it first (for example `magick in.jpg out.png`). A JPEG decoder is a large piece of binary parsing, and a format we can decline is not worth the risk it would add (ADR 0029)"
        : "not a PNG: the file does not begin with the PNG signature",
    );
  }

  let width = 0;
  let height = 0;
  let channels = 0;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  let seenHeader = false;

  let at = 8;
  while (at + 8 <= bytes.length) {
    const length = read32(bytes, at);
    if (length > 0x7fffffff || at + 12 + length > bytes.length) {
      throw new ImageError("PNG is truncated or a chunk length is impossible — the file is corrupt");
    }
    const type = String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!);
    const from = at + 8;
    const to = from + length;
    // Verified, so a corrupt file is REPORTED rather than silently measured.
    // A garbled coastline that renders is the exact failure this project keeps
    // finding: plausible, wrong, and nothing said so.
    if (crc32(bytes, at + 4, to) !== read32(bytes, to)) {
      throw new ImageError(`PNG chunk '${type}' fails its checksum — the file is corrupt`);
    }

    if (type === "IHDR") {
      width = read32(bytes, from);
      height = read32(bytes, from + 4);
      const depth = bytes[from + 8]!;
      const colour = bytes[from + 9]!;
      const interlace = bytes[from + 12]!;
      // EVERY BOUND BEFORE EVERY ALLOCATION.
      if (width <= 0 || height <= 0) throw new ImageError("PNG declares a zero dimension");
      if (width > limits.maxDimension || height > limits.maxDimension) {
        throw new ImageError(`PNG is ${width}x${height}, beyond the ${limits.maxDimension} limit per side. Crop or downsample it first`);
      }
      if (width * height > limits.maxPixels) {
        throw new ImageError(`PNG is ${width}x${height} — ${(width * height / 1e6).toFixed(0)} megapixels, beyond the ${(limits.maxPixels / 1e6).toFixed(0)} limit. Crop or downsample it first`);
      }
      if (depth !== 8) {
        throw new ImageError(`PNG is ${depth} bits per channel; this tool reads 8. Convert it (for example \`magick in.png -depth 8 out.png\`)`);
      }
      if (interlace !== 0) {
        throw new ImageError("PNG is interlaced (Adam7); this tool reads non-interlaced only. Re-save it without interlacing");
      }
      const c = CHANNELS[colour];
      if (c === undefined) throw new ImageError(`PNG colour type ${colour} is not one this tool reads`);
      channels = c;
      seenHeader = true;
    } else if (type === "PLTE") {
      palette = bytes.subarray(from, to);
    } else if (type === "tRNS") {
      transparency = bytes.subarray(from, to);
    } else if (type === "IDAT") {
      idat.push(bytes.subarray(from, to));
    } else if (type === "IEND") {
      break;
    }
    at = to + 4;
  }

  if (!seenHeader) throw new ImageError("PNG has no IHDR chunk — the file is corrupt");
  if (idat.length === 0) throw new ImageError("PNG carries no image data");

  const stride = width * channels;
  // The inflated size is known EXACTLY from the header: one filter byte per
  // scanline plus its pixels. Handing that to zlib as a ceiling means a bomb is
  // refused by the decompressor rather than by us noticing afterwards.
  const expected = height * (stride + 1);
  const joined = idat.length === 1 ? idat[0]! : Buffer.concat(idat.map((c) => Buffer.from(c)));
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.from(joined), { maxOutputLength: expected });
  } catch (cause) {
    throw new ImageError(
      `PNG image data will not decompress to the ${width}x${height} it declares — the file is corrupt, or its header disagrees with its contents (${(cause as Error).message})`,
    );
  }
  if (raw.length < expected) throw new ImageError("PNG image data is shorter than its header declares — the file is truncated");

  // Undo the per-scanline filters in place, then widen to RGBA.
  const out = new Uint8Array(width * height * 4);
  const line = new Uint8Array(stride);
  const prior = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const base = y * (stride + 1);
    const filter = raw[base]!;
    for (let i = 0; i < stride; i++) {
      const x = raw[base + 1 + i]!;
      const a = i >= channels ? line[i - channels]! : 0;
      const b = prior[i]!;
      const c = i >= channels ? prior[i - channels]! : 0;
      line[i] = (filter === 0 ? x
        : filter === 1 ? x + a
          : filter === 2 ? x + b
            : filter === 3 ? x + ((a + b) >> 1)
              : filter === 4 ? x + paeth(a, b, c)
                : NaN) & 0xff;
      if (filter > 4) throw new ImageError(`PNG scanline ${y} uses filter ${filter}, which does not exist — the file is corrupt`);
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (channels === 3 || channels === 4) {
        out[o] = line[x * channels]!;
        out[o + 1] = line[x * channels + 1]!;
        out[o + 2] = line[x * channels + 2]!;
        out[o + 3] = channels === 4 ? line[x * channels + 3]! : 255;
      } else if (palette) {
        const index = line[x]!;
        out[o] = palette[index * 3] ?? 0;
        out[o + 1] = palette[index * 3 + 1] ?? 0;
        out[o + 2] = palette[index * 3 + 2] ?? 0;
        out[o + 3] = transparency?.[index] ?? 255;
      } else {
        const grey = line[x * channels]!;
        out[o] = grey;
        out[o + 1] = grey;
        out[o + 2] = grey;
        out[o + 3] = channels === 2 ? line[x * channels + 1]! : 255;
      }
    }
    prior.set(line);
  }
  return { width, height, data: out };
}
