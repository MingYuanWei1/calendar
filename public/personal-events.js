'use strict';
// 个人事件: a signed-in visitor's own events, edited here and shown only to them. Like the school's events they
// have a type, a time format and an optional repeat; they have no audience, poster or registration, and are
// never cancelled, only deleted. A repeating one is changed or deleted for one date, this and later dates, or all.

const P = (zh, en) => state.lang ? en : zh;
const PERSONAL_PRESETS = () => [['never', P('不重复', 'Never')], ['daily', P('每天', 'Every day')], ['school', P('每个上学日', 'Every school day')], ['weekly', P('每周', 'Every week')], ['biweekly', P('每两周', 'Every 2 weeks')], ['monthly', P('每月', 'Every month')]];
/** @type {any} */
let personalForm = null;
/** @type {any} */
let recurrenceTools = null;

/** The stored series a shown event or date belongs to. */
function personalSource(event) { return personalSeries.find(e => e.id === (event.seriesId || event.id)); }

function personalDetails(event) {
  const when = formatDate(event.start, true) + (isMulti(event) ? ' — ' + formatDate(event.end, true) : '');
  const row = (name, value) => value ? `<div class="meta-row"><span class="meta-label">${esc(t(name))}</span><div class="meta-value">${value}</div></div>` : '';
  const note = personalSource(event)?.exceptions?.[event.occurrence]?.note ?? event.note;
  return `<span class="detail-type ${esc(event.type)} personal"><span class="dot"></span>${esc(text(types[event.type].label))} · ${esc(t('personal'))}</span>
    <h2>${esc(text(event.title))}</h2><p class="detail-subtitle">${P('个人事件 · 仅自己可见', 'Personal event · Only you can see it')}</p>
    <div class="detail-meta">
      ${row('when', `${esc(when)}<small>${esc(timeText(event))}</small>`)}
      ${event.repeat ? row('repeats', esc(repeatSummary(event.repeat))) : ''}
      ${row('where', esc(text(event.location)))}
    </div>
    ${note ? `<section class="detail-section"><h3>${P('备注', 'Notes')}</h3><p>${esc(note)}</p></section>` : ''}
    <div class="personal-actions"><button type="button" class="primary" data-personal-edit="${esc(event.id)}">${P('编辑', 'Edit')}</button><button type="button" data-personal-delete="${esc(event.id)}">${P('删除', 'Delete')}</button></div>`;
}

function bindPersonalActions(root) {
  root.querySelectorAll('[data-personal-edit]').forEach(button => button.onclick = () => startPersonalChange('edit', events.find(e => e.id === button.dataset.personalEdit)));
  root.querySelectorAll('[data-personal-delete]').forEach(button => button.onclick = () => startPersonalChange('delete', events.find(e => e.id === button.dataset.personalDelete)));
}

/** A repeating event first asks which dates the change is for. */
function startPersonalChange(action, event) {
  if (!event) return;
  const source = personalSource(event);
  if (!source) return;
  if (!source.repeat) return action === 'edit' ? openPersonalEditor({ source }) : confirmPersonalDelete(source);
  const dialog = $('#personal-dialog');
  dialog.innerHTML = `<div class="dialog-top"><h2 id="personal-title">${action === 'edit' ? P('修改重复事件', 'Change a repeating event') : P('删除重复事件', 'Delete a repeating event')}</h2><button class="close-button" data-close aria-label="${P('关闭', 'Close')}">×</button></div>
    <p class="personal-help">${esc(text(event.title))} · ${esc(formatDate(event.occurrence, true))}</p>
    <div class="personal-span">${[['one', P('仅此次', 'This date only')], ['future', P('此次及以后', 'This and later dates')], ['all', P('全部日期', 'All dates')]].map(([span, name]) => `<button type="button" data-span="${span}">${name}</button>`).join('')}</div>`;
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  dialog.querySelectorAll('[data-span]').forEach(button => button.onclick = () => {
    const span = button.dataset.span;
    if (action === 'delete') return removePersonal(source, span === 'all' ? null : { date: event.occurrence, span });
    openPersonalEditor({ source, occurrence: span === 'all' ? null : { date: event.occurrence, span }, shown: event });
  });
  if (!dialog.open) dialog.showModal();
}

