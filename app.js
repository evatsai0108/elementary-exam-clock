(() => {
  'use strict';
  const C = window.ExamClock;
  const $ = id => document.getElementById(id);
  const KEY = 'elementary-exam-clock-v1', EXTRA_KEY = 'elementary-exam-clock-extra-v1';
  const SUBJECTS = ['國語', '數學', '英語', '自然', '社會', '生活', '健康', '綜合活動', '本土語文'];
  const DEFAULT_HINT = '先寫班級、姓名、座號；完成後，記得再檢查一次。';
  const defaults = () => ({ version: 1, grade: '3', classroom: '1', exams: C.DEFAULTS.map(e => ({ ...e })), fiveMinuteWarning: true, endBell: true, hint: DEFAULT_HINT });
  let config = defaults(), extraData = { date: C.today(), values: {} }, storageFailed = false;
  function normalize(raw) {
    if (!raw || typeof raw !== 'object' || raw.version !== 1) throw new Error('設定檔格式不符，請選擇本時鐘匯出的 JSON 檔。');
    if (!Array.isArray(raw.exams)) throw new Error('設定檔缺少考程。');
    const exams = raw.exams.map((e, i) => ({ name: C.DEFAULTS[i]?.name || '', start: String(e.start || ''), end: String(e.end || ''), subject: String(e.subject || '').trim() }));
    const error = C.validate(exams);
    if (error) throw new Error(error);
    if (!/^[1-6]$/.test(String(raw.grade)) || !String(raw.classroom || '').trim() || String(raw.classroom).length > 12) throw new Error('請確認年級及班級設定。');
    return { version: 1, grade: String(raw.grade), classroom: String(raw.classroom).trim(), exams, fiveMinuteWarning: raw.fiveMinuteWarning !== false, endBell: raw.endBell !== false, hint: String(raw.hint ?? DEFAULT_HINT).slice(0, 160) };
  }
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) config = normalize(JSON.parse(saved));
    const extras = JSON.parse(localStorage.getItem(EXTRA_KEY) || 'null');
    if (extras && extras.date === C.today() && extras.values && typeof extras.values === 'object') {
      extraData = { date: extras.date, values: Object.fromEntries([0, 1, 2].map(i => [i, Math.max(0, Math.min(10800, Number(extras.values[i]) || 0))])) };
    }
  } catch { storageFailed = true; }
  let examDate = C.today(), followToday = true, preview = null, audio = null, soundEnabled = false;
  let lastPhase = null, subjectKey = '', scheduleSignature = '', previousSeconds = null, toastTimer, current;
  const sounded = new Set();
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(config)); $('saveStatus').textContent = '設定已儲存在這台瀏覽器'; }
    catch { $('saveStatus').textContent = '瀏覽器無法儲存，請匯出設定備份'; }
  }
  function saveExtras() { try { localStorage.setItem(EXTRA_KEY, JSON.stringify(extraData)); } catch { toast('目前無法儲存加時，重新整理後將恢復原考程。'); } }
  function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500); }
  function numberText(n) { const d = '零一二三四五六七八九'; n = Number(n); return n < 10 ? d[n] : n === 10 ? '十' : n < 20 ? `十${d[n % 10]}` : `${d[Math.floor(n / 10)]}十${n % 10 ? d[n % 10] : ''}`; }
  function roomName() { return `${numberText(config.grade)}年${/^\d+$/.test(config.classroom) ? `${numberText(config.classroom)}班` : config.classroom}`; }
  function option(value, label) { const el = document.createElement('option'); el.value = value; el.textContent = label; return el; }
  function fillSubjects(select, value) { select.replaceChildren(...SUBJECTS.map(s => option(s, s)), option('__custom__', '自訂科目…')); select.value = SUBJECTS.includes(value) ? value : '__custom__'; }
  function hhmm(timestamp) { const p = C.taipeiParts(timestamp); return `${p.hour}:${p.minute}`; }
  function localFormSync() {
    $('grade').value = config.grade;
    $('classroom').replaceChildren(...Array.from({ length: 30 }, (_, i) => option(String(i + 1), `${numberText(i + 1)}班`)), option('__custom__', '自訂班級…'));
    const numericClass = /^(?:[1-9]|[12]\d|30)$/.test(config.classroom);
    $('classroom').value = numericClass ? config.classroom : '__custom__';
    $('customClass').hidden = numericClass; $('customClass').value = numericClass ? '' : config.classroom;
    $('examDate').value = examDate;
    subjectKey = ''; scheduleSignature = ''; render();
  }
  async function enableAudio() {
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) throw new Error();
      audio ||= new Audio();
      await audio.resume();
      if (audio.state !== 'running') throw new Error();
      soundEnabled = true; updateSoundButton();
      return true;
    } catch { soundEnabled = false; updateSoundButton(); toast('無法啟用鐘聲，請確認瀏覽器允許播放音效。'); return false; }
  }
  function updateSoundButton() { $('soundToggle').setAttribute('aria-pressed', String(soundEnabled)); $('soundToggle').querySelector('span').textContent = soundEnabled ? '提醒鐘聲已開啟' : '開啟提醒鐘聲'; }
  function bell(warning = false) {
    if (!soundEnabled || !audio || audio.state !== 'running') return;
    const notes = warning ? [659.25, 783.99] : [659.25, 523.25, 587.33, 392];
    notes.forEach((freq, i) => {
      const osc = audio.createOscillator(), gain = audio.createGain();
      const start = audio.currentTime + i * 0.32;
      osc.type = 'sine'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(0.14, start + 0.025); gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.85);
      osc.connect(gain); gain.connect(audio.destination); osc.start(start); osc.stop(start + 0.9);
    });
  }
  function renderSchedule(phase, now) {
    const signature = JSON.stringify([phase.kind, phase.stage.id, phase.list.map(s => [s.id, s.subject, s.start, s.end]), now < phase.list[0].start]);
    if (signature === scheduleSignature) return;
    scheduleSignature = signature;
    const fragment = document.createDocumentFragment();
    phase.list.forEach(s => {
      const active = now >= s.start && now < s.end;
      const completed = now >= s.end;
      const row = document.createElement('div'); row.className = `schedule-row ${s.kind}${active ? ' current' : ''}${completed ? ' completed' : ''}`;
      if (active) row.setAttribute('aria-current', 'step');
      const num = document.createElement('span'); num.className = 'number'; num.textContent = s.kind === 'exam' ? String(s.index + 1).padStart(2, '0') : '';
      const main = document.createElement('div'); main.className = 'row-main';
      const title = document.createElement('h3'); title.textContent = s.kind === 'exam' ? `${s.name} · ${s.subject}` : `下課 ${Math.round((s.end - s.start) / 60000)} 分鐘`;
      const time = document.createElement('div'); time.className = 'time'; time.textContent = `${hhmm(s.start)} — ${hhmm(s.end)}`;
      main.append(title, time); row.append(num, main);
      if (s.kind === 'exam') { const state = document.createElement('span'); state.className = 'row-state'; state.textContent = active ? '進行中' : completed ? '✓' : (phase.next?.id === s.id ? '接下來' : ''); row.append(state); }
      fragment.append(row);
    });
    $('scheduleList').replaceChildren(fragment);
  }
  function render() {
    const realNow = Date.now();
    if (followToday && !preview && examDate !== C.today(realNow)) { examDate = C.today(realNow); $('examDate').value = examDate; }
    const now = preview ? C.at(examDate, preview.time) + (realNow - preview.started) : realNow;
    const parts = C.taipeiParts(now);
    $('wallClock').textContent = `${parts.hour}:${parts.minute}:${parts.second}`;
    $('todayLabel').textContent = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'long', day: 'numeric', weekday: 'short' }).format(now);
    const extras = extraData.date === examDate ? extraData.values : {};
    const p = C.phase(now, examDate, config.exams, extras); current = p;
    const remaining = p.target ? C.countdown(p.target, now) : { seconds: 0, minutesText: '00', secondsText: '00' };
    const warning = p.kind === 'exam' && remaining.seconds <= 300;
    const context = `${examDate}:${p.kind}:${p.stage.id}`;
    // Never replay missed alarms after a suspended/background tab or in preview.
    if (!preview && lastPhase && lastPhase.startsWith(`${examDate}:`) && lastPhase !== context && now >= (render.lastNow || now) && now - (render.lastNow || now) < 2500 && config.endBell) bell();
    const warningKey = `${examDate}:${p.stage.id}:${p.target}`;
    if (!preview && p.kind === 'exam' && warning && previousSeconds > 300 && previousSeconds - remaining.seconds < 3 && lastPhase === context && !sounded.has(warningKey) && config.fiveMinuteWarning) { bell(true); sounded.add(warningKey); }
    lastPhase = context; previousSeconds = remaining.seconds; render.lastNow = now;
    $('previewBanner').hidden = !preview;
    $('timerCard').dataset.phase = p.kind; $('timerCard').dataset.warning = String(warning);
    $('roomName').textContent = roomName();
    const isSubject = p.kind === 'before' || p.kind === 'exam';
    $('subject').parentElement.hidden = !isSubject; $('breakTitle').hidden = isSubject;
    $('breakTitle').textContent = p.kind === 'done' ? '今天辛苦了！' : '下課休息';
    const index = p.stage.index;
    if (subjectKey !== `${context}:${index}`) {
      subjectKey = `${context}:${index}`;
      fillSubjects($('subject'), config.exams[index].subject);
      const custom = !SUBJECTS.includes(config.exams[index].subject);
      $('customSubject').hidden = !custom; $('customSubject').value = custom ? config.exams[index].subject : '';
    }
    const labels = { before: '準備開始', exam: warning ? '最後 5 分鐘' : '考試進行中', break: '休息一下', done: '今日考程完成' };
    $('phasePill').textContent = labels[p.kind];
    $('sessionLabel').textContent = p.kind === 'done' ? '三節考試都完成了' : p.kind === 'before' ? `${p.stage.name} · ${hhmm(p.stage.start)} — ${hhmm(p.stage.end)}` : p.kind === 'break' ? `${hhmm(p.stage.start)} — ${hhmm(p.stage.end)} · 下一節 ${config.exams[index + 1].subject}` : `${p.stage.name} · ${hhmm(p.stage.start)} — ${hhmm(p.stage.end)}`;
    $('countdownCaption').textContent = { before: '距離考試開始還有', exam: '作答時間還剩下', break: '距離下一節考試還有', done: '謝謝你今天的努力' }[p.kind];
    $('minutes').textContent = remaining.minutesText; $('seconds').textContent = remaining.secondsText;
    $('countdown').setAttribute('aria-label', p.kind === 'done' ? '今日考試已結束' : `剩餘 ${Number(remaining.minutesText)} 分 ${Number(remaining.secondsText)} 秒`);
    $('timerSubline').textContent = p.kind === 'before' ? '準備好文具，讓自己慢慢靜下來。' : p.kind === 'break' ? '喝點水、上個廁所，讓眼睛休息一下。' : p.kind === 'done' ? '收好文具，給努力的自己一個微笑。' : warning ? '把握時間，完成後再仔細檢查一次。' : '不急不慌，一題一題慢慢來。';
    const percent = p.kind === 'done' ? 100 : p.kind === 'before' ? 0 : Math.max(0, Math.min(100, (p.target - now) / (p.target - p.start) * 100));
    $('progressFill').style.width = `${percent}%`; $('progressTrack').setAttribute('aria-valuenow', String(Math.round(percent)));
    $('progressLabel').textContent = { before: '準備時間', exam: '剩餘作答時間', break: '充電時間', done: '今日進度' }[p.kind];
    $('endLabel').textContent = p.target ? `${hhmm(p.target)} ${p.kind === 'exam' ? '結束' : '開始'}` : '全部完成 ✓';
    $('adjustments').hidden = p.kind !== 'exam'; $('clearExtra').hidden = !extras[index];
    const canAdd = p.kind === 'exam' && (index === 2 || p.stage.end < C.at(examDate, config.exams[index + 1].start));
    $('addMinute').disabled = !canAdd; $('addFive').disabled = !canAdd;
    $('reminderTitle').textContent = p.kind === 'break' ? '休息小提醒' : p.kind === 'done' ? '完成小提醒' : '作答小提醒';
    $('reminderText').textContent = p.kind === 'break' ? '下一節快開始時，回座位準備好文具，讓心情安定下來。' : p.kind === 'done' ? '確認試卷已交回，整理桌面，再準備接下來的活動。' : config.hint;
    renderSchedule(p, now);
  }
  function silenceTransition() { lastPhase = null; previousSeconds = null; }
  $('grade').addEventListener('change', () => { config.grade = $('grade').value; save(); render(); });
  $('classroom').addEventListener('change', () => {
    const custom = $('classroom').value === '__custom__'; $('customClass').hidden = !custom;
    config.classroom = custom ? ($('customClass').value.trim() || '自訂班') : $('classroom').value;
    if (custom) $('customClass').focus(); save(); render();
  });
  $('customClass').addEventListener('input', () => { config.classroom = $('customClass').value.trim() || '自訂班'; save(); render(); });
  $('examDate').addEventListener('change', () => {
    const value = $('examDate').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(C.at(value, '00:00'))) { $('examDate').value = examDate; return; }
    examDate = value; followToday = value === C.today(); preview = null; silenceTransition(); render();
  });
  $('subject').addEventListener('change', () => {
    const custom = $('subject').value === '__custom__'; $('customSubject').hidden = !custom;
    config.exams[current.stage.index].subject = custom ? '自訂科目' : $('subject').value;
    if (custom) { $('customSubject').value = ''; $('customSubject').focus(); }
    save(); render();
  });
  $('customSubject').addEventListener('input', () => { config.exams[current.stage.index].subject = $('customSubject').value.trim() || '自訂科目'; save(); render(); });
  $('soundToggle').addEventListener('click', async () => { if (soundEnabled) { soundEnabled = false; updateSoundButton(); } else if (await enableAudio()) { bell(true); toast('鐘聲已開啟；請先確認電腦音量。'); } });
  $('fullscreen').addEventListener('click', async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { toast('此瀏覽器無法進入全螢幕，請使用瀏覽器的全螢幕功能。'); }
  });
  document.addEventListener('fullscreenchange', () => { $('fullscreen').querySelector('span').textContent = document.fullscreenElement ? '離開全螢幕' : '全螢幕'; });
  function adjust(seconds) {
    if (current.kind !== 'exam') return;
    if (preview) { toast('請先回到目前時間，再使用臨時加時。'); return; }
    if (extraData.date !== examDate) extraData = { date: examDate, values: {} };
    const i = current.stage.index, old = Number(extraData.values[i]) || 0;
    const max = i === 2 ? 10800 : Math.max(0, (C.at(examDate, config.exams[i + 1].start) - current.stage.originalEnd) / 1000);
    extraData.values[i] = Math.min(old + seconds, max); saveExtras(); render();
    toast(i === 2 ? `本節已加時 ${extraData.values[i] / 60} 分鐘。` : `本節已加時 ${extraData.values[i] / 60} 分鐘；下課會縮短，下一節準時開始。`);
  }
  $('addMinute').addEventListener('click', () => adjust(60)); $('addFive').addEventListener('click', () => adjust(300));
  $('clearExtra').addEventListener('click', () => { if (preview) { toast('請先離開預覽模式。'); return; } delete extraData.values[current.stage.index]; saveExtras(); silenceTransition(); render(); toast('已恢復原定結束時間。'); });
  function populateSettings() {
    const fragment = document.createDocumentFragment();
    config.exams.forEach((exam, i) => {
      const row = document.createElement('div'); row.className = 'exam-editor'; row.dataset.index = i;
      const label = document.createElement('strong'); label.textContent = exam.name;
      const subject = document.createElement('div'); subject.className = 'editor-subject';
      const select = document.createElement('select'); select.className = 'editor-select'; select.setAttribute('aria-label', `${exam.name}科目`); fillSubjects(select, exam.subject);
      const custom = document.createElement('input'); custom.className = 'editor-custom'; custom.maxLength = 30; custom.placeholder = '輸入自訂科目'; custom.setAttribute('aria-label', `${exam.name}自訂科目`); custom.hidden = SUBJECTS.includes(exam.subject); custom.value = custom.hidden ? '' : exam.subject;
      select.addEventListener('change', () => { custom.hidden = select.value !== '__custom__'; if (!custom.hidden) custom.focus(); }); subject.append(select, custom);
      const times = document.createElement('div'); times.className = 'editor-times';
      for (const key of ['start', 'end']) { const input = document.createElement('input'); input.type = 'time'; input.required = true; input.value = exam[key]; input.className = `editor-${key}`; input.setAttribute('aria-label', `${exam.name}${key === 'start' ? '開始' : '結束'}時間`); if (key === 'end') { const sep = document.createElement('span'); sep.textContent = '—'; times.append(sep); } times.append(input); }
      row.append(label, subject, times); fragment.append(row);
    });
    $('examEditors').replaceChildren(fragment); $('fiveMinuteWarning').checked = config.fiveMinuteWarning; $('endBell').checked = config.endBell; $('hintText').value = config.hint; $('formError').textContent = '';
  }
  $('openSettings').addEventListener('click', () => { populateSettings(); $('settingsDialog').showModal(); });
  for (const id of ['closeSettings', 'cancelSettings']) $(id).addEventListener('click', () => $('settingsDialog').close());
  $('settingsForm').addEventListener('submit', event => {
    event.preventDefault();
    const exams = [...$('examEditors').children].map((row, i) => ({ name: C.DEFAULTS[i].name, start: row.querySelector('.editor-start').value, end: row.querySelector('.editor-end').value, subject: row.querySelector('.editor-select').value === '__custom__' ? row.querySelector('.editor-custom').value.trim() : row.querySelector('.editor-select').value }));
    const error = C.validate(exams); if (error) { $('formError').textContent = error; return; }
    const changedTimes = exams.some((e, i) => e.start !== config.exams[i].start || e.end !== config.exams[i].end);
    config = { ...config, exams, fiveMinuteWarning: $('fiveMinuteWarning').checked, endBell: $('endBell').checked, hint: $('hintText').value.trim() || DEFAULT_HINT };
    if (changedTimes) { extraData = { date: examDate, values: {} }; saveExtras(); }
    save(); subjectKey = ''; silenceTransition(); render(); $('settingsDialog').close(); toast('考程已更新，會依臺灣時間自動切換。');
  });
  $('testSound').addEventListener('click', async () => { if (await enableAudio()) bell(); });
  document.querySelectorAll('[data-preview]').forEach(button => button.addEventListener('click', () => { preview = { time: button.dataset.preview, started: Date.now() }; silenceTransition(); render(); $('settingsDialog').close(); }));
  $('exitPreview').addEventListener('click', () => { preview = null; silenceTransition(); render(); });
  $('exportConfig').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = '國小考試時鐘設定.json'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('已匯出目前儲存的設定。');
  });
  $('importConfig').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > 50000) throw new Error('設定檔過大，請確認選取的檔案。');
      const imported = normalize(JSON.parse(await file.text())); config = imported; extraData = { date: examDate, values: {} }; saveExtras(); save(); silenceTransition(); populateSettings(); localFormSync(); toast('設定已匯入並套用。');
    } catch (error) { $('formError').textContent = error instanceof SyntaxError ? '檔案不是有效的 JSON 設定檔。' : error.message; }
    event.target.value = '';
  });
  $('restoreDefaults').addEventListener('click', () => { config.exams = defaults().exams; extraData = { date: examDate, values: {} }; saveExtras(); save(); populateSettings(); subjectKey = ''; silenceTransition(); render(); toast('已還原三節預設時間及科目。'); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { silenceTransition(); render(); } });
  localFormSync(); setInterval(render, 250);
  if (storageFailed) { $('saveStatus').textContent = '無法讀取先前設定，已載入預設考程'; toast('先前設定無法讀取，已使用預設值；建議匯出設定備份。'); }
})();
