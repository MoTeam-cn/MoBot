import zlib from "node:zlib";

/**
 * 极简 PNG 编码器（RGBA，8bit，无滤波）+ 5x7 点阵字体，
 * 用来在没有原生依赖的情况下生成图像验证码。
 */

const CRC_TABLE = (() => {
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

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // color type RGBA
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface Canvas {
  width: number;
  height: number;
  data: Uint8Array;
}

export function createCanvas(width: number, height: number, color: Rgba): Canvas {
  const data = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = color.r;
    data[index * 4 + 1] = color.g;
    data[index * 4 + 2] = color.b;
    data[index * 4 + 3] = color.a;
  }
  return { width, height, data };
}

export function setPixel(canvas: Canvas, x: number, y: number, color: Rgba): void {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
  const offset = (y * canvas.width + x) * 4;
  canvas.data[offset] = color.r;
  canvas.data[offset + 1] = color.g;
  canvas.data[offset + 2] = color.b;
  canvas.data[offset + 3] = color.a;
}

export function fillRect(canvas: Canvas, x: number, y: number, w: number, h: number, color: Rgba): void {
  for (let dy = 0; dy < h; dy += 1) {
    for (let dx = 0; dx < w; dx += 1) setPixel(canvas, x + dx, y + dy, color);
  }
}

export function drawLine(canvas: Canvas, x0: number, y0: number, x1: number, y1: number, color: Rgba): void {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const endX = Math.round(x1);
  const endY = Math.round(y1);
  const dx = Math.abs(endX - x);
  const dy = Math.abs(endY - y);
  const sx = x < endX ? 1 : -1;
  const sy = y < endY ? 1 : -1;
  let err = dx - dy;
  for (let guard = 0; guard < 4000; guard += 1) {
    setPixel(canvas, x, y, color);
    if (x === endX && y === endY) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

/** 5x7 点阵字体 */
export const FONT: Record<string, string[]> = {
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11100", "10010", "10001", "10001", "10001", "10010", "11100"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
};

/** 简单线性同余随机数，seed 固定时输出可复现（方便测试） */
function createRng(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

export function drawText(
  canvas: Canvas,
  text: string,
  x: number,
  y: number,
  scale: number,
  color: Rgba,
  letterSpacing = 1,
): void {
  let cursor = x;
  for (const raw of text.toUpperCase()) {
    const glyph = FONT[raw];
    if (!glyph) {
      cursor += (5 + letterSpacing) * scale;
      continue;
    }
    glyph.forEach((row, rowIndex) => {
      for (let col = 0; col < row.length; col += 1) {
        if (row[col] === "1") {
          fillRect(canvas, cursor + col * scale, y + rowIndex * scale, scale, scale, color);
        }
      }
    });
    cursor += (5 + letterSpacing) * scale;
  }
}

export interface RenderOptions {
  scale?: number;
  padding?: number;
  noiseLines?: number;
  noiseDots?: number;
  seed?: number;
}

export function renderCaptcha(code: string, options: RenderOptions = {}): Buffer {
  const scale = options.scale ?? 6;
  const padding = options.padding ?? 12;
  const noiseLines = options.noiseLines ?? 6;
  const noiseDots = options.noiseDots ?? 260;
  const rng = createRng(options.seed ?? (Date.now() & 0xffff));

  const charWidth = (5 + 2) * scale;
  const width = padding * 2 + charWidth * code.length;
  const height = padding * 2 + 7 * scale + 10;

  const canvas = createCanvas(width, height, { r: 250, g: 250, b: 252, a: 255 });

  // 背景噪点
  for (let index = 0; index < noiseDots; index += 1) {
    const x = Math.floor(rng() * width);
    const y = Math.floor(rng() * height);
    const shade = 150 + Math.floor(rng() * 90);
    setPixel(canvas, x, y, { r: shade, g: shade, b: shade, a: 255 });
  }

  // 干扰线
  for (let index = 0; index < noiseLines; index += 1) {
    const color: Rgba = {
      r: Math.floor(rng() * 120) + 60,
      g: Math.floor(rng() * 120) + 60,
      b: Math.floor(rng() * 120) + 60,
      a: 255,
    };
    drawLine(canvas, rng() * width, rng() * height, rng() * width, rng() * height, color);
  }

  // 逐字符绘制，带随机抖动
  let cursor = padding;
  for (const char of code.toUpperCase()) {
    const offsetY = Math.floor(rng() * 8) - 4;
    const shade = Math.floor(rng() * 90) + 20;
    drawText(canvas, char, cursor, padding + offsetY, scale, { r: shade, g: shade, b: shade + 20, a: 255 });
    cursor += charWidth;
  }

  return encodePng(width, height, canvas.data);
}

/** 读取 PNG 头里的宽高（测试用） */
export function readPngSize(buffer: Buffer): { width: number; height: number } {
  if (buffer.length < 24) throw new Error("PNG 数据太短");
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error("不是 PNG 文件");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}
