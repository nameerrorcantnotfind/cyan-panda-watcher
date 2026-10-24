// Cyan Panda Watcher — content.js (isolated world)
// Vai trò: (1) nhận data TikTok tự trả về từ hook.js -> chuẩn hoá -> chống trùng -> đẩy Supabase
//         (2) quét DOM trang Tin nhắn (tầng dự phòng) (3) heartbeat để tool web thấy Watcher còn sống
//         (4) thực thi lệnh gửi trong bảng queue khi chủ tài khoản BẬT chế độ tự gửi (mặc định TẮT)
//         (5) v1.1: nhà là Business Suite messages — mọi thao tác (quét/gửi/mở) đều diễn ra ở đó;
//             tìm hội thoại bằng cả tên hiển thị + @username (không dấu), có cuộn tải thêm + search dự phòng;
//             nhận lệnh mở hội thoại từ tool web qua app_state watcher_open.
// Mọi thao tác gửi đều: claim lệnh trước -> mở hội thoại bằng CLICK nội trang -> điền thẳng ô chat
// (không dùng clipboard của máy) -> gửi -> thấy bong bóng tin mới ghi 'sent', không thấy là 'failed'.
(function () {
  'use strict';
  var D = window.PANDA_WATCHER_DEFAULTS || {};
  var CORE = window.PandaCaptureCore;
  if (!CORE) return;

  var cfg = Object.assign({}, D);
  var state = { account: '', startedAt: Date.now(), lastSync: null, lastPush: 0, pushedTotal: 0, capturedTotal: 0, captcha: false, lastError: '', queueBusy: false };
  var pushedKeys = new Set();
  var buffer = [];
  var flushTimer = null;

  function storageGet() {
    return new Promise(function (res) {
      try { chrome.storage.local.get(['pandaWatcherCfg', 'pandaWatcherStats'], function (o) { res(o || {}); }); }
      catch (e) { res({}); }
    });
  }
  function storageSet(o) {
    return new Promise(function (res) { try { chrome.storage.local.set(o, function () { res(); }); } catch (e) { res(); } });
  }

  function supa(path, opts) {
    opts = opts || {};
    var headers = { apikey: cfg.supaKey, Authorization: 'Bearer ' + cfg.supaKey, 'Content-Type': 'application/json' };
    if (opts.headers) Object.assign(headers, opts.headers);
    return fetch(cfg.supaUrl.replace(/\/$/, '') + '/rest/v1/' + path, { method: opts.method || 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) { return r.text().then(function (t) { return { ok: r.ok, status: r.status, json: t ? safeJson(t) : null, text: t }; }); });
  }
  function safeJson(t) { try { return JSON.parse(t); } catch (e) { return null; } }

  function logBE(action, message, code) {
    supa('logs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: { action: action, result: 'watcher', code: code || 'WATCHER', message: String(message || '').slice(0, 500) } }).catch(function () {});
  }

  function guessAccount() {
    if (cfg.account) return cfg.account.replace(/^@/, '');
    var a = document.querySelector('a[href^="/@"]');
    if (a) { var m = a.getAttribute('href').match(/^\/@([^\/]+)/); if (m) return m[1]; }
    return state.account || '';
  }

  /* ---------- v1.1: Business Suite home + tim hoi thoai (ten hien thi + @username, khong dau) ---------- */
  var BS_HOME = 'https://www.tiktok.com/business-suite/messages';
  function isMessagesPage() { return location.pathname.indexOf('/messages') !== -1; }
  function normText(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function rowCandidates() {
    var list = [];
    var seen = new Set();
    var sels = ['[data-e2e="chat-list-item"]', '[class*="ChatListItem"]', '[class*="ConversationItem"]', 'a[href*="/messages"]'];
    sels.forEach(function (sel) {
      try { document.querySelectorAll(sel).forEach(function (el) { if (!seen.has(el)) { seen.add(el); list.push(el); } }); } catch (e) {}
    });
    return list;
  }
  function rowMatches(el, names) {
    var t = normText(el.innerText || '');
    if (!t) return false;
    for (var i = 0; i < names.length; i++) { var n = names[i]; if (n && t.indexOf(n) !== -1) return true; }
    return false;
  }
  function findConversationEl(username, displayName) {
    var names = [];
    if (displayName) names.push(normText(displayName));
    if (username) { names.push(normText(username)); names.push(normText(String(username).replace(/^@/, ''))); }
    var items = rowCandidates();
    for (var i = 0; i < items.length; i++) { if (rowMatches(items[i], names)) return items[i]; }
    // Fallback: khoi chua ten trong cot Tin nhan (khi class hash doi, selector cu khong trung)
    var heads = Array.prototype.slice.call(document.querySelectorAll('h2'));
    for (var h = 0; h < heads.length; h++) {
      if (normText(heads[h].innerText) !== 'tin nhan') continue;
      var col = heads[h].parentElement;
      if (!col) continue;
      var divs = col.querySelectorAll('div');
      for (var d = 0; d < divs.length; d++) {
        var dt = normText(divs[d].innerText || '');
        if (dt && names.some(function (n) { return n && dt.indexOf(n) === 0; })) return divs[d];
      }
    }
    return null;
  }
  function findScrollContainer() {
    var items = rowCandidates();
    var el = items.length ? items[0] : null;
    while (el && el !== document.body) {
      if (el.scrollHeight > el.clientHeight + 20) return el;
      el = el.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }
  async function scrollListToFind(username, displayName) {
    var el = findConversationEl(username, displayName);
    if (el) return el;
    var box = findScrollContainer();
    for (var step = 0; step < 10 && !el; step++) {
      try { box.scrollTop = box.scrollTop + 900; } catch (e) {}
      await sleep(900);
      el = findConversationEl(username, displayName);
    }
    if (el) return el;
    // Cuoi cung: o Tim kiem chung cua trang (chua xac minh co loc hoi thoai khong — chi thu, khong bao dam)
    try {
      var sb = document.querySelector('input[role="searchbox"], input[placeholder*="Tìm kiếm"], input[aria-label*="Tìm kiếm"]');
      var q = displayName || username || '';
      if (sb && q) {
        sb.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, q);
        sb.dispatchEvent(new InputEvent('input', { bubbles: true, data: q }));
        await sleep(2000);
        el = findConversationEl(username, displayName);
      }
    } catch (e) {}
    return el;
  }
  async function goBusinessSuite() {
    if (isMessagesPage()) return;
    location.href = BS_HOME;
    await sleep(4500);
  }

  /* ---------- Nhận data từ hook (page world) ---------- */
  window.addEventListener('message', function (ev) {
    if (ev.origin !== location.origin || !ev.data || ev.data.__panda !== 'capture') return;
    if (!cfg.captureEnabled) return;
    var body = ev.data.body || '';
    if (!body) return;
    var json = safeJson(body);
    if (!json) return;
    state.capturedTotal++;
    var raws = [];
    try { raws = CORE.scanJsonForMessages(json, guessAccount()); } catch (e) {}
    for (var i = 0; i < raws.length; i++) enqueue(raws[i]);
  });

  function enqueue(raw) {
    var row = CORE.normalizeMessage(raw, cfg.source);
    if (!row) return;
    if (pushedKeys.has(row.dedupe_key)) return;
    pushedKeys.add(row.dedupe_key);
    buffer.push(row);
    if (!flushTimer) flushTimer = setTimeout(flush, 2500);
  }

  function flush() {
    flushTimer = null;
    if (!buffer.length) return;
    var rows = buffer.splice(0, buffer.length);
    var keys = rows.map(function (r) { return r.dedupe_key; });
    var q = 'messages?select=dedupe_key&dedupe_key=in.(' + keys.map(function (k) { return '"' + k.replace(/"/g, '') + '"'; }).join(',') + ')';
    supa(q).then(function (res) {
      var existing = {};
      if (res.ok && Array.isArray(res.json)) res.json.forEach(function (r) { existing[r.dedupe_key] = 1; });
      var fresh = rows.filter(function (r) { return !existing[r.dedupe_key]; });
      if (!fresh.length) { state.lastSync = new Date().toISOString(); saveStats(); return; }
      if (cfg.accountId) fresh.forEach(function (r) { r.account_id = cfg.accountId; });
      return supa('messages', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: fresh }).then(function (r2) {
        if (r2.ok) {
          state.lastPush = fresh.length;
          state.pushedTotal += fresh.length;
          state.lastSync = new Date().toISOString();
          state.lastError = '';
          logBE('WATCHER_SYNC', '+' + fresh.length + ' tin mới từ TikTok web -> Supabase', 'WATCHER_001');
        } else {
          state.lastError = 'Supabase từ chối ghi (HTTP ' + r2.status + ') — có thể chưa chạy migration v3.11 (thiếu cột source/dedupe_key/meta).';
          fresh.forEach(function (r) { pushedKeys.delete(r.dedupe_key); });
        }
        saveStats(); renderChip();
      });
    }).catch(function (e) { state.lastError = 'Lỗi mạng khi đẩy Supabase: ' + e.message; saveStats(); renderChip(); });
  }

  /* ---------- Quét DOM (tầng dự phòng, best-effort) ---------- */
  function parseVnTime(txt) {
    if (!txt) return null;
    var m = String(txt).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0));
    m = String(txt).match(/(\d{1,2}):(\d{2})/);
    if (m) { var d = new Date(); d.setHours(+m[1], +m[2], 0, 0); return d; }
    return null;
  }

  function domScan() {
    if (!cfg.captureEnabled || location.pathname.indexOf('/messages') === -1) return;
    try {
      // Danh sách hội thoại: các hàng có avatar + tên + preview (heuristic, ghi via:'dom')
      var items = document.querySelectorAll('[data-e2e="chat-list-item"], [class*="ChatListItem"], [class*="ConversationItem"]');
      state.account = guessAccount();
      // Bong bóng tin trong hội thoại đang mở
      var bubbles = document.querySelectorAll('[data-e2e*="message-item"], [class*="MessageItem"], [class*="ChatMessage"]');
      var title = '';
      var header = document.querySelector('[data-e2e="chat-header"], [class*="ChatHeader"]');
      if (header) title = (header.innerText || '').split('\n')[0].trim();
      bubbles.forEach(function (b) {
        var txt = (b.innerText || '').trim();
        if (!txt || txt.length > 2000) return;
        var rect = b.getBoundingClientRect();
        var parent = b.closest('[class*="Chat"]') || document.body;
        var pr = parent.getBoundingClientRect();
        var isOut = (rect.left + rect.width / 2) > (pr.left + pr.width / 2);
        var timeEl = b.querySelector('time, [class*="Time"], [class*="time"]');
        enqueue({ account: state.account, counterpartName: title, direction: isOut ? 'out' : 'in', content: txt.split('\n')[0], at: parseVnTime(timeEl ? timeEl.innerText : '') || new Date(), via: 'dom' });
      });
      if (items.length) state.lastDomList = items.length;
    } catch (e) {}
  }

  /* ---------- CAPTCHA ---------- */
  function detectCaptcha() {
    var found = !!document.querySelector('iframe[src*="captcha"], [class*="captcha"], [id*="captcha"], div[data-e2e*="captcha"]');
    if (found !== state.captcha) {
      state.captcha = found;
      if (found) logBE('WATCHER_CAPTCHA', 'TikTok hiện CAPTCHA — Watcher đã dừng tự gửi, chờ chủ tài khoản xử lý tay.', 'WATCHER_002');
      saveStats(); renderChip();
    }
    return found;
  }

  /* ---------- Heartbeat ---------- */
  function heartbeat() {
    state.account = guessAccount();
    var value = { account: state.account, accountId: cfg.accountId || '', url: location.href, at: new Date().toISOString(), version: '1.1.1', pushedTotal: state.pushedTotal, capturedTotal: state.capturedTotal, captcha: state.captcha, lastError: state.lastError };
    supa('app_state?on_conflict=key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: { key: 'watcher_status', value: value, updated_at: new Date().toISOString() } }).catch(function () {});
    saveStats();
  }
  function saveStats() {
    storageSet({ pandaWatcherStats: { lastSync: state.lastSync, lastPush: state.lastPush, pushedTotal: state.pushedTotal, capturedTotal: state.capturedTotal, captcha: state.captcha, lastError: state.lastError, account: state.account, at: Date.now() } });
  }

  /* ---------- Thực thi hàng đợi gửi (chỉ khi BẬT tự trả lời) ---------- */
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function setComposerText(el, text) {
    el.focus();
    try {
      var proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLElement.prototype;
      var setter = Object.getOwnPropertyDescriptor(proto, el.tagName === 'TEXTAREA' ? 'value' : 'innerText');
      if (el.tagName === 'TEXTAREA' && setter && setter.set) { setter.set.call(el, text); }
      else { document.execCommand('selectAll', false, null); document.execCommand('insertText', false, text); }
    } catch (e) {
      try { document.execCommand('selectAll', false, null); document.execCommand('insertText', false, text); } catch (e2) {}
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
  }

  async function executeJob(job) {
    var target = job.fan_username;
    await goBusinessSuite();
    var el = await scrollListToFind(target, '');
    if (!el) throw new Error('Không tìm thấy hội thoại của ' + target + ' trong danh sách (đã cuộn + thử search)');
    el.click();
    await sleep(2500);
    if (detectCaptcha()) throw new Error('CAPTCHA đang hiện — dừng gửi');
    var composer = document.querySelector('[data-e2e="message-input"] textarea, [data-e2e="message-input"] [contenteditable="true"], div[class*="Composer"] textarea, div[class*="Composer"] [contenteditable="true"]');
    if (!composer) throw new Error('Không tìm thấy ô nhập tin nhắn');
    setComposerText(composer, job.content);
    await sleep(1200);
    var before = (document.querySelectorAll('[data-e2e*="message-item"], [class*="MessageItem"]').length);
    var sendBtn = document.querySelector('[data-e2e="message-send"], button[aria-label*="Send"], button[aria-label*="Gửi"]');
    if (sendBtn) sendBtn.click();
    else composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    await sleep(2500);
    var bubbles = document.querySelectorAll('[data-e2e*="message-item"], [class*="MessageItem"], [class*="ChatMessage"]');
    var ok = false;
    bubbles.forEach(function (b) { if ((b.innerText || '').indexOf(job.content.slice(0, 40)) !== -1) ok = true; });
    if (!ok && bubbles.length <= before) throw new Error('Đã bấm gửi nhưng không thấy bong bóng tin xuất hiện');
    return true;
  }

  function pollQueue() {
    if (!cfg.autoSendEnabled || state.queueBusy || state.captcha) return;
    var aq = cfg.accountId ? '&account_id=eq.' + encodeURIComponent(cfg.accountId) : '&account_id=is.null';
    supa('queue?select=*&status=eq.approved' + aq + '&order=created_at.asc&limit=1').then(async function (res) {
      if (!res.ok || !Array.isArray(res.json) || !res.json.length) return;
      var job = res.json[0];
      state.queueBusy = true;
      // Claim: chỉ sửa được khi status vẫn là approved (tránh 2 tab gửi trùng)
      var claim = await supa('queue?id=eq.' + job.id + '&status=eq.approved', { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: { status: 'sending' } });
      if (!claim.ok || !Array.isArray(claim.json) || !claim.json.length) { state.queueBusy = false; return; }
      try {
        await executeJob(job);
        await supa('queue?id=eq.' + job.id, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { status: 'sent' } });
        logBE('WATCHER_SENT', 'Đã gửi tin cho @' + job.fan_username + ' qua TikTok web', 'WATCHER_003');
      } catch (e) {
        await supa('queue?id=eq.' + job.id, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { status: 'failed' } });
        logBE('WATCHER_FAIL', 'Gửi tin cho @' + job.fan_username + ' thất bại: ' + e.message, 'WATCHER_004');
        state.lastError = 'Gửi thất bại: ' + e.message;
      }
      state.queueBusy = false;
      saveStats(); renderChip();
    }).catch(function () {});
  }

  /* ---------- v1.1: lenh mo hoi thoai tu tool web (app_state watcher_open) ---------- */
  var lastOpenAt = 0;
  function pollOpenCommand() {
    if (state.queueBusy) return;
    supa('app_state?select=value&key=eq.watcher_open').then(async function (res) {
      var v = res.ok && Array.isArray(res.json) && res.json[0] ? res.json[0].value : null;
      if (!v || !v.at) return;
      var at = Date.parse(v.at) || 0;
      if (!at || at <= lastOpenAt || Date.now() - at > 120000) return;
      lastOpenAt = at;
      state.queueBusy = true;
      try {
        await goBusinessSuite();
        var el = await scrollListToFind(v.username, v.displayName);
        if (!el) { logBE('WATCHER_OPEN_FAIL', 'Tool yêu cầu mở @' + (v.username || '') + ' nhưng không tìm thấy hội thoại', 'WATCHER_005'); }
        else { el.click(); await sleep(1500); logBE('WATCHER_OPEN', 'Đã mở hội thoại @' + (v.username || '') + ' theo lệnh từ tool web', 'WATCHER_005'); }
        var nv = Object.assign({}, v, { handled: true, handledAt: new Date().toISOString() });
        supa('app_state?on_conflict=key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: { key: 'watcher_open', value: nv, updated_at: new Date().toISOString() } }).catch(function () {});
      } catch (e) { logBE('WATCHER_OPEN_FAIL', 'Lệnh mở từ tool lỗi: ' + e.message, 'WATCHER_005'); }
      state.queueBusy = false;
    }).catch(function () {});
  }

  /* ---------- Chip trạng thái trên trang ---------- */
  var chip = null;
  function renderChip() {
    if (!chip) return;
    var hb = Math.round((Date.now() - state.startedAt) / 1000);
    chip.innerHTML = '🐼 Panda Watcher ' + (state.captcha ? '<b style="color:#ff8a80">⛔ CAPTCHA — đã dừng</b>' : '<b style="color:#9fe8a9">● đang canh</b>') +
      '<br>Đã đẩy: <b>' + state.pushedTotal + '</b> tin · Bắt được: ' + state.capturedTotal + ' gói' +
      (state.lastSync ? '<br>Đồng bộ cuối: ' + new Date(state.lastSync).toLocaleTimeString('vi-VN') : '') +
      (state.lastError ? '<br><span style="color:#ffb74d">' + state.lastError.slice(0, 120) + '</span>' : '') +
      '<br><span style="opacity:.75;font-size:11px">Chạy ' + hb + 's · Tự trả lời: ' + (cfg.autoSendEnabled ? 'BẬT' : 'tắt') + '</span>';
  }
  function buildChip() {
    if (chip || !document.body) return;
    chip = document.createElement('div');
    chip.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;background:#10281a;color:#eaffea;border:1px solid #2E7D32;border-radius:14px;padding:9px 12px;font:12.5px/1.5 sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35);max-width:290px';
    document.body.appendChild(chip);
    renderChip();
  }

  /* ---------- Khởi động ---------- */
  function injectHook() {
    try {
      var s = document.createElement('script');
      s.src = chrome.runtime.getURL('src/hook.js');
      s.onload = function () { s.remove(); };
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {}
  }

  storageGet().then(function (o) {
    if (o.pandaWatcherCfg) cfg = Object.assign({}, cfg, o.pandaWatcherCfg);
    injectHook();
    buildChip();
    setInterval(buildChip, 4000);
    setInterval(renderChip, 5000);
    setInterval(domScan, (cfg.domScanSec || 20) * 1000);
    setInterval(heartbeat, (cfg.heartbeatSec || 60) * 1000);
    setInterval(function () { detectCaptcha(); pollQueue(); }, (cfg.queuePollSec || 8) * 1000);
    setInterval(pollOpenCommand, (cfg.openPollSec || 10) * 1000);
    setTimeout(function () { domScan(); heartbeat(); }, 3000);
    logBE('WATCHER_START', 'Watcher khởi động trên tab TikTok (account: ' + (guessAccount() || 'chưa rõ') + ')', 'WATCHER_000');
  });

  try {
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (msg && msg.type === 'PANDA_SCAN_NOW') { domScan(); flush(); heartbeat(); sendResponse({ ok: true, pushedTotal: state.pushedTotal }); }
      if (msg && msg.type === 'PANDA_GET_STATE') { sendResponse({ state: state, cfg: { captureEnabled: cfg.captureEnabled, autoSendEnabled: cfg.autoSendEnabled, account: cfg.account } }); }
      return true;
    });
  } catch (e) {}
})();
