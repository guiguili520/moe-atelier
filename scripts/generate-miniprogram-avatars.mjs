// 生成一组可爱默认头像（纯 Node 手写 PNG，无三方依赖，4x 超采样抗锯齿）。
// 输出到 platforms/wechat-miniprogram/assets/avatars/avatar-1.png ... avatar-6.png
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const deflate = promisify(zlib.deflate);
const outDir = path.resolve('platforms/wechat-miniprogram/assets/avatars');

const SIZE = 144;
const SS = 4;

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const tb = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
  return Buffer.concat([len, tb, data, crc]);
};
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

const EYE = rgb('#5d4037');
const BLUSH = rgb('#ff9ab0');
const PASTELS = ['#ffd0dc', '#cdeffd', '#cdeecb', '#fff0b3', '#e6dcff', '#ffe0c2'];

const inCircle = (x, y, cx, cy, r) => { const dx = x - cx, dy = y - cy; return dx * dx + dy * dy <= r * r; };

// 返回某子像素的 RGBA（圆外透明）
const sample = (x, y, bg) => {
  if (!inCircle(x, y, 72, 72, 62)) return null;
  if (inCircle(x, y, 72, 82, 6) && y >= 82) return EYE;          // 嘴（下半圆）
  if (inCircle(x, y, 54, 66, 7) || inCircle(x, y, 90, 66, 7)) return EYE; // 眼
  if (inCircle(x, y, 44, 84, 9) || inCircle(x, y, 100, 84, 9)) return BLUSH; // 腮红
  return bg;
};

const renderAvatar = async (target, pastelHex) => {
  const bg = rgb(pastelHex);
  const data = Buffer.alloc(SIZE * SIZE * 4);
  for (let oy = 0; oy < SIZE; oy += 1) {
    for (let ox = 0; ox < SIZE; ox += 1) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const px = sample(ox + (sx + 0.5) / SS, oy + (sy + 0.5) / SS, bg);
          if (px) { r += px[0]; g += px[1]; b += px[2]; a += 255; }
        }
      }
      const n = SS * SS;
      const i = (oy * SIZE + ox) * 4;
      const cov = a / (255 * n);
      data[i] = cov ? Math.round(r / (n * cov)) : 0;
      data[i + 1] = cov ? Math.round(g / (n * cov)) : 0;
      data[i + 2] = cov ? Math.round(b / (n * cov)) : 0;
      data[i + 3] = Math.round(a / n);
    }
  }
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    raw[y * (SIZE * 4 + 1)] = 0;
    data.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4); ihdr[8] = 8; ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', await deflate(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
  await fs.writeFile(target, png);
};

await fs.mkdir(outDir, { recursive: true });
for (let i = 0; i < PASTELS.length; i += 1) {
  await renderAvatar(path.join(outDir, `avatar-${i + 1}.png`), PASTELS[i]);
}
console.log('avatars generated:', outDir);
