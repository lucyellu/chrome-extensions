// Generates the extension icons: dark rounded square with three "skim lines".
// Zero dependencies — encodes PNGs directly via Node's zlib.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, '..', 'icons');
fs.mkdirSync(OUT_DIR, { recursive: true });

const BG = [22, 22, 31];
const ACCENT = [108, 92, 231];
const MID = [160, 160, 185];
const DIM = [95, 95, 120];

function makeIcon(size) {
  const px = new Uint8Array(size * size * 4); // RGBA
  const s = size / 128;
  const radius = Math.max(2, 28 * s);

  const bars = [
    { y: 28 * s, w: 88 * s, color: ACCENT },
    { y: 58 * s, w: 60 * s, color: MID },
    { y: 88 * s, w: 36 * s, color: DIM },
  ];
  const barH = Math.max(1, 16 * s);
  const barX = 20 * s;

  const inRounded = (x, y) => {
    const r = radius;
    const cx = x < r ? r : x > size - 1 - r ? size - 1 - r : x;
    const cy = y < r ? r : y > size - 1 - r ? size - 1 - r : y;
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (!inRounded(x + 0.5, y + 0.5)) continue; // transparent corner
      let [r, g, b] = BG;
      for (const bar of bars) {
        if (y + 0.5 >= bar.y && y + 0.5 < bar.y + barH && x + 0.5 >= barX && x + 0.5 < barX + bar.w) {
          [r, g, b] = bar.color;
          break;
        }
      }
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
    }
  }
  return encodePNG(size, size, px);
}

function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.subarray(y * width * 4, (y + 1) * width * 4)
      .forEach((v, i) => { raw[y * (width * 4 + 1) + 1 + i] = v; });
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

for (const size of [16, 32, 48, 128]) {
  const file = path.join(OUT_DIR, `icon${size}.png`);
  fs.writeFileSync(file, makeIcon(size));
  console.log(`icon${size}.png (${fs.statSync(file).size} bytes)`);
}
