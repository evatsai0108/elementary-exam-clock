(function (root) {
  'use strict';
  const DEFAULTS = [
    { name: '第一節', start: '08:30', end: '09:10', subject: '國語' },
    { name: '第二節', start: '09:20', end: '10:00', subject: '數學' },
    { name: '第三節', start: '10:20', end: '11:00', subject: '自然' }
  ];
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  function taipeiParts(now) { return Object.fromEntries(formatter.formatToParts(now).filter(p => p.type !== 'literal').map(p => [p.type, p.value])); }
  function today(now = Date.now()) { const p = taipeiParts(now); return `${p.year}-${p.month}-${p.day}`; }
  function at(date, time) { return Date.parse(`${date}T${time}:00+08:00`); }
  function validate(exams) {
    if (!Array.isArray(exams) || exams.length !== 3) return '請保留三節考試。';
    let previousEnd = -1;
    for (const exam of exams) {
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(exam.start) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(exam.end)) return '請輸入有效的開始及結束時間。';
      const start = at('2026-01-01', exam.start), end = at('2026-01-01', exam.end);
      if (end <= start) return `${exam.name}的結束時間必須晚於開始時間。`;
      if (start < previousEnd) return '考試時段不可重疊，請確認前一節結束時間。';
      if (!String(exam.subject || '').trim() || String(exam.subject).length > 30) return '每節科目請填寫 1 至 30 個字。';
      previousEnd = end;
    }
    return '';
  }
  function stages(date, exams, extras = {}) {
    const result = [];
    exams.forEach((e, index) => {
      const start = at(date, e.start), originalEnd = at(date, e.end);
      const nextStart = index < exams.length - 1 ? at(date, exams[index + 1].start) : originalEnd + 3 * 60 * 60 * 1000;
      const seconds = Math.max(0, Number(extras[index]) || 0);
      const end = Math.min(originalEnd + seconds * 1000, nextStart);
      result.push({ ...e, kind: 'exam', index, id: `exam-${index}`, start, end, originalEnd });
      if (index < exams.length - 1 && end < nextStart) result.push({ name: '下課休息', kind: 'break', index, id: `break-${index}`, start: end, end: nextStart });
    });
    return result;
  }
  function phase(now, date, exams, extras = {}) {
    const list = stages(date, exams, extras);
    if (now < list[0].start) return { kind: 'before', target: list[0].start, start: null, stage: list[0], next: list[0], list };
    const index = list.findIndex(s => now >= s.start && now < s.end);
    if (index < 0) return { kind: 'done', target: null, start: null, stage: list[list.length - 1], next: null, list };
    const stage = list[index];
    return { kind: stage.kind, target: stage.end, start: stage.start, stage, next: list[index + 1] || null, list };
  }
  function countdown(target, now) {
    const seconds = Math.max(0, Math.ceil((target - now) / 1000));
    return { seconds, minutesText: String(Math.floor(seconds / 60)).padStart(2, '0'), secondsText: String(seconds % 60).padStart(2, '0') };
  }
  const api = { DEFAULTS, taipeiParts, today, at, validate, stages, phase, countdown };
  root.ExamClock = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
