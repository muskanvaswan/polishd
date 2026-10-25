/**
 * Polishd — the pixel size of a stored image, read from its header.
 *
 * A snapshot's full-page shot can be 12,000 pixels tall, and a model
 * provider has a ceiling on what it accepts (Anthropic refuses an edge over
 * 8,000px). Nothing here decodes pixels: the two formats a snapshot stores
 * (WebP from the capture core, PNG from snapshots taken before it) both put
 * their dimensions in the first few dozen bytes. Pure, so the test can pin
 * each header layout without an image on disk.
 */

export interface ImageSize {
  width: number;
  height: number;
}

const ascii = (bytes: Uint8Array, at: number, len: number): string =>
  String.fromCharCode(...bytes.subarray(at, at + len));

const le16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const le24 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
const be32 = (b: Uint8Array, at: number) =>
  ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;

/** The image's size, or null when the bytes aren't a WebP or PNG header. */
export function imageSize(bytes: Uint8Array): ImageSize | null {
  const size = pngSize(bytes) ?? webpSize(bytes);
  return size && size.width > 0 && size.height > 0 ? size : null;
}

/** PNG: an 8-byte signature, then the IHDR chunk with width and height big-endian. */
function pngSize(b: Uint8Array): ImageSize | null {
  if (b.length < 24) return null;
  if (b[0] !== 0x89 || ascii(b, 1, 3) !== "PNG" || ascii(b, 12, 4) !== "IHDR") return null;
  return { width: be32(b, 16), height: be32(b, 20) };
}

/**
 * WebP: a RIFF container whose first chunk is one of three bitstreams. Lossy
 * `VP8 ` keeps 14-bit dimensions after its start code; lossless `VP8L` packs
 * both, minus one, into 28 bits after its signature byte; extended `VP8X`
 * (alpha, animation, metadata) states the canvas, minus one, as two 24-bit
 * values.
 */
function webpSize(b: Uint8Array): ImageSize | null {
  if (b.length < 16 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") return null;
  switch (ascii(b, 12, 4)) {
    case "VP8 ":
      if (b.length < 30 || b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
      return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };
    case "VP8L": {
      if (b.length < 25 || b[20] !== 0x2f) return null;
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    case "VP8X":
      if (b.length < 30) return null;
      return { width: le24(b, 24) + 1, height: le24(b, 27) + 1 };
    default:
      return null;
  }
}
