import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const deflate = promisify(zlib.deflate);
const outDir = path.resolve('public/icons');

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (const b of bytes) {
    c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([len, typeBytes, data, crc]);
};

const color = (hex) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
};

const mix = (bg, fg, alpha) => [
  Math.round(bg[0] * (1 - alpha) + fg[0] * alpha),
  Math.round(bg[1] * (1 - alpha) + fg[1] * alpha),
  Math.round(bg[2] * (1 - alpha) + fg[2] * alpha),
  255,
];

const inRoundedRect = (x, y, left, top, width, height, radius) => {
  const right = left + width;
  const bottom = top + height;
  if (x < left || x >= right || y < top || y >= bottom) return false;
  const cx = x < left + radius ? left + radius : x >= right - radius ? right - radius - 1 : x;
  const cy = y < top + radius ? top + radius : y >= bottom - radius ? bottom - radius - 1 : y;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
};

const inHeart = (x, y, cx, cy, scale) => {
  const nx = (x - cx) / scale;
  const ny = -(y - cy) / scale;
  const v = nx * nx + ny * ny - 1;
  return v * v * v - nx * nx * ny * ny * ny <= 0;
};

const writePng = async (target, size, maskable = false) => {
  const width = size;
  const height = size;
  const scale = size / 512;
  const rgba = Buffer.alloc(width * height * 4);
  const bg = maskable ? color('#FF9EB5') : color('#FFF9FA');
  const pink = color('#FF9EB5');
  const deepPink = color('#FF7090');
  const pale = color('#FFF0F3');
  const white = color('#FFFFFF');
  const yellow = color('#FFE5A0');
  const blue = color('#A0E1E8');
  const green = color('#A7E8BD');

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const ux = x / scale;
      const uy = y / scale;
      let px = bg;

      if (maskable) {
        const dots = [
          [92, 96, 40, pale, 0.72],
          [430, 116, 48, blue, 0.72],
          [92, 414, 44, yellow, 0.72],
          [420, 408, 38, green, 0.72],
        ];
        for (const [cx, cy, r, c, alpha] of dots) {
          const dx = ux - cx;
          const dy = uy - cy;
          if (dx * dx + dy * dy <= r * r) px = mix(px, c, alpha);
        }
        if (inRoundedRect(ux, uy, 96, 88, 320, 336, 80)) px = color('#FFF9FA');
        if (inRoundedRect(ux, uy, 130, 122, 252, 252, 56)) px = white;
        const dx = ux - 206;
        const dy = uy - 198;
        if (dx * dx + dy * dy <= 44 * 44) px = yellow;
        if (uy > 315 - Math.sin((ux - 140) / 38) * 18 && inRoundedRect(ux, uy, 128, 254, 290, 114, 28)) px = pink;
        if (inHeart(ux, uy, 298, 182, 38)) px = deepPink;
      } else {
        if (inRoundedRect(ux, uy, 48, 48, 416, 416, 96)) px = pink;
        const dx = ux - 184;
        const dy = uy - 184;
        if (dx * dx + dy * dy <= 54 * 54) px = yellow;
        if (uy > 344 - Math.sin((ux - 110) / 44) * 22 && inRoundedRect(ux, uy, 80, 238, 376, 178, 36)) px = white;
        if (inHeart(ux, uy, 296, 178, 54)) px = deepPink;
        if (inHeart(ux, uy, 316, 164, 36)) px = pale;
      }

      const i = (y * width + x) * 4;
      rgba[i] = px[0];
      rgba[i + 1] = px[1];
      rgba[i + 2] = px[2];
      rgba[i + 3] = px[3];
    }
  }

  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', await deflate(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  await fs.writeFile(target, png);
};

await fs.mkdir(outDir, { recursive: true });
await writePng(path.join(outDir, 'icon-192.png'), 192);
await writePng(path.join(outDir, 'icon-512.png'), 512);
await writePng(path.join(outDir, 'maskable-512.png'), 512, true);
await writePng(path.join(outDir, 'apple-touch-icon.png'), 180);

console.log('PWA icons generated.');
