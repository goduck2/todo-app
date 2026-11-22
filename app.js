/* 데이터 계층. 화면 코드는 Store의 함수만 호출한다. */
var Store = (function () {
  'use strict';

  var VERSION = 1;
  var DAY_MS = 24 * 60 * 60 * 1000;
  var KEEP_DONE_MS = 7 * DAY_MS;
  var CATEGORIES = ['work', 'personal', 'study'];
  var TABS = ['all'].concat(CATEGORIES);

  var key = 'todo-app-v1';
  var clock = function () { return Date.now(); };
  var state = null;   // { version, todos, settings }
  var lastSaveOk = true;
  var knownDay = null;   // 마지막으로 확인한 날짜(dateKey)
  var readFailed = false;   // load()에서 localStorage 읽기가 예외로 실패했는지

  /* ---------- 유틸 ---------- */

  function isNum(n) { return typeof n === 'number' && isFinite(n); }
  function isCat(c) { return CATEGORIES.indexOf(c) !== -1; }
  function isObj(o) { return o !== null && typeof o === 'object' && !Array.isArray(o); }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function isTime(s) { return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }
  function timeToMin(s) { return Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5)); }

  // Date 또는 ms를 ms로. 생략하면 현재 시각.
  function toMs(t) {
    if (t instanceof Date) return t.getTime();
    return isNum(t) ? t : clock();
  }

  // 기기 로컬 날짜 "YYYY-MM-DD". toISOString은 UTC라 쓰지 않는다.
  function dateKey(t) {
    var d = new Date(toMs(t));
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function newId() {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
    } catch (e) { /* file:// 등에서 없을 수 있음 */ }
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10) +
      Math.random().toString(36).slice(2, 6);
  }

  // 앞뒤 공백 제거 후 1~100자면 제목을, 아니면 null.
  function cleanTitle(t) {
    if (typeof t !== 'string') return null;
    var s = t.trim();
    return s.length >= 1 && s.length <= 100 ? s : null;
  }

  function defaults() {
    return {
      version: VERSION,
      todos: [],
      settings: {
        reminderTime: '08:00', lastCategory: 'work', lastAckDate: null,
        lastNotifiedDate: null, activeTab: 'all'
      }
    };
  }

  function copy(todo) {
    return {
      id: todo.id, title: todo.title, category: todo.category, done: todo.done,
      createdAt: todo.createdAt, doneAt: todo.doneAt, updatedAt: todo.updatedAt
    };
  }

  // 저장된 항목 하나를 검증·정리. 쓸 수 없으면 null.
  function normalizeTodo(t) {
    if (!isObj(t)) return null;
    var title = cleanTitle(t.title);
    if (typeof t.id !== 'string' || !t.id || title === null ||
        !isCat(t.category) || !isNum(t.createdAt)) return null;
    var done = t.done === true;
    var updatedAt = isNum(t.updatedAt) ? t.updatedAt : t.createdAt;
    return {
      id: t.id, title: title, category: t.category, done: done,
      createdAt: t.createdAt,
      doneAt: done ? (isNum(t.doneAt) ? t.doneAt : updatedAt) : null,
      updatedAt: updatedAt
    };
  }

  function sortByCreated(a, b) { return a.createdAt - b.createdAt; }

  /* ---------- 저장·불러오기 ---------- */

  // 이전 버전 데이터를 현재 형식으로. 미래 버전이면 null.
  // 새 버전이 생기면 여기에 단계별 변환을 추가한다.
  function migrate(data) {
    var v = isNum(data.version) ? data.version : 0;
    if (v > VERSION) return null;
    var s = isObj(data.settings) ? data.settings : {};
    var out = defaults();
    out.settings.reminderTime = isTime(s.reminderTime) ? s.reminderTime : '08:00';
    out.settings.lastCategory = isCat(s.lastCategory) ? s.lastCategory : 'work';
    out.settings.lastAckDate = typeof s.lastAckDate === 'string' ? s.lastAckDate : null;
    out.settings.lastNotifiedDate = typeof s.lastNotifiedDate === 'string' ? s.lastNotifiedDate : null;
    out.settings.activeTab = TABS.indexOf(s.activeTab) !== -1 ? s.activeTab : 'all';
    var dropped = 0;
    data.todos.forEach(function (raw) {
      var t = normalizeTodo(raw);
      if (t) out.todos.push(t); else dropped++;
    });
    out.todos.sort(sortByCreated);
    return { state: out, dropped: dropped };
  }

  function stashCorrupt(raw) {
    try { localStorage.setItem(key + '-corrupt', raw); } catch (e) { /* 무시 */ }
  }

  // 읽기 실패·깨진 데이터는 기본값으로 시작하고 원본은 "-corrupt" 키에 보관.
  // 정상이면 true, 복구했으면 false. 끝나면 오래된 완료 항목을 정리한다.
  function load() {
    var raw = null, bad = false, parsed, res = null;
    readFailed = false;
    try { raw = localStorage.getItem(key); } catch (e) { raw = null; readFailed = true; }
    state = defaults();
    if (raw !== null) {
      try { parsed = JSON.parse(raw); } catch (e) { bad = true; }
      if (!bad) {
        if (isObj(parsed) && Array.isArray(parsed.todos)) res = migrate(parsed);
        if (!res) {
          bad = true;
        } else {
          state = res.state;
          if (res.dropped) bad = true;  // 일부 항목만 버린 경우도 원본 보관
        }
      }
      if (bad) stashCorrupt(raw);
    }
    knownDay = dateKey();
    purgeOld();
    return !bad;
  }

  function ensureLoaded() { if (!state) load(); }

  // 실패(사생활 모드 등)해도 예외를 던지지 않고 false.
  // 읽기에 실패했던 경우엔 저장하지 않는다(보이지 않는 기존 데이터를 덮어쓰지 않도록).
  function save() {
    ensureLoaded();
    if (readFailed) { lastSaveOk = false; return false; }
    try {
      localStorage.setItem(key, JSON.stringify(state));
      lastSaveOk = true;
    } catch (e) {
      lastSaveOk = false;
    }
    return lastSaveOk;
  }

  /* ---------- 변경 (변경마다 즉시 저장) ---------- */

  function find(id) {
    ensureLoaded();
    for (var i = 0; i < state.todos.length; i++) {
      if (state.todos[i].id === id) return state.todos[i];
    }
    return null;
  }

  // 성공하면 새 항목(복사본), 거부하면 null.
  function add(title, category) {
    ensureLoaded();
    var t = cleanTitle(title);
    if (t === null || !isCat(category)) return null;
    var now = clock();
    var todo = {
      id: newId(), title: t, category: category, done: false,
      createdAt: now, doneAt: null, updatedAt: now
    };
    state.todos.push(todo);
    state.settings.lastCategory = category;
    save();
    return copy(todo);
  }

  // changes: { title?, category? }. 하나라도 잘못되면 아무것도 바꾸지 않고 null.
  function update(id, changes) {
    var todo = find(id);
    if (!todo || !isObj(changes)) return null;
    var title = todo.title, category = todo.category;
    if ('title' in changes) {
      title = cleanTitle(changes.title);
      if (title === null) return null;
    }
    if ('category' in changes) {
      if (!isCat(changes.category)) return null;
      category = changes.category;
    }
    todo.title = title;
    todo.category = category;
    todo.updatedAt = clock();
    save();
    return copy(todo);
  }

  // 삭제한 항목(복사본)을 돌려준다. 실행 취소는 이 값을 restore()에 넘긴다.
  function remove(id) {
    var todo = find(id);
    if (!todo) return null;
    state.todos.splice(state.todos.indexOf(todo), 1);
    save();
    return copy(todo);
  }

  function toggle(id) {
    var todo = find(id);
    if (!todo) return null;
    var now = clock();
    todo.done = !todo.done;
    todo.doneAt = todo.done ? now : null;
    todo.updatedAt = now;
    save();
    return copy(todo);
  }

  // 삭제 실행 취소: createdAt 순서상 원래 자리로 되돌린다.
  function restore(todo) {
    ensureLoaded();
    var t = normalizeTodo(todo);
    if (!t || find(t.id)) return false;
    var i = 0;
    while (i < state.todos.length && state.todos[i].createdAt <= t.createdAt) i++;
    state.todos.splice(i, 0, t);
    save();
    return true;
  }

  // 완료 후 7일 지난 항목 삭제. 지운 개수를 돌려준다.
  function purgeOld(now) {
    ensureLoaded();
    var t = toMs(now), before = state.todos.length;
    state.todos = state.todos.filter(function (x) {
      return !(x.done && x.doneAt !== null && t - x.doneAt >= KEEP_DONE_MS);
    });
    var removed = before - state.todos.length;
    if (removed) save();
    return removed;
  }

  /* ---------- 조회 ---------- */

  // 오늘 할 일 = 미완료 전체 + 오늘 완료한 항목. 미완료(생성순) 다음에 완료(완료순).
  function todayList(now) {
    ensureLoaded();
    var today = dateKey(now);
    var open = [], done = [];
    state.todos.forEach(function (x) {
      if (!x.done) open.push(x);
      else if (dateKey(x.doneAt) === today) done.push(x);
    });
    open.sort(sortByCreated);
    done.sort(function (a, b) { return a.doneAt - b.doneAt; });
    return open.concat(done).map(copy);
  }

  // todayList 기준 { done, total, percent }. category를 생략하면 전체.
  function progress(category, now) {
    var list = todayList(now);
    if (isCat(category)) {
      list = list.filter(function (x) { return x.category === category; });
    }
    var done = list.filter(function (x) { return x.done; }).length;
    var total = list.length;
    return { done: done, total: total, percent: total ? Math.round(done / total * 100) : 0 };
  }

  // 탭별 미완료 개수 { all, work, personal, study }
  function openCounts() {
    ensureLoaded();
    var c = { all: 0, work: 0, personal: 0, study: 0 };
    state.todos.forEach(function (t) {
      if (!t.done) { c.all++; c[t.category]++; }
    });
    return c;
  }

  function getSettings() {
    ensureLoaded();
    var s = state.settings;
    return {
      reminderTime: s.reminderTime, lastCategory: s.lastCategory,
      lastAckDate: s.lastAckDate, lastNotifiedDate: s.lastNotifiedDate, activeTab: s.activeTab
    };
  }

  /* ---------- 매일 확인 알림 ---------- */

  // 미확인 상태(순수 함수): 로컬 시각이 reminderTime 이후이고 lastAckDate가 오늘이 아님.
  // 요일은 보지 않는다(주말 포함). now는 Date 또는 ms. 항상 "지금" 시각과 비교한다.
  function reminderDue(s, now) {
    var d = new Date(toMs(now));
    var at = isTime(s.reminderTime) ? s.reminderTime : '08:00';
    return d.getHours() * 60 + d.getMinutes() >= timeToMin(at) && s.lastAckDate !== dateKey(d);
  }

  // 시스템 알림을 보낼 때(순수 함수): 미확인 상태이고 오늘 아직 알리지 않음.
  function notifyDue(s, now) {
    return reminderDue(s, now) && s.lastNotifiedDate !== dateKey(toMs(now));
  }

  function isReminderDue(now) { return reminderDue(getSettings(), now); }
  function isNotifyDue(now) { return notifyDue(getSettings(), now); }

  // [확인]: 오늘 확인함으로 기록
  function acknowledge(now) {
    ensureLoaded();
    state.settings.lastAckDate = dateKey(now);
    save();
  }

  // 오늘 시스템 알림을 보냈다고 기록
  function markNotified(now) {
    ensureLoaded();
    state.settings.lastNotifiedDate = dateKey(now);
    save();
  }

  // 알림 시각 변경("HH:MM"). 새 시각이 아직 오지 않았다면 오늘 확인·알림 기록을 지워
  // 그 시각에 다시 알리게 한다(시각을 바꿔 보며 확인할 수 있도록). 형식이 틀리면 false.
  function setReminderTime(value, now) {
    ensureLoaded();
    if (!isTime(value)) return false;
    var s = state.settings, d = new Date(toMs(now)), today = dateKey(d);
    s.reminderTime = value;
    if (timeToMin(value) > d.getHours() * 60 + d.getMinutes()) {
      if (s.lastAckDate === today) s.lastAckDate = null;
      if (s.lastNotifiedDate === today) s.lastNotifiedDate = null;
    }
    save();
    return true;
  }

  // 선택한 탭 저장. 허용되지 않는 값이면 false.
  function setActiveTab(tab) {
    ensureLoaded();
    if (TABS.indexOf(tab) === -1) return false;
    state.settings.activeTab = tab;
    save();
    return true;
  }

  // 날짜가 바뀌었으면 purgeOld()를 하고 true. 화면은 true일 때 다시 그린다.
  function checkDay() {
    ensureLoaded();
    var k = dateKey();
    if (k === knownDay) return false;
    knownDay = k;
    purgeOld();
    return true;
  }

  /* ---------- 백업 내보내기/가져오기 ---------- */

  function todoCount() {
    ensureLoaded();
    return state.todos.length;
  }

  // 전체 데이터를 JSON 문자열로(최상위 { version, todos, settings } 그대로)
  function exportData() {
    ensureLoaded();
    return JSON.stringify(state, null, 2);
  }

  function backupFileName(now) { return 'todo-backup-' + dateKey(now) + '.json'; }

  // 백업 객체의 구조 검증(순수 함수). 틀린 곳이 있으면 첫 번째 것을 한 줄로 알려 준다.
  function validateBackup(d) {
    function fail(msg) { return { ok: false, error: msg }; }
    if (!isObj(d)) return fail('백업 파일의 최상위가 객체가 아닙니다');
    if (typeof d.version !== 'number') return fail('version 항목이 없거나 숫자가 아닙니다');
    if (d.version > VERSION) return fail('이 앱보다 새로운 버전(version ' + d.version + ')의 백업입니다');
    if (d.version < 1) return fail('지원하지 않는 version ' + d.version + ' 입니다');
    if (!Array.isArray(d.todos)) return fail('todos 항목이 없거나 배열이 아닙니다');
    var seen = {};
    for (var i = 0; i < d.todos.length; i++) {
      var t = d.todos[i], n = (i + 1) + '번째 할 일의 ';
      if (!isObj(t)) return fail((i + 1) + '번째 할 일이 객체가 아닙니다');
      if (typeof t.id !== 'string' || !t.id) return fail(n + 'id가 없거나 문자열이 아닙니다');
      if (Object.prototype.hasOwnProperty.call(seen, t.id)) return fail(n + 'id가 중복되었습니다');
      seen[t.id] = true;
      if (typeof t.title !== 'string') return fail(n + 'title이 없거나 문자열이 아닙니다');
      var len = t.title.trim().length;
      if (len < 1) return fail(n + 'title이 비어 있습니다');
      if (len > 100) return fail(n + 'title이 100자를 넘습니다(' + len + '자)');
      if (!isCat(t.category)) return fail(n + 'category 값이 올바르지 않습니다(work/personal/study만 가능)');
      if (typeof t.done !== 'boolean') return fail(n + 'done이 없거나 true/false가 아닙니다');
      if (!isNum(t.createdAt)) return fail(n + 'createdAt이 없거나 숫자가 아닙니다');
      if (!isNum(t.updatedAt)) return fail(n + 'updatedAt이 없거나 숫자가 아닙니다');
      if (t.doneAt === undefined) return fail(n + 'doneAt이 없습니다(미완료는 null)');
      if (t.done && !isNum(t.doneAt)) return fail(n + 'doneAt이 숫자가 아닙니다(완료 항목)');
      if (!t.done && t.doneAt !== null) return fail(n + 'doneAt이 null이 아닙니다(미완료 항목)');
    }
    if (d.settings !== undefined && !isObj(d.settings)) return fail('settings 항목이 객체가 아닙니다');
    return { ok: true };
  }

  // 파일에서 읽은 텍스트 → { ok, data } 또는 { ok:false, error }
  function parseBackup(text) {
    var d;
    try { d = JSON.parse(text); } catch (e) { return { ok: false, error: 'JSON 형식이 아닙니다(파일이 깨졌거나 백업 파일이 아닙니다)' }; }
    var v = validateBackup(d);
    return v.ok ? { ok: true, data: d } : v;
  }

  // 검증된 백업으로 교체. 교체 전 현재 데이터는 "<키>-before-import"에 보관한다.
  // 보관이나 저장에 실패하면 아무것도 바꾸지 않고 취소한다. 성공하면 오래된 완료 항목을 정리한다.
  function importBackup(data) {
    ensureLoaded();
    var v = validateBackup(data);
    if (!v.ok) return v;
    var res = migrate(data);
    if (!res || res.dropped) return { ok: false, error: '백업 내용을 해석하지 못했습니다' };
    var prev = state;
    try {
      localStorage.setItem(key + '-before-import', JSON.stringify(prev));
    } catch (e) {
      return { ok: false, error: '현재 데이터를 보관하지 못해 가져오기를 취소했습니다(저장 공간 확인)' };
    }
    // 백업에 settings가 없으면 현재 설정을 유지
    if (!isObj(data.settings)) res.state.settings = prev.settings;
    state = res.state;
    if (!save()) {
      state = prev;
      return { ok: false, error: '저장하지 못해 가져오기를 취소했습니다(저장 공간 확인)' };
    }
    var purged = purgeOld();
    return { ok: true, total: state.todos.length, purged: purged };
  }

  // 테스트용: 저장 키와 시계를 바꾼다(null이면 기본값). 다음 접근 때 새로 불러온다.
  function configure(opts) {
    opts = opts || {};
    if (typeof opts.key === 'string') key = opts.key;
    if ('clock' in opts) {
      clock = typeof opts.clock === 'function' ? opts.clock : function () { return Date.now(); };
    }
    state = null;
    knownDay = null;
  }

  return {
    CATEGORIES: CATEGORIES, TABS: TABS,
    load: load, save: save, migrate: migrate,
    add: add, update: update, remove: remove, toggle: toggle, restore: restore,
    purgeOld: purgeOld, todayList: todayList, progress: progress,
    openCounts: openCounts, checkDay: checkDay,
    reminderDue: reminderDue, notifyDue: notifyDue,
    isReminderDue: isReminderDue, isNotifyDue: isNotifyDue,
    acknowledge: acknowledge, markNotified: markNotified, setReminderTime: setReminderTime,
    todoCount: todoCount, exportData: exportData, backupFileName: backupFileName,
    validateBackup: validateBackup, parseBackup: parseBackup, importBackup: importBackup,
    getSettings: getSettings, setActiveTab: setActiveTab, saveOk: function () { return lastSaveOk; },
    dateKey: dateKey, newId: newId, configure: configure
  };
})();