function confirmPersonalDelete(source) {
  const dialog = $('#personal-dialog');
  dialog.innerHTML = `<div class="dialog-top"><h2 id="personal-title">${P('删除个人事件？', 'Delete this personal event?')}</h2><button class="close-button" data-close aria-label="${P('关闭', 'Close')}">×</button></div>
    <p class="personal-help">${esc(source.title)}</p><p class="personal-error" role="alert"></p>
    <div class="personal-buttons"><button type="button" data-close>${P('返回', 'Go back')}</button><button type="button" class="primary danger" data-go>${P('删除', 'Delete')}</button></div>`;
  dialog.querySelectorAll('[data-close]').forEach(button => button.onclick = () => dialog.close());
  dialog.querySelector('[data-go]').onclick = () => removePersonal(source, null);
  if (!dialog.open) dialog.showModal();
}

async function removePersonal(source, occurrence) {
  const dialog = $('#personal-dialog');
  try {
    await api('/personal-events/' + encodeURIComponent(source.id), { method: 'DELETE', body: JSON.stringify({ version: source.version, ...(occurrence ? { occurrence } : {}) }) });
    dialog.close(); state.selected = null; closePersonalDetail(); await loadEvents();
  } catch (error) { showPersonalError(error.message); }
}

function closePersonalDetail() {
  document.body.classList.remove('mobile-detail'); document.body.classList.add('detail-closed'); syncDetailMode();
}

function showPersonalError(message) {
  const line = $('#personal-dialog .personal-error');
  if (line) line.textContent = message; else alert(message);
}

/** Which quick repeat choice a stored rule is; every rule made here is one of them. */
function personalPreset(rule) {
  if (!rule) return 'never';
  if (rule.freq === 'daily') return rule.schoolDays ? 'school' : 'daily';
  if (rule.freq === 'weekly') return rule.interval === 2 ? 'biweekly' : 'weekly';
  return 'monthly';
}

/**
 * Opens the editor: empty for a new event (optionally on a given date), or filled from a stored event.
 * `occurrence` ({date, span}) edits one date of a series ("one") or splits it from that date ("future").
 */
async function openPersonalEditor({ source = null, occurrence = null, shown = null, date = '' } = {}) {
  recurrenceTools ??= await import('./recurrence.mjs');
  const base = occurrence ? { ...source, ...shown, title: source.exceptions?.[occurrence.date]?.title ?? source.title, location: source.exceptions?.[occurrence.date]?.location ?? source.location, note: source.exceptions?.[occurrence.date]?.note ?? source.note } : source;
  const start = base?.start || date || schoolToday(), rule = base?.repeat;
  personalForm = {
    source, occurrence, title: base?.title || '', type: base?.type || 'activity',
    mode: base?.timeMode || 'timed', start, end: base?.end || start, time: base?.time || '14:00', endTime: base?.endTime || '15:00',
    dueAllDay: base?.timeMode === 'deadline' && !base?.time, location: base?.location || '', note: base?.note || '',
    rep: personalPreset(rule), endMode: rule?.until ? 'until' : rule?.count ? 'count' : 'never',
    until: rule?.until || recurrenceTools.schoolYearEnd(start), count: String(rule?.count || 10), tried: false
  };
  renderPersonalEditor();
  const dialog = $('#personal-dialog');
  if (!dialog.open) dialog.showModal();
  dialog.querySelector('[data-pf=title]')?.focus();
}

function personalRule(f = personalForm) {
  if (f.rep === 'never' || f.mode === 'multi' || f.occurrence?.span === 'one') return null;
  const { weekdayOf } = recurrenceTools, wd = weekdayOf(f.start), day = Number(f.start.slice(8));
  const rule = { daily: { freq: 'daily', interval: 1 }, school: { freq: 'daily', interval: 1, schoolDays: true }, weekly: { freq: 'weekly', interval: 1, weekdays: [wd] }, biweekly: { freq: 'weekly', interval: 2, weekdays: [wd] }, monthly: { freq: 'monthly', interval: 1, monthDays: [day] } }[f.rep];
  return { ...rule, ...(f.endMode === 'until' ? { until: f.until } : f.endMode === 'count' ? { count: Number(f.count) } : {}) };
}

