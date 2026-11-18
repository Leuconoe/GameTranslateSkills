import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPrompt, compositeRegion } from '../scripts/codex-imagegen.mjs';

test('prompt names the text swap, canvas and output file', () => {
  const p = buildPrompt({ ja: 'ノーマルED', ko: '노멀 ED', style: 'white outline', width: 64, height: 32 });
  assert.match(p, /「ノーマルED」 with the Korean 「노멀 ED」/);
  assert.match(p, /64x32 canvas/);
  assert.match(p, /out\.png/);
});

test('only the region comes from the generated image', () => {
  const src = { width: 4, height: 2, rgba: Buffer.alloc(4 * 2 * 4, 1) };
  const gen = Buffer.alloc(4 * 2 * 4, 9);
  const out = compositeRegion(src, gen, [1, 0, 2, 1]);
  const px = (x, y) => out[(y * 4 + x) * 4];
  assert.deepEqual([px(0, 0), px(1, 0), px(2, 0), px(3, 0), px(1, 1)], [1, 9, 9, 1, 1]);
});
