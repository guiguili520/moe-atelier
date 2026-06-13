// 生成微信小程序底部 tabBar 图标（纯 Node，无三方依赖）。
// 微信原生 tabBar 只接受本地 PNG（不支持 SVG），且需正常态 + 选中态各一张。
// 输出 81x81 透明 PNG 到 platforms/wechat-miniprogram/assets/tabbar/，带 4x 超采样抗锯齿。
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const deflate = promisify(zlib.deflate);
const outDir = path.resolve('platforms/wechat-miniprogram/assets/tabbar');

const SIZE = 81;       // 微信建议尺寸
const SS = 4;          // 超采样倍数（抗锯齿）
const VIEW = 24;       // 图标坐标系（feather 风格 24 单位）

// ---- PNG 编码（取自 generate-pwa-icons.mjs 的同款手写实现）----
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
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

const hexRgb = (hex) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// ---- 形状覆盖函数（24 单位坐标系）----
const inRoundedRect = (x, y, left, top, w, h, r) => {
  const right = left + w;
  const bottom = top + h;
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = x < left + r ? left + r : x > right - r ? right - r : x;
  const cy = y < top + r ? top + r : y > bottom - r ? bottom - r : y;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
};

const inCircle = (x, y, cx, cy, r) => {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
};

// 广场：2x2 圆角方格（提示词广场/画廊）
const inPlaza = (x, y) => (
  inRoundedRect(x, y, 3.5, 3.5, 7, 7, 1.8) ||
  inRoundedRect(x, y, 13.5, 3.5, 7, 7, 1.8) ||
  inRoundedRect(x, y, 3.5, 13.5, 7, 7, 1.8) ||
  inRoundedRect(x, y, 13.5, 13.5, 7, 7, 1.8)
);

// 我的：实心人物剪影（头 + 肩部圆顶）
const inUser = (x, y) => {
  if (inCircle(x, y, 12, 8.8, 4.4)) return true;           // 头
  if (y <= 20.5 && inCircle(x, y, 12, 21.5, 8)) return true; // 肩
  return false;
};

const renderPng = async (target, coverageFn, hex) => {
  const [r, g, b] = hexRgb(hex);
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  const unit = VIEW / SIZE; // 输出像素 → 单位坐标
  for (let oy = 0; oy < SIZE; oy += 1) {
    for (let ox = 0; ox < SIZE; ox += 1) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const ux = (ox + (sx + 0.5) / SS) * unit;
          const uy = (oy + (sy + 0.5) / SS) * unit;
          if (coverageFn(ux, uy)) hit += 1;
        }
      }
      const alpha = Math.round((hit / (SS * SS)) * 255);
      const i = (oy * SIZE + ox) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = alpha;
    }
  }

  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    raw[y * (SIZE * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA

  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', await deflate(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  await fs.writeFile(target, png);
};

const NORMAL = '#8d6e63';
const ACTIVE = '#ff9eb5';

await fs.mkdir(outDir, { recursive: true });
await renderPng(path.join(outDir, 'plaza.png'), inPlaza, NORMAL);
await renderPng(path.join(outDir, 'plaza-active.png'), inPlaza, ACTIVE);
await renderPng(path.join(outDir, 'me.png'), inUser, NORMAL);
await renderPng(path.join(outDir, 'me-active.png'), inUser, ACTIVE);

console.log('miniprogram tabBar icons generated:', outDir);