/* 화면 코드. #todo-list가 있을 때만 실행(tests.html에서는 건너뜀). */
(function () {
  'use strict';
  if (typeof document === 'undefined') return;
  var list = document.getElementById('todo-list');
  if (!list) return;

  var form = document.getElementById('add-form');
  var input = document.getElementById('new-title');
  var select = document.getElementById('new-category');
  var emptyEl = document.getElementById('empty-state');
  var toastEl = document.getElementById('toast');
  var warnEl = document.getElementById('storage-warning');
  var tabsEl = document.getElementById('tabs');
  var tabBtns = tabsEl.querySelectorAll('[role="tab"]');
  var dateEl = document.querySelector('#progress-title time');
  var scopeEl = document.getElementById('progress-scope');
  var textEl = document.getElementById('progress-text');
  var barEl = document.getElementById('progress-bar');
  var doneEl = document.getElementById('progress-done');
  var bannerEl = document.getElementById('reminder-banner');
  var countEl = document.getElementById('reminder-count');
  var ackBtn = document.getElementById('reminder-ack');
  var timeInput = document.getElementById('reminder-time');
  var notifyRow = document.getElementById('notify-row');
  var notifyBtn = document.getElementById('notify-btn');
  var notifyStatus = document.getElementById('notify-status');

  var baseTitle = document.title;
  var TITLE_DUE = '(확인 필요) 할 일';
  var REMINDER_CHECK_MS = 30 * 1000;
  var notifyBroken = false;   // 알림 생성이 한 번 실패하면 이번 접속 동안 다시 시도하지 않음

  var CAT_LABEL = { work: '업무', personal: '개인', study: '공부' };
  var TAB_LABEL = { all: '전체', work: '업무', personal: '개인', study: '공부' };
  var WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
  var TABS = Store.TABS;
  var UNDO_MS = 5000;
  var DAY_CHECK_MS = 60 * 1000;

  var editingId = null;     // 편집 중인 행(한 번에 하나)
  var lastDeleted = null;   // 실행 취소 대상(마지막 삭제만)
  var toastTimer = null;
  var warned = false;

  function el(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  /* ---------- 그리기 ---------- */

  function viewRow(t) {
    var li = el('li', 'todo' + (t.done ? ' is-done' : ''));
    li.dataset.id = t.id;

    var wrap = el('label', 'todo__checkwrap');
    var cb = el('input', 'todo__check');
    cb.type = 'checkbox';
    cb.checked = t.done;
    cb.dataset.role = 'check';
    cb.setAttribute('aria-label', '‘' + t.title + '’ 완료');
    wrap.appendChild(cb);

    var title = el('button', 'todo__title');
    title.type = 'button';
    title.dataset.role = 'title';
    title.title = '더블클릭하여 수정';
    title.textContent = t.title;

    var badge = el('span', 'badge badge--' + t.category);
    badge.textContent = CAT_LABEL[t.category];

    var del = el('button', 'todo__delete');
    del.type = 'button';
    del.dataset.role = 'delete';
    del.setAttribute('aria-label', '‘' + t.title + '’ 삭제');
    del.textContent = '×';

    li.appendChild(wrap);
    li.appendChild(title);
    li.appendChild(badge);
    li.appendChild(del);
    return li;
  }

  function editRow(t, draft) {
    var li = el('li', 'todo is-editing');
    li.dataset.id = t.id;

    var inp = el('input', 'todo__edit-title');
    inp.type = 'text';
    inp.maxLength = 100;
    inp.value = draft ? draft.title : t.title;
    inp.dataset.role = 'edit-title';
    inp.setAttribute('aria-label', '제목 수정');

    var sel = el('select', 'todo__edit-category');
    Store.CATEGORIES.forEach(function (c) {
      var o = el('option');
      o.value = c;
      o.textContent = CAT_LABEL[c];
      sel.appendChild(o);
    });
    sel.value = draft ? draft.category : t.category;
    sel.dataset.role = 'edit-category';
    sel.setAttribute('aria-label', '카테고리');

    li.appendChild(inp);
    li.appendChild(sel);
    return li;
  }

  // 편집 중인 입력값(없으면 null)
  function readEdit() {
    var inp = list.querySelector('[data-role="edit-title"]');
    var sel = list.querySelector('[data-role="edit-category"]');
    return inp && sel ? { title: inp.value, category: sel.value } : null;
  }

  function rowById(id) {
    for (var i = 0; i < list.children.length; i++) {
      if (list.children[i].dataset.id === id) return list.children[i];
    }
    return null;
  }

  function focusRow(id, role) {
    var li = rowById(id);
    if (!li) return false;
    var parts = li.querySelectorAll('[data-role]');
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].dataset.role === role) { parts[i].focus(); return true; }
    }
    return false;
  }

  // 다시 그려도 키보드 포커스가 같은 항목에 남도록
  function rememberFocus() {
    var a = document.activeElement;
    if (!a || !list.contains(a) || !a.dataset || !a.dataset.role) return null;
    var li = a.closest('li');
    if (!li) return null;
    var f = { id: li.dataset.id, role: a.dataset.role };
    if (a.tagName === 'INPUT' && a.type === 'text') { f.s = a.selectionStart; f.e = a.selectionEnd; }
    return f;
  }

  function restoreFocus(f) {
    if (!f || !focusRow(f.id, f.role)) return;
    var a = document.activeElement;
    if (f.s !== undefined && a && a.setSelectionRange) a.setSelectionRange(f.s, f.e);
  }

  function currentTab() { return Store.getSettings().activeTab; }

  // 탭: 선택 표시, 미완료 개수, 키보드 이동용 tabindex
  function renderTabs(tab) {
    var counts = Store.openCounts();
    for (var i = 0; i < tabBtns.length; i++) {
      var b = tabBtns[i], k = b.dataset.tab, on = k === tab;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
      b.querySelector('.tab__count').textContent = counts[k];
      b.setAttribute('aria-label', TAB_LABEL[k] + ', 미완료 ' + counts[k] + '개');
    }
    list.setAttribute('aria-labelledby', 'tab-' + tab);
  }

  // 진행률: 현재 탭 범위 기준
  function renderProgress(tab) {
    var p = Store.progress(tab === 'all' ? undefined : tab);
    var now = new Date();
    var dateText = (now.getMonth() + 1) + '월 ' + now.getDate() + '일 (' + WEEKDAY[now.getDay()] + ')';
    if (dateEl.textContent !== dateText) dateEl.textContent = dateText;
    dateEl.setAttribute('datetime', Store.dateKey(now));
    scopeEl.textContent = TAB_LABEL[tab];
    textEl.textContent = '완료 ' + p.done + ' / ' + p.total + ' (' + p.percent + '%)';
    barEl.value = p.percent;
    barEl.textContent = p.percent + '%';
    barEl.setAttribute('aria-label', TAB_LABEL[tab] + ' 진행률');
    var msg = p.total > 0 && p.done === p.total
      ? (tab === 'all' ? '오늘 할 일을 모두 끝냈습니다' : '오늘 ' + TAB_LABEL[tab] + ' 할 일을 모두 끝냈습니다')
      : '';
    if (doneEl.textContent !== msg) doneEl.textContent = msg;
  }

  // 목록 전체를 Store.todayList()(현재 탭으로 거른 것)로 다시 그린다.
  function render() {
    var focus = rememberFocus();
    var draft = readEdit();
    var tab = currentTab();
    var todos = Store.todayList();
    if (tab !== 'all') todos = todos.filter(function (t) { return t.category === tab; });
    if (editingId && !todos.some(function (t) { return t.id === editingId; })) {
      editingId = null;
      draft = null;
    }
    var frag = document.createDocumentFragment();
    todos.forEach(function (t) {
      frag.appendChild(t.id === editingId ? editRow(t, draft) : viewRow(t));
    });
    list.textContent = '';
    list.appendChild(frag);
    emptyEl.hidden = todos.length > 0;
    renderTabs(tab);
    renderProgress(tab);
    renderReminder();
    restoreFocus(focus);
  }

  /* ---------- 확인 알림 ---------- */

  // 배너·탭 제목을 "지금 시각" 기준 미확인 상태에 맞춘다. 미확인이면 true.
  function renderReminder() {
    var due = Store.isReminderDue();
    bannerEl.hidden = !due;
    if (due) {
      var n = String(Store.openCounts().all);
      if (countEl.textContent !== n) countEl.textContent = n;
    }
    document.title = due ? TITLE_DUE : baseTitle;
    return due;
  }

  function notifySupported() {
    try { return 'Notification' in window && typeof Notification === 'function'; }
    catch (e) { return false; }
  }

  function notifyPermission() {
    try { return Notification.permission; } catch (e) { return 'denied'; }
  }

  // 설정 영역: 권한 상태 표시, 요청할 수 있을 때만 [알림 켜기]
  function renderNotifyUi() {
    var text, canAsk = false;
    if (!notifySupported()) {
      text = '시스템 알림: 이 환경에서는 사용할 수 없습니다. 앱 안 배너로 알려 드립니다.';
    } else {
      var p = notifyPermission();
      if (p === 'granted') text = '시스템 알림 권한: 허용됨';
      else if (p === 'denied') text = '시스템 알림 권한: 차단됨 (브라우저 설정에서 허용해야 합니다)';
      else { text = '시스템 알림 권한: 요청 전'; canAsk = true; }
    }
    notifyRow.hidden = !canAsk;
    if (notifyStatus.textContent !== text) notifyStatus.textContent = text;
  }

  // 시스템 알림(부가 기능): 권한이 있을 때만, 하루 한 번. 실패해도 조용히 배너만 쓴다.
  function maybeNotify() {
    if (notifyBroken || !notifySupported() || notifyPermission() !== 'granted') return;
    if (!Store.isNotifyDue()) return;
    try {
      var n = new Notification('오늘의 할 일', { body: '남은 할 일 ' + Store.openCounts().all + '개' });
      n.onclick = function () {
        try { window.focus(); n.close(); } catch (e) { /* 무시 */ }
      };
      Store.markNotified();
      if (!Store.saveOk()) warnOnce();
    } catch (e) {
      notifyBroken = true;
    }
  }

  // 시작 시·창이 다시 보일 때·30초마다. 정각 타이머가 아니라 항상 현재 시각을 비교한다.
  function checkReminder() {
    var due = renderReminder();
    renderNotifyUi();
    if (due) maybeNotify();
  }

  ackBtn.addEventListener('click', function () {
    var hadFocus = document.activeElement === ackBtn;
    Store.acknowledge();
    afterChange();
    if (hadFocus) {   // 숨겨진 버튼에 있던 포커스를 선택된 탭으로
      var t = tabsEl.querySelector('[aria-selected="true"]');
      if (t) t.focus();
    }
  });

  notifyBtn.addEventListener('click', function () {
    // 권한 요청은 이 버튼을 눌렀을 때만
    function done() { checkReminder(); }
    try {
      var r = Notification.requestPermission(done);   // 옛 Safari는 콜백 방식
      if (r && typeof r.then === 'function') r.then(done, done);
    } catch (e) {
      done();
    }
  });

  timeInput.addEventListener('change', function () {
    if (!timeInput.value) return;   // 입력 도중 비워진 값은 무시(blur에서 복원)
    if (!Store.setReminderTime(timeInput.value)) {
      timeInput.value = Store.getSettings().reminderTime;
      return;
    }
    afterChange();
    checkReminder();
  });
  timeInput.addEventListener('blur', function () {
    if (!timeInput.value) timeInput.value = Store.getSettings().reminderTime;
  });

  // 모든 변경 후: 저장 → 다시 그리기
  function afterChange() {
    if (!Store.save()) warnOnce();
    render();
  }

  function warnOnce() {
    if (warned) return;
    warned = true;
    warnEl.hidden = false;
  }

  /* ---------- 추가 ---------- */

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (editingId) commitEdit(false);
    var todo = Store.add(input.value, select.value);
    if (!todo) {
      if (!input.value.trim()) input.value = '';
      input.focus();
      return;
    }
    input.value = '';
    afterChange();
    input.focus();
  });

  /* ---------- 수정 ---------- */

  function startEdit(id) {
    if (editingId === id) return;
    if (editingId) commitEdit(false);
    editingId = id;
    render();
    var inp = list.querySelector('[data-role="edit-title"]');
    if (inp) { inp.focus(); inp.select(); }
  }

  // refocus: 키보드로 끝냈을 때만 제목 버튼으로 포커스 복귀
  function commitEdit(refocus) {
    var id = editingId;
    if (!id) return;
    var cur = readEdit();
    editingId = null;
    var changes = {};
    var todo = Store.todayList().filter(function (t) { return t.id === id; })[0];
    if (cur && todo) {
      var title = cur.title.trim();
      if (title && title !== todo.title) changes.title = title;   // 빈 제목이면 원래 값 유지
      if (cur.category !== todo.category) changes.category = cur.category;
    }
    if (Object.keys(changes).length && Store.update(id, changes)) afterChange();
    else render();
    if (refocus) focusRow(id, 'title');
  }

  function cancelEdit() {
    var id = editingId;
    if (!id) return;
    editingId = null;
    render();
    focusRow(id, 'title');
  }

  /* ---------- 삭제 + 실행 취소 ---------- */

  function deleteTodo(id) {
    if (editingId) commitEdit(false);
    var idx = Store.todayList().map(function (t) { return t.id; }).indexOf(id);
    var removed = Store.remove(id);
    if (!removed) return;
    afterChange();
    showToast(removed);
    // 키보드 흐름 유지: 그 자리에 온 다음(없으면 이전) 행의 삭제 버튼으로
    var rows = list.children;
    var next = rows[idx] || rows[idx - 1];
    if (next) focusRow(next.dataset.id, 'delete');
    else input.focus();
  }

  function showToast(removed) {
    lastDeleted = removed;
    clearTimeout(toastTimer);
    var box = el('div', 'toast__box');
    var msg = el('span');
    msg.textContent = '삭제했습니다';
    var btn = el('button', 'toast__undo');
    btn.type = 'button';
    btn.textContent = '실행 취소';
    btn.title = 'Ctrl+Z';
    btn.setAttribute('aria-keyshortcuts', 'Control+Z Meta+Z');
    box.appendChild(msg);
    box.appendChild(btn);
    toastEl.textContent = '';
    toastEl.appendChild(box);
    toastTimer = setTimeout(hideToast, UNDO_MS);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    lastDeleted = null;
    toastEl.textContent = '';
  }

  // 마지막 삭제를 되돌린다(토스트가 떠 있는 5초 동안만)
  function undoDelete() {
    var t = lastDeleted;
    hideToast();
    if (t && Store.restore(t)) {
      afterChange();
      focusRow(t.id, 'check');
    }
  }

  toastEl.addEventListener('click', function (e) {
    if (e.target.closest('.toast__undo')) undoDelete();
  });

  /* ---------- 완료 ---------- */

  function toggleTodo(id) {
    if (editingId) commitEdit(false);
    if (Store.toggle(id)) afterChange();
  }

  /* ---------- 목록 이벤트 (위임, 한 번만) ---------- */

  function isTouchTap(e) {
    return e.pointerType === 'touch' ||
      (window.matchMedia && window.matchMedia('(hover: none)').matches);
  }

  function partOf(e) {
    var t = e.target;
    if (!t || !t.closest) return null;
    var part = t.closest('[data-role]');
    var li = part && part.closest('li[data-id]');
    return li && list.contains(li) ? { role: part.dataset.role, id: li.dataset.id, li: li } : null;
  }

  list.addEventListener('click', function (e) {
    var p = partOf(e);
    if (!p) return;
    if (p.role === 'delete') {
      deleteTodo(p.id);
    } else if (p.role === 'title') {
      // 모바일은 탭, 키보드(Enter/Space)는 detail 0. 마우스는 더블클릭으로.
      if (e.detail === 0 || isTouchTap(e)) startEdit(p.id);
    }
  });

  list.addEventListener('dblclick', function (e) {
    var p = partOf(e);
    if (p && p.role === 'title') startEdit(p.id);
  });

  // 체크박스: 클릭·Space 모두 change로 처리
  list.addEventListener('change', function (e) {
    var p = partOf(e);
    if (p && p.role === 'check') toggleTodo(p.id);
  });

  list.addEventListener('keydown', function (e) {
    var p = partOf(e);
    if (!p || (p.role !== 'edit-title' && p.role !== 'edit-category')) return;
    if (e.isComposing || e.keyCode === 229) return;   // 한글 조합 중 Enter 무시
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(true); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
  });

  // 포커스 이탈 = 저장 (같은 행 안에서 옮겨 가는 경우는 제외)
  list.addEventListener('focusout', function (e) {
    var p = partOf(e);
    if (!p || p.role.indexOf('edit-') !== 0) return;
    var id = p.id;
    setTimeout(function () {
      if (editingId !== id) return;
      var cur = list.querySelector('li.is-editing');
      if (cur && cur.contains(document.activeElement)) return;
      commitEdit(false);
    }, 0);
  });

  /* ---------- 백업 내보내기/가져오기 ---------- */

  var backupMsg = document.getElementById('backup-msg');
  var importFile = document.getElementById('import-file');
  var MAX_IMPORT_BYTES = 5 * 1024 * 1024;

  function showBackupMsg(text, isError) {
    backupMsg.textContent = text;
    backupMsg.classList.toggle('is-error', !!isError);
  }

  // 설정 값을 입력 줄·설정 영역에 반영(시작할 때, 가져온 뒤)
  function syncSettingsUi() {
    var s = Store.getSettings();
    // 카테고리 탭이면 그 카테고리, 전체 탭이면 마지막에 쓴 카테고리
    select.value = s.activeTab !== 'all' ? s.activeTab : s.lastCategory;
    timeInput.value = s.reminderTime;
  }

  document.getElementById('export-btn').addEventListener('click', function () {
    try {
      var name = Store.backupFileName();
      var blob = new Blob([Store.exportData()], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      showBackupMsg('내보냈습니다: ' + name);
    } catch (e) {
      showBackupMsg('내보내지 못했습니다: ' + (e && e.message ? e.message : e), true);
    }
  });

  document.getElementById('import-btn').addEventListener('click', function () {
    importFile.click();
  });

  importFile.addEventListener('change', function () {
    var file = importFile.files && importFile.files[0];
    importFile.value = '';   // 같은 파일을 다시 골라도 change가 오도록
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      showBackupMsg('가져올 수 없습니다: 파일이 너무 큽니다(5MB 초과). 기존 데이터는 그대로입니다.', true);
      return;
    }
    var reader = new FileReader();
    reader.onerror = function () {
      showBackupMsg('가져올 수 없습니다: 파일을 읽지 못했습니다. 기존 데이터는 그대로입니다.', true);
    };
    reader.onload = function () { importText(String(reader.result)); };
    reader.readAsText(file);
  });

  function importText(text) {
    var r = Store.parseBackup(text);
    if (!r.ok) {
      showBackupMsg('가져올 수 없습니다: ' + r.error + '. 기존 데이터는 그대로입니다.', true);
      return;
    }
    var msg = '현재 할 일 ' + Store.todoCount() + '개를 백업의 ' + r.data.todos.length + '개로 바꿉니다. 계속할까요?';
    if (!window.confirm(msg)) {
      showBackupMsg('가져오기를 취소했습니다. 기존 데이터는 그대로입니다.');
      return;
    }
    if (editingId) commitEdit(false);
    var res = Store.importBackup(r.data);
    if (!res.ok) {
      showBackupMsg('가져올 수 없습니다: ' + res.error + '. 기존 데이터는 그대로입니다.', true);
      return;
    }
    editingId = null;
    hideToast();   // 이전 데이터 기준의 실행 취소는 무효
    syncSettingsUi();
    render();
    checkReminder();
    showBackupMsg('가져왔습니다: 할 일 ' + res.total + '개' +
      (res.purged ? ' (완료 후 7일이 지난 ' + res.purged + '개는 정리했습니다)' : ''));
  }

  /* ---------- 탭 ---------- */

  function setTab(tab, focusTab) {
    if (TABS.indexOf(tab) === -1) return;
    if (editingId) commitEdit(false);
    Store.setActiveTab(tab);
    if (tab !== 'all') select.value = tab;   // 카테고리 탭이면 입력 줄 기본값을 맞춘다
    afterChange();
    if (focusTab) tabsEl.querySelector('[data-tab="' + tab + '"]').focus();
  }

  tabsEl.addEventListener('click', function (e) {
    var b = e.target.closest('[role="tab"]');
    if (b) setTab(b.dataset.tab, false);
  });

  // 탭 사이 좌우 화살표(처음/끝은 Home/End). 이동하면 바로 선택.
  tabsEl.addEventListener('keydown', function (e) {
    var b = e.target.closest('[role="tab"]');
    if (!b) return;
    var i = TABS.indexOf(b.dataset.tab), n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') n = (i + TABS.length - 1) % TABS.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = TABS.length - 1;
    if (n < 0) return;
    e.preventDefault();
    setTab(TABS[n], true);
  });

  /* ---------- 단축키: N = 입력창, 1~4 = 탭 ---------- */

  function isTyping(a) {
    return !!a && (a.isContentEditable || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' ||
      (a.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|reset)$/.test(a.type)));
  }

  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.isComposing) return;
    // Ctrl/Cmd+Z: 방금 한 삭제 취소(키보드로는 5초 안에 토스트에 닿기 어렵다). 글자 입력 중에는 브라우저 기본 되돌리기를 둔다.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'z' || e.key === 'Z' || e.code === 'KeyZ')) {
      if (lastDeleted && !isTyping(e.target)) { e.preventDefault(); undoDelete(); }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTyping(e.target)) return;
    if (e.key === 'n' || e.key === 'N' || e.code === 'KeyN') {
      e.preventDefault();
      input.focus();
    } else if (/^[1-4]$/.test(e.key)) {
      e.preventDefault();
      setTab(TABS[Number(e.key) - 1], false);
    }
  });

  /* ---------- 날짜 변경 ---------- */

  // 날짜가 바뀌었으면 Store가 purgeOld()를 하고, 여기서 다시 그린다.
  function checkDay() {
    if (Store.checkDay()) render();
  }
  setInterval(checkDay, DAY_CHECK_MS);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') { checkDay(); checkReminder(); checkForUpdate(); }
  });
  setInterval(checkReminder, REMINDER_CHECK_MS);

  /* ---------- 서비스 워커 (부가 기능: http/https에서만) ---------- */

  var swReg = null;
  var refreshing = false;

  function showUpdate(worker) {
    var banner = document.getElementById('update-banner');
    var btn = document.getElementById('update-reload');
    if (!banner || !btn) return;
    banner.hidden = false;
    btn.onclick = function () {
      refreshing = true;
      try { worker.postMessage({ type: 'SKIP_WAITING' }); } catch (e) { /* 아래 reload로 대체 */ }
      setTimeout(function () { location.reload(); }, 2000);   // controllerchange가 안 와도 멈추지 않게
    };
  }

  function checkForUpdate() {
    if (swReg) swReg.update().catch(function () { /* 오프라인 등은 무시 */ });
  }

  function registerSW() {
    if ((location.protocol !== 'http:' && location.protocol !== 'https:') ||
        !('serviceWorker' in navigator)) return;
    try {
      // 사용자가 [새로고침]을 누른 뒤 새 워커가 제어를 넘겨받으면 한 번만 다시 불러온다.
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (refreshing) location.reload();
      });
      navigator.serviceWorker.register('sw.js').then(function (reg) {
        swReg = reg;
        // 이미 대기 중인 새 버전(첫 설치는 제외)
        if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
        reg.addEventListener('updatefound', function () {
          var w = reg.installing;
          if (!w) return;
          w.addEventListener('statechange', function () {
            if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdate(w);
          });
        });
      }).catch(function (err) {
        console.warn('서비스 워커를 등록하지 못했습니다:', err);
      });
    } catch (err) {
      console.warn('서비스 워커를 등록하지 못했습니다:', err);
    }
  }

  if (document.readyState === 'complete') registerSW();
  else window.addEventListener('load', registerSW);

  /* ---------- 시작 ---------- */

  Store.load();
  syncSettingsUi();
  render();
  checkReminder();
})();
