const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('./clock.js');
const date = '2026-11-02', exams = C.DEFAULTS;
const phase = time => C.phase(C.at(date, time), date, exams);

test('臺灣時區及日期不受裝置所在時區影響', () => {
  assert.equal(C.today(Date.parse('2026-11-01T16:00:00Z')), date);
  assert.equal(C.at(date, '08:30'), Date.parse('2026-11-02T00:30:00Z'));
});
test('精確依五段考程的開始及結束邊界切換', () => {
  for (const [time, kind, id] of [
    ['08:29', 'before', 'exam-0'], ['08:30', 'exam', 'exam-0'],
    ['09:09', 'exam', 'exam-0'], ['09:10', 'break', 'break-0'],
    ['09:20', 'exam', 'exam-1'], ['10:00', 'break', 'break-1'],
    ['10:20', 'exam', 'exam-2'], ['11:00', 'done', 'exam-2']
  ]) { const p = phase(time); assert.equal(p.kind, kind, time); assert.equal(p.stage.id, id, time); }
});
test('考前不提早開始，非考試日不啟動', () => {
  assert.equal(phase('08:00').target, C.at(date, '08:30'));
  assert.equal(C.phase(C.at('2026-11-01', '09:00'), date, exams).kind, 'before');
  assert.equal(C.phase(C.at('2026-11-03', '09:00'), date, exams).kind, 'done');
});
test('中途開啟及背景恢復以實際結束時間重算', () => {
  const p = phase('08:50');
  assert.equal(C.countdown(p.target, C.at(date, '08:50')).seconds, 1200);
  assert.equal(C.countdown(p.target, C.at(date, '09:06')).seconds, 240);
  assert.equal(C.countdown(p.target, p.target - 1).seconds, 1);
  assert.equal(C.countdown(p.target, p.target).seconds, 0);
  assert.equal(C.countdown(p.target, p.target + 4000).seconds, 0);
});
test('下課分別為 10 與 20 分鐘', () => {
  const breaks = C.stages(date, exams).filter(s => s.kind === 'break');
  assert.deepEqual(breaks.map(s => (s.end - s.start) / 60000), [10, 20]);
});
test('臨時加時縮短下課，不會推遲下一節或重疊', () => {
  const list = C.stages(date, exams, { 0: 300 });
  assert.equal(list[0].end, C.at(date, '09:15'));
  assert.equal(list[1].start, C.at(date, '09:15'));
  assert.equal(list[2].start, C.at(date, '09:20'));
  const capped = C.stages(date, exams, { 0: 99999 });
  assert.equal(capped[0].end, C.at(date, '09:20'));
  assert.equal(capped[1].id, 'exam-1');
  assert.equal(C.phase(C.at(date, '09:20'), date, exams, { 0: 99999 }).stage.id, 'exam-1');
});
test('最後一節可加時，結束後正確完成', () => {
  assert.equal(C.phase(C.at(date, '11:02'), date, exams, { 2: 300 }).kind, 'exam');
  assert.equal(C.phase(C.at(date, '11:05'), date, exams, { 2: 300 }).kind, 'done');
});
test('拒絕無效時間、重疊與空白科目，接受合法修改', () => {
  const change = patch => exams.map((e, i) => i ? { ...e } : { ...e, ...patch });
  assert.ok(C.validate(change({ end: '09:30' })));
  assert.ok(C.validate(change({ end: '08:00' })));
  assert.ok(C.validate(change({ start: '25:00' })));
  assert.ok(C.validate(change({ subject: ' ' })));
  assert.equal(C.validate(change({ subject: '生活評量', end: '09:05' })), '');
});
