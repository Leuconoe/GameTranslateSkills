import assert from 'node:assert/strict';
import test from 'node:test';
import { gameDateText, renderNotes } from '../scripts/release-notes.mjs';

test('star only within 24 months, basis appended, unknown stays plain', () => {
  assert.equal(gameDateText('2025-03-27', '2026-11-18'), '2025-03-27*');
  assert.equal(gameDateText('2023-09-07', '2026-11-18'), '2023-09-07');
  assert.equal(gameDateText('2024-11-18', '2026-11-18'), '2024-11-18');
  assert.equal(gameDateText('2025-11-19', '2026-11-18', '유럽판 Switch 기준'), '2025-11-19* (유럽판 Switch 기준)');
  assert.equal(gameDateText('미확인', '2026-11-18'), '미확인');
});

test('seven numbered items separated by blank lines, sub-items tight', () => {
  const t = renderNotes({ title: 'T', gameDate: 'D', patchVersion: 'v0.0.1', supportVersion: 'v1', langMethod: 'L',
    changelog: ['v0.0.1 - 초도 배포'], cautions: [] });
  const lines = t.split('\n');
  for (let n = 2; n <= 7; n += 1) {
    const i = lines.findIndex((l) => l.startsWith(`${n}. `));
    assert.equal(lines[i - 1], '', `blank line before item ${n}`);
  }
  assert.match(t, /6\. 체인지로그\n {3}- v0\.0\.1 - 초도 배포\n/);
  assert.match(t, /7\. 주의사항\n {3}- 없음\n/);
});