function personalProblem(f = personalForm) {
  if (!f.title.trim()) return P('请填写标题。', 'Enter a title.');
  if (!f.start) return P('请选择日期。', 'Choose a date.');
  if (f.mode === 'multi' && !(f.end >= f.start)) return P('结束日期不能早于开始日期。', 'The end date must not precede the start date.');
  if (f.mode === 'timed' && !(f.time && f.endTime && f.endTime >= f.time)) return P('请填写时间，结束不能早于开始。', 'Enter the times; the end must not precede the start.');
  if (f.mode === 'deadline' && !f.dueAllDay && !f.time) return P('请填写截止时间，或选择全天。', 'Enter the due time, or choose all day.');
  const rule = personalRule(f);
  if (rule?.until && rule.until < f.start) return P('重复结束日期不能早于开始日期。', 'The repeat must not end before the start date.');
  if (rule?.count && !(Number.isInteger(rule.count) && rule.count >= 1 && rule.count <= 999)) return P('次数须为 1–999 的整数。', 'The number of times must be a whole number from 1 to 999.');
  return '';
}

function renderPersonalEditor() {
  const f = personalForm, single = f.occurrence?.span === 'one';
  const seg = (attr, items, value, locked = false) => `<div class="personal-seg">${items.map(([key, name]) => `<button type="button" data-${attr}="${key}" aria-pressed="${value === key}"${locked ? ' disabled' : ''}>${name}</button>`).join('')}</div>`;
  const field = (name, control) => `<div class="personal-field"><span class="personal-label">${name}</span>${control}</div>`;
  const heading = f.source ? (single ? P('修改这一次', 'Change this date') : f.occurrence ? P('修改此次及以后', 'Change this and later dates') : P('编辑个人事件', 'Edit personal event')) : t('addPersonal');
  const repeat = f.mode === 'multi' || single ? '' : field(P('重复', 'Repeat'), `${seg('pf-rep', PERSONAL_PRESETS(), f.rep)}${f.rep === 'never' ? '' : `<div class="personal-inline">${seg('pf-end', [['never', P('永不结束', 'Never ends')], ['until', P('于日期结束', 'Ends on')], ['count', P('重复次数', 'After')]], f.endMode)}
    ${f.endMode === 'until' ? `<input type="date" data-pf="until" value="${esc(f.until)}" min="${esc(f.start)}" aria-label="${P('结束日期', 'End date')}">` : ''}${f.endMode === 'count' ? `<label class="personal-inline"><input type="number" min="1" max="999" data-pf="count" value="${esc(f.count)}" aria-label="${P('次数', 'Times')}">${P('次', 'times')}</label>` : ''}</div>
    <p class="personal-help" id="personal-repeat-summary">${esc(recurrenceTools.describeRepeat(personalRule(), state.lang))}</p>`}`);
  $('#personal-dialog').innerHTML = `<div class="dialog-top"><div><span class="overline">${P('仅自己可见', 'ONLY YOU CAN SEE IT')}</span><h2 id="personal-title">${heading}</h2></div><button class="close-button" data-close aria-label="${P('关闭', 'Close')}">×</button></div>
  <form class="personal-form" novalidate>
    ${field(P('标题 *', 'Title *'), `<input data-pf="title" maxlength="250" value="${esc(f.title)}" placeholder="${P('中文或英文均可', 'In any language')}">`)}
    ${field(P('类型', 'Type'), seg('pf-type', Object.entries(types).map(([key, value]) => [key, text(value.label)]), f.type, single))}
    ${field(P('时间形式', 'Time format'), seg('pf-mode', [['timed', P('定时', 'Timed')], ['allDay', P('全天', 'All day')], ...(single ? [] : [['multi', P('跨日', 'Multiple days')]]), ['deadline', P('截止', 'Deadline')]], f.mode, single))}
    ${field(P('日期与时间 *', 'Date & time *'), `<div class="personal-inline"><input type="date" data-pf="start" value="${esc(f.start)}" aria-label="${f.mode === 'multi' ? P('开始日期', 'Start date') : P('日期', 'Date')}">
      ${f.mode === 'multi' ? `<span>–</span><input type="date" data-pf="end" value="${esc(f.end)}" min="${esc(f.start)}" aria-label="${P('结束日期', 'End date')}">` : ''}
      ${f.mode === 'timed' || (f.mode === 'deadline' && !f.dueAllDay) ? `<input type="time" data-pf="time" value="${esc(f.time)}" aria-label="${f.mode === 'deadline' ? P('截止时间', 'Due time') : P('开始时间', 'Start time')}">` : ''}
      ${f.mode === 'timed' ? `<span>–</span><input type="time" data-pf="endTime" value="${esc(f.endTime)}" aria-label="${P('结束时间', 'End time')}">` : ''}
      ${f.mode === 'deadline' ? `<button type="button" class="personal-toggle" data-pf-due aria-pressed="${f.dueAllDay}">${P('全天（当天内截止）', 'All day')}</button>` : ''}</div>`)}
    ${repeat}
    ${field(P('地点', 'Location'), `<input data-pf="location" maxlength="300" value="${esc(f.location)}">`)}
    ${field(P('备注', 'Notes'), `<textarea data-pf="note" maxlength="5000">${esc(f.note)}</textarea>`)}
    <p class="personal-error" role="alert">${f.tried ? esc(personalProblem()) : ''}</p>
    <div class="personal-buttons"><button type="button" data-close>${P('取消', 'Cancel')}</button><button type="submit" class="primary">${P('保存', 'Save')}</button></div>
  </form>`;
  const dialog = $('#personal-dialog');
  dialog.querySelectorAll('[data-close]').forEach(button => button.onclick = () => dialog.close());
  const form = dialog.querySelector('form');
  form.oninput = event => {
    const key = event.target.dataset.pf; if (!key) return;
    f[key] = event.target.value;
    if (f.tried) dialog.querySelector('.personal-error').textContent = personalProblem();
    const summary = $('#personal-repeat-summary'); if (summary) summary.textContent = recurrenceTools.describeRepeat(personalRule(), state.lang);
  };
  form.onchange = event => { if (event.target.dataset.pf === 'start') { if (f.end < f.start) f.end = f.start; renderPersonalEditor(); } };
  form.onclick = event => {
    const button = event.target.closest('button[type=button]'); if (!button || button.disabled) return;
    const d = button.dataset;
    if (d.pfType) { f.type = d.pfType; f.mode = f.type === 'deadline' ? 'deadline' : f.mode === 'deadline' ? 'timed' : f.mode; }
    else if (d.pfMode) { f.mode = d.pfMode; if (f.mode === 'deadline') f.type = 'deadline'; else if (f.type === 'deadline') f.type = 'activity'; }
    else if (d.pfRep) f.rep = d.pfRep;
    else if (d.pfEnd) f.endMode = d.pfEnd;
    else if (button.hasAttribute('data-pf-due')) f.dueAllDay = !f.dueAllDay;
    else return;
    renderPersonalEditor();
  };
  form.onsubmit = event => { event.preventDefault(); savePersonal(); };
}

