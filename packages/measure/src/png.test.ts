/**
 * The decoder is checked against PNGs built here, with an independently
 * written CRC and encoder — sharing the implementation's would let a bug in
 * either agree with itself.
 */
import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { decodePng, ImageError } from "./png";

const crc = (bytes: Uint8Array): number => {
  let c = ~0;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
};

const be32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

const chunk = (type: string, data: number[]): number[] => {
  const body = [...[...type].map((ch) => ch.charCodeAt(0)), ...data];
  return [...be32(data.length), ...body, ...be32(crc(Uint8Array.from(body)))];
};

interface Options { colour?: number; filter?: number; interlace?: number; depth?: number; palette?: number[] }

/** Build a PNG from raw samples, `channels` per pixel, applying one filter. */
const png = (w: number, h: number, samples: number[], channels: number, o: Options = {}): Uint8Array => {
  const filter = o.filter ?? 0;
  const stride = w * channels;
  const raw: number[] = [];
  for (let y = 0; y < h; y++) {
    raw.push(filter);
    for (let i = 0; i < stride; i++) {
      const x = samples[y * stride + i]!;
      const a = i >= channels ? samples[y * stride + i - channels]! : 0;
      const b = y > 0 ? samples[(y - 1) * stride + i]! : 0;
      const c = y > 0 && i >= channels ? samples[(y - 1) * stride + i - channels]! : 0;
      const pae = (): number => {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      };
      raw.push((filter === 0 ? x : filter === 1 ? x - a : filter === 2 ? x - b
        : filter === 3 ? x - ((a + b) >> 1) : x - pae()) & 0xff);
    }
  }
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk("IHDR", [...be32(w), ...be32(h), o.depth ?? 8, o.colour ?? 2, 0, 0, o.interlace ?? 0]),
    ...(o.palette ? chunk("PLTE", o.palette) : []),
    ...chunk("IDAT", [...deflateSync(Buffer.from(raw))]),
    ...chunk("IEND", []),
  ]);
};

const RGB = [
  255, 0, 0, 0, 255, 0,
  0, 0, 255, 255, 255, 255,
];

describe("decoding a PNG", () => {
  it("reads an 8-bit RGB image", () => {
    const out = decodePng(png(2, 2, RGB, 3));
    expect(out.width).toBe(2);
    expect(out.height).toBe(2);
    expect([...out.data.slice(0, 8)]).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
  });

  it("undoes every scanline filter to the same image", () => {
    // Sub, Up, Average and Paeth must all reconstruct what None gives.
    const expected = [...decodePng(png(2, 2, RGB, 3, { filter: 0 })).data];
    for (const filter of [1, 2, 3, 4]) {
      expect([...decodePng(png(2, 2, RGB, 3, { filter })).data], `filter ${filter}`).toEqual(expected);
    }
  });

  it("widens greyscale and palette to the same RGBA shape", () => {
    const grey = decodePng(png(2, 1, [0, 128], 1, { colour: 0 }));
    expect([...grey.data]).toEqual([0, 0, 0, 255, 128, 128, 128, 255]);
    const indexed = decodePng(png(2, 1, [1, 0], 1, { colour: 3, palette: [9, 9, 9, 7, 7, 7] }));
    expect([...indexed.data]).toEqual([7, 7, 7, 255, 9, 9, 9, 255]);
  });

  it("reads RGBA, keeping alpha", () => {
    const out = decodePng(png(1, 1, [10, 20, 30, 40], 4, { colour: 6 }));
    expect([...out.data]).toEqual([10, 20, 30, 40]);
  });
});

describe("a file we will not read is declined by name (ADR 0029)", () => {
  it("names JPEG and the fix, rather than failing obscurely", () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0]);
    expect(() => decodePng(jpeg)).toThrow(/JPEG/);
    expect(() => decodePng(jpeg)).toThrow(/convert it first/);
  });

  it("refuses interlacing rather than decoding it wrongly", () => {
    expect(() => decodePng(png(2, 2, RGB, 3, { interlace: 1 }))).toThrow(/interlaced/);
  });

  it("refuses a bit depth it does not read", () => {
    expect(() => decodePng(png(2, 2, RGB, 3, { depth: 16 }))).toThrow(/bits per channel/);
  });
});

describe("hostile input is refused before it is believed (ADR 0029)", () => {
  it("refuses a header claiming more pixels than the limit, without allocating", () => {
    // The image data is two bytes; only the HEADER claims to be enormous. A
    // decoder that trusts it multiplies 60000 by 60000 and asks for 14GB.
    const lying = png(2, 2, RGB, 3);
    const header = 8 + 8;
    lying.set(Uint8Array.from(be32(60_000)), header);
    lying.set(Uint8Array.from(be32(60_000)), header + 4);
    // The CRC no longer matches, which is itself a refusal — so assert the
    // bound directly too, with a well-formed oversized header.
    expect(() => decodePng(lying)).toThrow(ImageError);
    expect(() => decodePng(png(2, 2, RGB, 3), { maxDimension: 1, maxPixels: 1 })).toThrow(/beyond the 1 limit per side/);
    expect(() => decodePng(png(2, 2, RGB, 3), { maxDimension: 10, maxPixels: 1 })).toThrow(/megapixels/);
  });

  it("catches a corrupt chunk rather than measuring garbage", () => {
    const broken = png(2, 2, RGB, 3);
    broken[30] = broken[30]! ^ 0xff;
    expect(() => decodePng(broken)).toThrow(/checksum|corrupt/);
  });

  it("rejects a truncated file", () => {
    expect(() => decodePng(png(2, 2, RGB, 3).slice(0, 30))).toThrow(ImageError);
  });
});
