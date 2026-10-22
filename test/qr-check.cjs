const fs = require('fs');
const jsQR = require('jsqr');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'src', 'shared', 'qr.js'), 'utf8');
const qrEncode = new Function(`${src}; return qrEncode;`)();
const texts = [
  'http://192.168.2.12:8099/',
  'http://192.168.2.12:8080/',
  'http://10.0.0.5:8080/?console=192.168.2.25',
  'http://192.168.100.200:65535/some/longer/path?with=query&and=more',
];
let ok = true;
for (const text of texts) {
  const { size, modules } = qrEncode(text);
  const scale = 6;
  const quiet = 4;
  const dim = (size + quiet * 2) * scale;
  const px = new Uint8ClampedArray(dim * dim * 4).fill(255);
  const dark = (r, c) => (Array.isArray(modules[0]) ? modules[r][c] : modules[r * size + c]);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!dark(r, c)) continue;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const i = (((r + quiet) * scale + y) * dim + (c + quiet) * scale + x) * 4;
          px[i] = px[i + 1] = px[i + 2] = 0;
        }
      }
    }
  }
  const res = jsQR(px, dim, dim);
  const got = res && res.data;
  const pass = got === text;
  ok = ok && pass;
  console.log(`${pass ? 'PASS' : 'FAIL'} size=${size} ${text}${pass ? '' : ` -> ${got}`}`);
}
process.exit(ok ? 0 : 1);
