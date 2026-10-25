/**
 * Tests for the header-only image sizer.
 *
 * Run with `npm test`. Each of the four header layouts a snapshot can hold is
 * built byte by byte here, so the sizer is pinned against the formats
 * themselves rather than against whatever encoder happened to be installed.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { imageSize } from "./image-size.ts";

const chars = (s: string) => [...s].map((c) => c.charCodeAt(0));
const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const le24 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
const le32 = (n: number) => [...le24(n), (n >>> 24) & 0xff];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];

const riff = (fourcc: string, chunk: number[]) =>
  new Uint8Array([
    ...chars("RIFF"),
    ...le32(4 + 8 + chunk.length),
    ...chars("WEBP"),
    ...chars(fourcc),
    ...le32(chunk.length),
    ...chunk,
  ]);

const png = (width: number, height: number) =>
  new Uint8Array([
    0x89, ...chars("PNG"), 0x0d, 0x0a, 0x1a, 0x0a,
    ...be32(13), ...chars("IHDR"), ...be32(width), ...be32(height),
    8, 6, 0, 0, 0,
  ]);

/** Lossy: 3-byte frame tag, the start code, then 14-bit width and height with 2 scale bits. */
const vp8 = (width: number, height: number) =>
  riff("VP8 ", [0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a, ...le16(width | 0x4000), ...le16(height), 0, 0, 0, 0]);

/** Lossless: the 0x2f signature, then width-1 and height-1 in 14 bits each. */
const vp8l = (width: number, height: number) => {
  const bits = (width - 1) | ((height - 1) << 14);
  return riff("VP8L", [0x2f, ...le32(bits), 0, 0, 0, 0]);
};

/** Extended: a flags byte, 3 reserved, then canvas width-1 and height-1 in 24 bits each. */
const vp8x = (width: number, height: number) =>
  riff("VP8X", [0x10, 0, 0, 0, ...le24(width - 1), ...le24(height - 1), 0, 0, 0, 0]);

test("reads each header a snapshot can hold", () => {
  assert.deepEqual(imageSize(png(1440, 9000)), { width: 1440, height: 9000 });
  assert.deepEqual(imageSize(vp8(1440, 3200)), { width: 1440, height: 3200 });
  assert.deepEqual(imageSize(vp8l(780, 16000)), { width: 780, height: 16000 });
  assert.deepEqual(imageSize(vp8x(1440, 16000)), { width: 1440, height: 16000 });
});

test("the lossy scale bits don't leak into the width", () => {
  // Bit 14 set above: a 2× upscaling hint, not 16384 more pixels.
  assert.equal(imageSize(vp8(1440, 100))?.width, 1440);
});

test("anything else is null", () => {
  assert.equal(imageSize(new Uint8Array()), null);
  assert.equal(imageSize(new Uint8Array(40)), null);
  assert.equal(imageSize(new Uint8Array(chars("GIF89a").concat(new Array(40).fill(0)))), null);
  // A RIFF that isn't WebP, and a WebP whose first chunk isn't a bitstream.
  const avi = riff("VP8 ", [0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a, ...le16(10), ...le16(10), 0, 0, 0, 0]);
  avi.set(chars("AVI "), 8);
  assert.equal(imageSize(avi), null);
  assert.equal(imageSize(riff("EXIF", new Array(14).fill(0))), null);
  // A lossy frame without its start code.
  assert.equal(imageSize(riff("VP8 ", [0x10, 0x02, 0x00, 0, 0, 0, ...le16(10), ...le16(10), 0, 0, 0, 0])), null);
  // Truncated before the dimensions.
  assert.equal(imageSize(png(10, 10).subarray(0, 20)), null);
});
