import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { code128, patternsForTest } from '../lib/code128.ts';

test('every Code 128 pattern is 11 modules (the stop 13), and no two are alike', () => {
  assert.equal(patternsForTest.length, 107);
  patternsForTest.forEach((p, i) => assert.equal([...p].reduce((s, d) => s + Number(d), 0), i === 106 ? 13 : 11, `pattern ${i}`));
  assert.equal(new Set(patternsForTest).size, 107);
  assert.equal(code128(''), null);
  assert.equal(code128('naïve'), null);
});

// Draw the bars as a greyscale image, the way a label prints, and read it back with the same zxing
// reader the app's scanner uses on phones without a built-in one.
async function scan(text: string) {
  const widths = code128(text)!;
  const unit = 3, quiet = 10 * unit, h = 60;
  const w = widths.reduce((s, n) => s + n, 0) * unit + 2 * quiet;
  const px = new Uint8Array(w * h).fill(255);
  let x = quiet;
  widths.forEach((n, i) => {
    if (i % 2 === 0) for (let y = 0; y < h; y++) px.fill(0, y * w + x, y * w + x + n * unit);
    x += n * unit;
  });
  const pgm = Buffer.concat([Buffer.from(`P5\n${w} ${h}\n255\n`), Buffer.from(px)]);
  const zx = await import('zxing-wasm/reader');
  // dist/es/reader/index.js → dist/reader/zxing_reader.wasm, read from disk so the test needs no network.
  const wasm = path.join(path.dirname(createRequire(import.meta.url).resolve('zxing-wasm/reader')), '..', '..', 'reader', 'zxing_reader.wasm');
  await zx.prepareZXingModule({ overrides: { wasmBinary: fs.readFileSync(wasm).buffer }, fireImmediately: true });
  const [hit] = await zx.readBarcodes(new Blob([pgm]), { formats: ['Code128'], tryHarder: true });
  return hit ? { text: hit.text, format: hit.format } : null;
}

test('a printed shop code scans back as itself', async () => {
  for (const sku of ['B-6205-2RS', 'SP-450M', 'TB-200', 'CB-24F', 'X1']) {
    assert.deepEqual(await scan(sku), { text: sku, format: 'Code128' });
  }
});