async function savePersonal() {
  const f = personalForm;
  f.tried = true;
  const problem = personalProblem();
  if (problem) { $('#personal-dialog .personal-error').textContent = problem; return; }
  const value = {
    title: f.title.trim(), type: f.type, timeMode: f.mode, start: f.start, end: f.mode === 'multi' ? f.end : undefined,
    time: f.mode === 'timed' || (f.mode === 'deadline' && !f.dueAllDay) ? f.time : undefined, endTime: f.mode === 'timed' ? f.endTime : undefined,
    repeat: f.occurrence?.span === 'one' ? f.source.repeat : personalRule(), location: f.location.trim(), note: f.note.trim()
  };
  const body = { ...value, ...(f.source ? { version: f.source.version } : {}), ...(f.occurrence ? { occurrence: f.occurrence } : {}) };
  const button = $('#personal-dialog [type=submit]'); button.disabled = true;
  try {
    const saved = await api('/personal-events' + (f.source ? '/' + encodeURIComponent(f.source.id) : ''), { method: f.source ? 'PUT' : 'POST', body: JSON.stringify(body) });
    $('#personal-dialog').close();
    // Show the saved event's month so it is easy to find.
    const [year, month] = (f.occurrence ? value.start : saved.start).split('-').map(Number);
    if (state.view !== 'week') { state.year = year; state.month = month - 1; }
    state.selected = null; state.personal = true;
    await loadEvents(); render();
  } catch (error) { showPersonalError(error.message); button.disabled = false; }
}

$('#add-personal').onclick = () => openPersonalEditor({ date: state.view === 'week' ? state.anchor : '' });
$('#personal-dialog').addEventListener('click', event => { if (event.target === $('#personal-dialog')) $('#personal-dialog').close(); });
// Signing in or out with a username changes whose 个人事件 there are.
window.addEventListener('account-changed', () => loadEvents().then(render).catch(() => {}));
