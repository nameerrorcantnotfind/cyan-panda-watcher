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
  var state = { account: '', identity: null, profileById: {}, profileByName: {}, domSeen: {}, startedAt: Date.now(), lastSync: null, lastPush: 0, pushedTotal: 0, capturedTotal: 0, captcha: false, lastError: '', queueBusy: false, listStats: null, blockedUnknown: 0, scanTotal: 0, scanBlocked: 0, lastScanAllBlocked: false, lastBlockReason: '', lastLoggedBlocked: -1, lastListDiag: null };
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
    // v1.2.2: ưu tiên identity tự nhận từ chính tab TikTok (passport account/info),
    // rồi mới tới username điền tay trong popup, rồi link profile trên trang.
    if (state.identity && state.identity.username) return state.identity.username;
    if (cfg.account) return cfg.account.replace(/^@/, '');
    var a = document.querySelector('a[href^="/@"]');
    if (a) { var m = a.getAttribute('href').match(/^\/@([^\/]+)/); if (m) return m[1]; }
    return state.account || '';
  }

  /* ---------- v1.2.4: Fallback identity DOM — NHIỀU selector, log selector đã khớp ---------- */
  // Heuristic v1.2.3 (link avatar header/nav, top<150 + có ảnh) CHƯA kiểm chứng trên header
  // thật của Business Suite — header thật có thể dùng cấu trúc khác nên fallback cũ có thể
  // không nhận ra. v1.2.4 thử NHIỀU chiến lược theo thứ tự ưu tiên, lấy cái đầu tiên khớp,
  // và LOG selector đã khớp (BE log WATCHER_006 + lưu vào pandaWatcherIdentity.selector)
  // để chẩn đoán sau. Chỉ nhận link/ảnh trong vùng header/nav hoặc dải trên (top<150) —
  // KHÔNG lấy link /@ bất kỳ trên trang (tiêu đề hội thoại có thể link tới đối tác,
  // lấy nhầm sẽ gắn sai tài khoản). Identity mạng (source 'tab') luôn thắng và không
  // bao giờ bị DOM ghi đè.
  var domIdentityLogged = '';
  var domIdentityDiagLogged = false;   // v1.2.5: chỉ log chẩn đoán identity 1 lần/phiên, tránh spam mỗi nhịp
  function elInTopBar(node) {
    while (node) {
      var tag = node.tagName || '';
      if (tag === 'HEADER' || tag === 'NAV') return true;
      try { if (node.getAttribute && node.getAttribute('role') === 'banner') return true; } catch (e) {}
      node = node.parentElement;
    }
    return false;
  }
  function elTop(node) { try { var r = node.getBoundingClientRect(); return r ? r.top : 1e9; } catch (e) { return 1e9; } }
  function elHasImg(node) { try { return !!node.querySelector('img'); } catch (e) { return false; } }
  function domIdentityCandidates() {
    var buckets = { 'header-avatar-img': [], 'header-link': [], 'top-avatar-img': [], 'header-aria': [], 'avatar-alt': [] };
    function push(bucket, u) { if (u && buckets[bucket].indexOf(u) === -1) buckets[bucket].push(u); }
    var userRe = /^\/@([A-Za-z0-9._]{2,24})(?:[?#\/]|$)/;
    var atRe = /@([A-Za-z0-9._]{2,24})/;
    try {
      var links = document.querySelectorAll('a');
      for (var i = 0; i < links.length; i++) {
        var href = '';
        try { href = links[i].getAttribute ? (links[i].getAttribute('href') || '') : ''; } catch (e) {}
        var m = href.match(userRe);
        if (!m) continue;
        var inTop = elInTopBar(links[i]);
        var hasImg = elHasImg(links[i]);
        var top = elTop(links[i]);
        if (inTop && hasImg && top < 150) push('header-avatar-img', m[1]);
        else if (inTop) push('header-link', m[1]);
        else if (hasImg && top < 150) push('top-avatar-img', m[1]);
      }
      var all = document.querySelectorAll('*');
      for (var j = 0; j < all.length; j++) {
        if (!elInTopBar(all[j])) continue;
        var attrs = [];
        try { attrs.push(all[j].getAttribute ? (all[j].getAttribute('aria-label') || '') : ''); attrs.push(all[j].getAttribute ? (all[j].getAttribute('title') || '') : ''); } catch (e) {}
        for (var k = 0; k < attrs.length; k++) {
          var am = String(attrs[k] || '').match(atRe);
          if (am) push('header-aria', am[1]);
        }
      }
      var imgs = document.querySelectorAll('img');
      for (var q = 0; q < imgs.length; q++) {
        var alt = '';
        try { alt = (imgs[q].getAttribute ? (imgs[q].getAttribute('alt') || '') : '') + ' ' + (imgs[q].getAttribute ? (imgs[q].getAttribute('title') || '') : ''); } catch (e) {}
        var im = alt.match(atRe);
        if (im && elTop(imgs[q]) < 150) push('avatar-alt', im[1]);
      }
    } catch (e) {}
    var order = ['header-avatar-img', 'header-link', 'top-avatar-img', 'header-aria', 'avatar-alt'];
    var out = [];
    for (var s = 0; s < order.length; s++) {
      for (var t = 0; t < buckets[order[s]].length; t++) out.push({ username: buckets[order[s]][t], selector: order[s] });
    }
    return out;
  }
  function detectDomIdentity() {
    if (state.identity && state.identity.source === 'tab') return state.identity;
    try {
      var cands = domIdentityCandidates();
      if (!cands.length) {
        // v1.2.5 chẩn đoán (không đổi logic nhận diện): khi không khớp link nào, log 1 dòng
        // BE ghi số link /@ trong vùng header và số gói allowlist đã thấy trong phiên
        // (capturedTotal) để lần chẩn đoán sau có số liệu thay vì đoán.
        if (!domIdentityDiagLogged) {
          domIdentityDiagLogged = true;
          var headerAtCount = 0;
          try {
            var atLinks = document.querySelectorAll('a');
            var atRe = /^\/@([A-Za-z0-9._]{2,24})(?:[?#\/]|$)/;
            for (var ai = 0; ai < atLinks.length; ai++) {
              var ahref = '';
              try { ahref = atLinks[ai].getAttribute ? (atLinks[ai].getAttribute('href') || '') : ''; } catch (e) {}
              if (atRe.test(ahref) && elInTopBar(atLinks[ai])) headerAtCount++;
            }
          } catch (e) {}
          logBE('WATCHER_IDENTITY_DIAG', 'Chẩn đoán identity DOM: 0 ứng viên — link /@ trong header: ' + headerAtCount + ', gói allowlist đã thấy trong phiên (capturedTotal): ' + state.capturedTotal, 'WATCHER_006');
        }
        return state.identity || null;
      }
      var chosen = cands[0];
      if (state.identity && state.identity.username === chosen.username && state.identity.selector === chosen.selector) return state.identity;
      var id = { username: chosen.username, user_id: '', user_id_str: '', sec_user_id: '', screen_name: '', avatar_url: '', source: 'dom', selector: chosen.selector };
      state.identity = id;
      state.account = chosen.username;
      storageSet({ pandaWatcherIdentity: Object.assign({}, id, { at: Date.now() }) });
      saveStats();
      var logKey = chosen.username + '|' + chosen.selector;
      if (domIdentityLogged !== logKey) {
        domIdentityLogged = logKey;
        logBE('WATCHER_IDENTITY', 'Tự nhận identity từ DOM tab TikTok: @' + chosen.username + ' (selector: ' + chosen.selector + ')', 'WATCHER_006');
      }
      return id;
    } catch (e) { return state.identity || null; }
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
      if (normText(heads[h].innerText).indexOf('tin nhan') !== 0) continue;   // v1.2.5: kèm badge vẫn khớp
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

  /* ---------- Nhận data từ hook (MAIN world, document_start) — chỉ 2 endpoint allowlist ---------- */
  // v1.2.3: hook.js chạy thẳng dưới dạng content script MAIN world ở document_start
  // (khai trong manifest) nên chặn được fetch/XHR từ trước khi script của trang chạy,
  // thay cho cơ chế cũ chèn thẻ script ở document_idle (cài muộn, lỡ gói passport sớm).
  function applyIdentity(id) {
    if (!id || !id.username) return;
    id.source = 'tab';   // v1.2.3: đóng dấu nguồn mạng — detectDomIdentity() dựa vào dấu này để không ghi đè
    state.identity = id;
    state.account = id.username;
    if (!cfg.account) cfg.account = id.username;
    storageSet({ pandaWatcherIdentity: { username: id.username, user_id: id.user_id || '', user_id_str: id.user_id_str || '', sec_user_id: id.sec_user_id || '', screen_name: id.screen_name || '', avatar_url: id.avatar_url || '', at: Date.now(), source: 'tab' } });
    saveStats();
  }
  function applyProfiles(parsed) {
    if (!parsed) return;
    Object.assign(state.profileById, parsed.byId);
    Object.assign(state.profileByName, parsed.byName);
    try { storageSet({ pandaWatcherProfiles: state.profileById }); } catch (e) {}
  }
  window.addEventListener('message', function (ev) {
    if (ev.origin !== location.origin || !ev.data || ev.data.__panda !== 'capture') return;
    if (!cfg.captureEnabled) return;
    var body = ev.data.body || '';
    if (!body) return;
    var json = safeJson(body);
    if (!json) return;
    state.capturedTotal++;
    var url = ev.data.url || '';
    try {
      if (url.indexOf('passport/web/account/info') !== -1) {
        var id = CORE.parsePassportAccountInfo(json);
        if (id) applyIdentity(id);
      } else if (url.indexOf('tiktok/v1/im/user/profile') !== -1) {
        applyProfiles(CORE.parseImUserProfiles(json));
      }
      // Tin nhắn KHÔNG lấy từ tầng mạng (im-api trả protobuf rỗng) — lấy từ DOM (domScan).
    } catch (e) {}
  });

  /* ---------- v1.2.6: Gate chặn dòng không rõ đối tác (luật của user) ---------- */
  // Data không kèm @username/tên đối tác thì KHÔNG được lưu lặng lẽ thành 'unknown'
  // vào DB — chặn ngay tại enqueue (trước khi vào buffer/flush), đếm vào
  // blockedUnknown, báo lỗi rõ qua log BE + chip + popup. Chỉ chặn dòng không rõ
  // đối tác; dòng hợp lệ trong cùng đợt vẫn đẩy bình thường.
  // Lý do chặn: (a) không tìm được tiêu đề hội thoại (cả tên lẫn @username đều rỗng);
  // (b) tên đối tác không đọc được (slug rỗng -> fan_username rơi về 'unknown').
  function unknownCounterpartReason(raw, row) {
    var name = (raw.counterpartName || '').trim();
    var user = (raw.counterpartUsername || '').trim();
    if (!name && !user) return 'không tìm được tiêu đề hội thoại';
    if (row && row.fan_username === 'unknown') return 'tên đối tác không đọc được (slug rỗng)';
    return '';
  }
  function enqueue(raw) {
    var row = CORE.normalizeMessage(raw, cfg.source);
    if (!row) return;
    state.scanTotal++;
    var reason = unknownCounterpartReason(raw, row);
    if (reason) {
      state.scanBlocked++;
      state.blockedUnknown++;
      state.lastBlockReason = reason;
      return;
    }
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
      // v1.2.2: account key cho dòng đẩy lên — ưu tiên open_id (web bridge), nếu không có
      // thì dùng @username tự nhận từ chính tab TikTok (identity passport). Tool v3.16 đọc
      // cả 2 dạng nên vòng lặp chạy được mà không cần đăng nhập web trước.
      var acctKey = cfg.accountId || (state.identity && state.identity.username) || state.account || '';
      if (acctKey) fresh.forEach(function (r) { r.account_id = acctKey; });
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

  /* ---------- v1.2.2: Quét DOM KHÔNG phụ thuộc tên class hash ---------- */
  // Tin nhắn chỉ lấy được từ DOM đã render (im-api trả protobuf rỗng, không có JSON tin nhắn).
  // v1.2.7: neo theo khung bong bóng break-words (Business Suite, không có input placeholder)
  // hoặc ô soạn (contenteditable / text placeholder) -> tìm khung hội thoại -> duyệt khối tin:
  // text = innerText đã bỏ dòng chỉ là giờ/ngày; hướng = vị trí ngang block so với giữa khung
  // (phải = mình gửi, trái = đối tác); timestamp = giờ/ngày gần nhất trong hàng chứa block;
  // đối tác = tiêu đề hội thoại (h2, không phải "Tin nhắn"), đối chiếu map profile
  // (nick_name -> unique_id) khi có để khỏi rơi về "unknown".
  function parseVnTime(txt) {
    if (!txt) return null;
    var m = String(txt).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0));
    m = String(txt).match(/(\d{1,2})\/(\d{1,2})(?!\d)/);
    if (m) { var y = new Date().getFullYear(); return new Date(y, +m[2] - 1, +m[1]); }
    m = String(txt).match(/(\d{1,2}):(\d{2})/);
    if (m) { var d = new Date(); d.setHours(+m[1], +m[2], 0, 0); return d; }
    return null;
  }
  function stripTimeLines(txt) {
    var lines = String(txt || '').split('\n');
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i].trim();
      if (!ln) continue;
      if (/^\d{1,2}:\d{2}$/.test(ln)) continue;
      if (/^\d{1,2}\/\d{1,2}(\/\d{4})?$/.test(ln)) continue;
      out.push(ln);
    }
    return out.join('\n').trim();
  }
  function conversationTitle(pane) {
    // v1.2.7: tiêu đề hội thoại có thể ở mọi tag (h1-h5, div tiêu đề), không chỉ h2.
    // Ưu tiên tiêu đề nằm trong cột chat (gần khung chat); bỏ qua tiêu đề danh sách
    // ("Tin nhắn...") và các tiêu đề nằm ngoài màn hình (drawer đóng, x < 0).
    try {
      var paneLeft = -1;
      try { if (pane && pane !== document.body) paneLeft = pane.getBoundingClientRect().left; } catch (e) {}
      var heads = document.querySelectorAll('h1, h2, h3, h4, h5');
      var fallback = '';
      for (var i = 0; i < heads.length; i++) {
        var t = (heads[i].innerText || '').trim();
        if (!t || t.length > 80) continue;
        if (normText(t).indexOf('tin nhan') === 0) continue;   // v1.2.5: tiêu đề kèm badge ("Tin nhắn 1857") cũng là tiêu đề danh sách, không phải tên hội thoại
        var r = null;
        try { r = heads[i].getBoundingClientRect(); } catch (e) {}
        if (r && (r.width <= 0 || r.left < 0)) continue;   // ngoài màn hình (drawer đóng)
        if (paneLeft >= 0 && r && r.left >= paneLeft - 60) return t;   // trong cột chat -> thắng ngay
        if (!fallback) fallback = t;
      }
      if (fallback) return fallback;
      // Dự phòng: div tiêu đề kiểu Business Suite (text-H6-Bold) trong cột chat
      var all = document.querySelectorAll('*');
      var fb2 = '';
      for (var j = 0; j < all.length; j++) {
        if (all[j].tagName !== 'DIV' || !hasClass(all[j], 'text-H6-Bold')) continue;
        var t2 = (all[j].innerText || '').trim();
        if (!t2 || t2.length > 80) continue;
        if (normText(t2).indexOf('tin nhan') === 0) continue;
        var r2 = null;
        try { r2 = all[j].getBoundingClientRect(); } catch (e) {}
        if (r2 && (r2.width <= 0 || r2.left < 0)) continue;
        if (paneLeft >= 0 && r2 && r2.left >= paneLeft - 60) return t2;
        if (!fb2) fb2 = t2;
      }
      return fb2;
    } catch (e) {}
    return '';
  }
  function findComposer() {
    try {
      var tas = document.querySelectorAll('textarea');
      for (var i = 0; i < tas.length; i++) {
        var ph = '';
        try { ph = tas[i].placeholder || (tas[i].getAttribute ? (tas[i].getAttribute('placeholder') || '') : ''); } catch (e) {}
        if (ph.indexOf('Gửi tin nhắn') !== -1) return tas[i];
      }
      var eds = document.querySelectorAll('[contenteditable="true"]');
      for (var j = 0; j < eds.length; j++) {
        var ph2 = '';
        try { ph2 = eds[j].getAttribute ? (eds[j].getAttribute('placeholder') || eds[j].getAttribute('aria-label') || '') : ''; } catch (e) {}
        if (ph2.indexOf('Gửi tin nhắn') !== -1) return eds[j];
      }
      // Fallback: textbox cuối cùng trong khung chat (khi placeholder đã bị thay bằng text đã nhập)
      var all = document.querySelectorAll('textarea, [contenteditable="true"]');
      if (all.length) return all[all.length - 1];
    } catch (e) {}
    return null;
  }
  // v1.2.7: chữ ký DOM thật đo từ tab của user (probe 25/10) — Business Suite KHÔNG có
  // input[placeholder] nào nên neo ô soạn cũ không bao giờ khớp; bong bóng thật có chữ ký
  // ổn định div.break-words.text-P4-Regular (class tiện ích, không phải class hash).
  function hasClass(el, cls) {
    try {
      if (el.classList && el.classList.contains) return el.classList.contains(cls);
      var cn = (typeof el.className === 'string') ? el.className : '';
      return (' ' + cn + ' ').indexOf(' ' + cls + ' ') !== -1;
    } catch (e) { return false; }
  }
  function isJunkNode(el) {
    // v1.2.7: KHÔNG BAO GIỜ coi option/select/style/script (và mọi phần tử trong <select>)
    // là khối tin nhắn — 56 phần tử <option> của dropdown chọn ngôn ngữ từng bị quét nhầm
    // thành tin nhắn, đó chính là nguồn rác 'unknown' trước đây.
    try {
      var tag = (el.tagName || '').toUpperCase();
      if (tag === 'OPTION' || tag === 'SELECT' || tag === 'STYLE' || tag === 'SCRIPT' || tag === 'LINK' || tag === 'NOSCRIPT') return true;
      var n = el.parentElement;
      while (n) { if ((n.tagName || '').toUpperCase() === 'SELECT') return true; n = n.parentElement; }
    } catch (e) {}
    return false;
  }
  function findBubbleFrame() {
    // Khung chứa các bong bóng break-words: đi ngược từ bong bóng đầu tiên lên tới tổ tiên
    // đầu tiên chứa ít nhất một nửa số bong bóng (khung danh sách tin thật, không phải
    // wrapper của 1 tin). Trả null khi không có bong bóng nào (không mở hội thoại).
    try {
      var bubbles = [];
      var all = document.querySelectorAll('*');
      for (var i = 0; i < all.length; i++) {
        if (all[i].tagName === 'DIV' && hasClass(all[i], 'break-words') && hasClass(all[i], 'text-P4-Regular')) bubbles.push(all[i]);
      }
      if (!bubbles.length) return null;
      var need = Math.ceil(bubbles.length / 2);
      var n = bubbles[0].parentElement;
      while (n && n !== document.body) {
        var cnt = 0;
        try {
          var desc = n.querySelectorAll('*');
          for (var j = 0; j < desc.length; j++) {
            if (desc[j].tagName === 'DIV' && hasClass(desc[j], 'break-words') && hasClass(desc[j], 'text-P4-Regular')) cnt++;
          }
        } catch (e) {}
        if (cnt >= need) return n;
        n = n.parentElement;
      }
      return bubbles[0].parentElement || null;
    } catch (e) { return null; }
  }
  function findComposerAnchor() {
    // Neo ô soạn cho domScan (chỉ dùng để xác định khung, KHÔNG dùng để gửi tin):
    // (1) findComposer() chuẩn; (2) bất kỳ phần tử contenteditable nào; (3) phần tử có
    // text đúng bằng placeholder gửi tin (ô soạn Business Suite không phải input).
    var c = findComposer();
    if (c) return c;
    try {
      var eds = document.querySelectorAll('[contenteditable="true"]');
      if (eds.length) return eds[eds.length - 1];
      var all = document.querySelectorAll('div, span');
      for (var i = 0; i < all.length; i++) {
        var t = (all[i].innerText || '').trim();
        if (t === 'Gửi tin nhắn...' || t === 'Gửi tin nhắn') return all[i];
      }
    } catch (e) {}
    return null;
  }
  function isScrollable(el) {
    try { return el && el.scrollHeight > el.clientHeight + 20; } catch (e) { return false; }
  }
  function containsListHeader(el) {
    // v1.2.5: tiêu đề thật có thể kèm badge/số lượng ("Tin nhắn 1857") nên chỉ cần
    // normText BẮT ĐẦU BẰNG "tin nhan", không đòi bằng đúng như trước.
    try {
      var heads = el.querySelectorAll('h2');
      for (var i = 0; i < heads.length; i++) { if (normText(heads[i].innerText).indexOf('tin nhan') === 0) return true; }
    } catch (e) {}
    return false;
  }
  function isInside(el, anc) {
    var n = el ? el.parentElement : null;
    while (n) { if (n === anc) return true; n = n.parentElement; }
    return false;
  }
  function findListColumn() {
    // Cột danh sách = cột chứa tiêu đề h2 "Tin nhắn". Đi ngược từ h2 lên trong khi
    // phần tử cha vẫn hẹp (<= 55% bề rộng trang) — cột danh sách luôn hẹp hơn cột chat.
    // v1.2.5: (a) h2 chỉ cần BẮT ĐẦU BẰNG "tin nhan" (kèm badge/số lượng vẫn khớp);
    // (b) không tìm được h2 thì fallback theo vị trí: cột hẹp nhất bên trái (<= 55%
    // bề rộng trang) chứa nhiều ảnh đại diện nhất — đó là cột danh sách.
    try {
      var heads = document.querySelectorAll('h2');
      var h = null;
      for (var i = 0; i < heads.length; i++) { if (normText(heads[i].innerText).indexOf('tin nhan') === 0) { h = heads[i]; break; } }
      if (h) {
        var bodyW = 0;
        try { bodyW = document.body.getBoundingClientRect().width; } catch (e) {}
        var cur = h.parentElement;
        if (!cur) return h;
        while (cur && cur.parentElement && cur.parentElement !== document.body) {
          var pr = null;
          try { pr = cur.parentElement.getBoundingClientRect(); } catch (e) { break; }
          if (!pr || pr.width <= 0) break;
          if (bodyW && pr.width > bodyW * 0.55) break;
          cur = cur.parentElement;
        }
        return cur;
      }
      var bodyW2 = 0;
      try { bodyW2 = document.body.getBoundingClientRect().width; } catch (e) {}
      if (!bodyW2) return null;
      var imgs = document.querySelectorAll('img');
      var cands = [];
      function candCount(el) {
        for (var ci = 0; ci < cands.length; ci++) { if (cands[ci].el === el) return cands[ci]; }
        var c = { el: el, count: 0, left: 1e9 };
        try { c.left = el.getBoundingClientRect().left; } catch (e) {}
        cands.push(c);
        return c;
      }
      for (var ii = 0; ii < imgs.length; ii++) {
        var anc = imgs[ii].parentElement, colCand = null;
        while (anc && anc !== document.body) {
          var r = null;
          try { r = anc.getBoundingClientRect(); } catch (e) { break; }
          if (!r || r.width <= 0 || r.width > bodyW2 * 0.55) break;
          colCand = anc;
          anc = anc.parentElement;
        }
        if (colCand) candCount(colCand).count++;
      }
      var best = null;
      for (var bi = 0; bi < cands.length; bi++) {
        if (!best || cands[bi].count > best.count || (cands[bi].count === best.count && cands[bi].left < best.left)) best = cands[bi];
      }
      return best ? best.el : null;
    } catch (e) { return null; }
  }
  function findChatPaneFallback() {
    // v1.2.4 (b): không neo được ô soạn -> lấy khung cuộn LỚN NHẤT ở cột phải
    // (cột còn lại sau khi loại cột danh sách), không phụ thuộc class hash.
    try {
      var listCol = findListColumn();
      var listRight = -1;
      try { if (listCol) listRight = listCol.getBoundingClientRect().right; } catch (e) {}
      var all = document.querySelectorAll('*');
      var best = null, bestArea = -1;
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        if (!isScrollable(el)) continue;
        if (containsListHeader(el)) continue;
        if (listCol && (el === listCol || isInside(el, listCol))) continue;
        var r = null;
        try { r = el.getBoundingClientRect(); } catch (e) { continue; }
        if (!r || r.width <= 0) continue;
        if (listRight >= 0 && r.left < listRight - 20) continue;   // phải nằm ở cột phải
        var area = r.width * r.height;
        if (area > bestArea) { bestArea = area; best = el; }
      }
      return best;
    } catch (e) { return null; }
  }
  function findMessagePane(composer) {
    // Ưu tiên: container cuộn được nằm trên ô soạn, cùng cột chat, không chứa cột danh sách.
    var cands = [];
    try {
      var all = document.querySelectorAll('*');
      for (var i = 0; i < all.length; i++) { if (isScrollable(all[i])) cands.push(all[i]); }
    } catch (e) {}
    var cr = null;
    try { cr = composer.getBoundingClientRect(); } catch (e) {}
    var best = null, bestScore = -1;
    for (var j = 0; j < cands.length; j++) {
      var el = cands[j];
      if (containsListHeader(el)) continue;
      var r = null;
      try { r = el.getBoundingClientRect(); } catch (e) { continue; }
      if (!r || r.width <= 0) continue;
      var score = 0;
      if (cr) {
        var midEl = r.left + r.width / 2, midCo = cr.left + cr.width / 2;
        if (Math.abs(midEl - midCo) < 120) score += 2;   // cùng cột với ô soạn
        if (r.bottom <= cr.top + 10) score += 2;          // khung tin nằm trên ô soạn
      }
      if (score > bestScore) { bestScore = score; best = el; }
    }
    if (best) return best;
    // Fallback: tổ tiên cuộn được gần nhất của ô soạn
    var el2 = composer.parentElement;
    while (el2 && el2 !== document.body) { if (isScrollable(el2)) return el2; el2 = el2.parentElement; }
    return null;
  }

  function domScan() {
    if (!cfg.captureEnabled || location.pathname.indexOf('/messages') === -1) return;
    // v1.2.6: reset bộ đếm theo lần quét — phục vụ gate chặn + trạng thái "toàn bộ bị chặn"
    state.scanTotal = 0; state.scanBlocked = 0; state.lastScanAllBlocked = false;
    detectDomIdentity();
    try {
      // v1.2.7: Business Suite KHÔNG có input[placeholder] nên neo ô soạn cũ không bao giờ
      // khớp — neo mới theo thứ tự: (1) khung chứa bong bóng break-words (khung chat thật);
      // (2) ô soạn (findComposerAnchor: contenteditable / text placeholder). Chỉ trả về 0
      // khi CẢ HAI neo đều không có (không mở hội thoại nào) — luật no-composer của v1.2.5
      // giữ nguyên ý (không đoán khung khi không có hội thoại) nhưng sửa nguyên nhân sai.
      var composer = findComposerAnchor();
      var bubbleFrame = findBubbleFrame();
      if (!composer && !bubbleFrame) return;
      var pane = null;
      if (bubbleFrame) pane = bubbleFrame;
      else { pane = findMessagePane(composer); if (!pane) pane = findChatPaneFallback(); }
      var listCol = null, pr = null, midX = 0;
      if (pane) {
        pr = pane.getBoundingClientRect();
        midX = pr.left + pr.width / 2;
      } else {
        // v1.2.4 (c): vẫn không xác định được cột -> quét vùng nội dung chính nhưng
        // loại mọi block thuộc cột danh sách; midX lấy từ vùng còn lại bên phải cột danh sách.
        listCol = findListColumn();
        var bodyR = null;
        try { bodyR = document.body.getBoundingClientRect(); } catch (e) {}
        var leftEdge = 0, rightEdge = bodyR ? bodyR.right : 1200;
        if (listCol) { try { leftEdge = listCol.getBoundingClientRect().right; } catch (e) {} }
        var effWidth = Math.max(1, rightEdge - leftEdge);
        pr = { left: leftEdge, width: effWidth, right: rightEdge };
        midX = leftEdge + effWidth / 2;
        pane = document.body;
      }
      var title = conversationTitle(pane);
      var partnerUser = (title && state.profileByName[CORE.normName(title)]) || '';
      var lastBubbleDir = '', lastBubbleTxt = '';   // v1.2.8: bong bóng CUỐI (theo thứ tự DOM) quyết direction cho bảng conversations
      // Nhánh chứa ô soạn trong pane (để loại khỏi vùng quét khi pane là cột chat rộng)
      // v1.2.5: CHỈ tính nhánh khi pane là khung chat thật. Khi pane = document.body
      // (fallback (c)), nhánh đi ngược tới con trực tiếp của body sẽ là CẢ cột chat
      // nên mọi tin trong cột đều bị loại nhầm — trường hợp này để composerBranch = null
      // (bản thân ô soạn vẫn bị loại bởi check el === composer; wrapper chỉ chứa ô soạn
      // có innerText rỗng nên tự bị loại).
      var composerBranch = null;
      if (pane !== document.body) {
        (function () {
          var n = composer;
          while (n && n.parentElement && n.parentElement !== pane) n = n.parentElement;
          if (n && n.parentElement === pane) composerBranch = n;
        })();
      }
      var nodes = pane.querySelectorAll('*');
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if (isJunkNode(el)) continue;   // v1.2.7: option/select/style/script không bao giờ là tin nhắn
        if (composerBranch) {
          var p = el, insideComposer = false;
          while (p && p !== pane) { if (p === composerBranch) { insideComposer = true; break; } p = p.parentElement; }
          if (insideComposer) continue;
        }
        if (el === composer) continue;
        if (listCol && (el === listCol || isInside(el, listCol))) continue;   // v1.2.4 (c): loại cột danh sách
        var r = null;
        try { r = el.getBoundingClientRect(); } catch (e) { continue; }
        if (!r || r.width < 30 || r.width > pr.width * 0.92 || r.height <= 0) continue;
        var rawText = (el.innerText || '').trim();
        if (!rawText) continue;
        // Chỉ giữ khối trong cùng: bỏ phần tử mà một phần tử con có cùng innerText
        var dup = false;
        try {
          var kids = el.querySelectorAll('*');
          for (var k = 0; k < kids.length; k++) { if ((kids[k].innerText || '').trim() === rawText) { dup = true; break; } }
        } catch (e) {}
        if (dup) continue;
        var txt = stripTimeLines(rawText);
        if (!txt || txt.length > 2000) continue;
        if (txt.split('\n').length > 15) continue;   // v1.2.5: bỏ khối container quá khổ (56-84 dòng lọt qua ở v1.2.4), không thể là 1 tin nhắn
        if (title && normText(txt) === normText(title)) continue;   // tiêu đề, không phải tin
        var isOut = (r.left + r.width / 2) > midX;
        var rowText = '';
        try { rowText = (el.parentElement && el.parentElement.innerText) || ''; } catch (e) {}
        var at = parseVnTime(rowText) || parseVnTime(rawText);
        var dir = isOut ? 'out' : 'in';
        if (!at) {
          // Không thấy timestamp: dùng mốc lần đầu thấy trong phiên để khoá dedupe ổn định
          var sig = (partnerUser || title || 'conv') + '|' + dir + '|' + CORE.fnv(txt);
          if (state.domSeen[sig]) at = new Date(state.domSeen[sig]);
          else { at = new Date(); state.domSeen[sig] = at.toISOString(); }
        }
        enqueue({ account: guessAccount(), counterpartName: title, counterpartUsername: partnerUser, direction: dir, content: txt, at: at, via: 'dom' });
        lastBubbleDir = dir; lastBubbleTxt = txt;   // khối sau ghi đè khối trước -> cuối vòng lặp còn lại đúng bong bóng cuối
      }
      // v1.2.8: hội thoại đang mở cũng ghi vào bảng conversations — direction PHẢI là chiều
      // của BONG BÓNG CUỐI CÙNG, không phải bong bóng đầu hay bất kỳ bong bóng nào khác.
      // Hội thoại đang mở coi như đã đọc (unread false); chưa rep hay không chỉ còn do
      // direction: 'in' = fan nhắn cuối (chưa rep), 'out' = mình nhắn cuối (đã rep).
      // last_at để trống: giờ hiển thị sẽ do listScan điền khi danh sách hiện ra.
      if (title && lastBubbleDir) {
        var acctKey2 = cfg.accountId || (state.identity && state.identity.username) || state.account || '';
        supa('conversations?on_conflict=account_id,counterpart', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: [{
          account_id: acctKey2,
          counterpart: title,
          counterpart_username: partnerUser || null,
          last_preview: lastBubbleTxt,
          last_at: '',
          unread: false,
          direction: lastBubbleDir,
          updated_at: new Date().toISOString()
        }] }).catch(function () {});
      }
      state.account = guessAccount();
    } catch (e) {}
    // v1.2.6: tổng kết lần quét — dòng không rõ đối tác KHÔNG lưu lặng lẽ mà báo lỗi rõ.
    // Toàn bộ dòng bị chặn -> trạng thái lỗi nổi bật trên chip (không còn "đang canh").
    state.lastScanAllBlocked = state.scanTotal > 0 && state.scanBlocked >= state.scanTotal;
    if (state.scanBlocked > 0) {
      // Chỉ log khi số dòng bị chặn thay đổi (tránh spam 1 log/20s khi cùng 1 đợt rác còn đó)
      if (state.scanBlocked !== state.lastLoggedBlocked) {
        logBE('WATCHER_BLOCKED', 'Tin không rõ đối tác — đã chặn, không đẩy DB (số dòng: ' + state.scanBlocked + ') — lý do: ' + (state.lastBlockReason || 'không rõ đối tác'), 'WATCHER_008');
        state.lastLoggedBlocked = state.scanBlocked;
      }
      saveStats(); renderChip();
    }
  }

  /* ---------- v1.2.4: Quét DANH SÁCH hội thoại (không cần mở hội thoại) ---------- */
  // User yêu cầu: ở màn hình danh sách cũng phải bắt được — ít nhất phân biệt được
  // ai nhắn mà chưa rep. Mỗi dòng lấy: tên hiển thị (dòng đầu), preview tin cuối (dòng hai),
  // thời gian (dòng khớp mẫu giờ/ngày, thường ở phía phải).
  // v1.2.8 — LUẬT "CHƯA REP" (user chốt, sửa sai luật cũ): hội thoại là CHƯA REP khi và
  // chỉ khi TIN CUỐI LÀ CỦA FAN (chiều 'in'), bất kể đã đọc hay chưa đọc. Tin cuối là
  // của mình (preview có tiền tố "Bạn:"/"You:") thì là ĐÃ REP — tuyệt đối không ghi nhầm
  // thành fan đang chờ. Dấu chưa đọc chỉ quyết unread true/false, KHÔNG quyết direction.
  // Luật cũ (không dấu hiệu -> direction null) là SAI: không dấu vẫn là 'in' nếu không
  // có tiền tố (tin đã đọc mà chủ tài khoản chưa rep vẫn là chưa rep).
  function lastMsgDirection(preview, hasUnreadSignal) {
    if (/^(Bạn|You)\s*:/.test(preview || '')) return { direction: 'out', unread: false };
    return { direction: 'in', unread: !!hasUnreadSignal };
  }
  function timeLineOf(lines) {
    for (var i = lines.length - 1; i >= 0; i--) {
      if (/\d{1,2}:\d{2}/.test(lines[i]) || /\d{1,2}\/\d{1,2}(\/\d{4})?/.test(lines[i])) return { time: lines[i], idx: i };
    }
    return null;
  }
  function subtreeHasUnreadSignal(el) {
    var nodes = [el];
    try { var ds = el.querySelectorAll('*'); for (var i = 0; i < ds.length; i++) nodes.push(ds[i]); } catch (e) {}
    for (var j = 0; j < nodes.length; j++) {
      var n = nodes[j];
      var tag = n.tagName || '';
      if (tag === 'B' || tag === 'STRONG') return true;
      try {
        var fw = (n.style && n.style.fontWeight) || '';
        if (fw === 'bold' || fw === '700' || fw === '600' || +fw >= 600) return true;
      } catch (e) {}
      try {
        var lab = normText((n.getAttribute ? (n.getAttribute('aria-label') || '') : '') + ' ' + (n.getAttribute ? (n.getAttribute('title') || '') : ''));
        if (lab.indexOf('chua doc') !== -1 || lab.indexOf('unread') !== -1) return true;
      } catch (e) {}
      try {
        // Chấm chưa đọc thường là node lá chỉ chứa "●"/"•"
        if (n.children && n.children.length === 0 && ((n.innerText || '').trim() === '●' || (n.innerText || '').trim() === '•')) return true;
      } catch (e) {}
    }
    return false;
  }
  function extractListRows(col) {
    var out = [], seen = new Set();
    var nodes = [];
    try { nodes = col.querySelectorAll('*'); } catch (e) { return out; }
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (isJunkNode(el)) continue;   // v1.2.7: option/select/style/script không bao giờ là dòng hội thoại
      var raw = (el.innerText || '').trim();
      if (!raw) continue;
      var dup = false;
      try {
        var kids = el.querySelectorAll('*');
        for (var k = 0; k < kids.length; k++) { if ((kids[k].innerText || '').trim() === raw) { dup = true; break; } }
      } catch (e) {}
      if (dup) continue;   // chỉ giữ khối trong cùng
      var lines = raw.split('\n').map(function (s) { return s.trim(); }).filter(function (s) { return !!s; });
      if (lines.length < 2 || lines.length > 5) continue;   // wrapper nhiều dòng không phải 1 dòng hội thoại
      var name = lines[0];
      if (!name || name.length > 60) continue;
      if (normText(name).indexOf('tin nhan') === 0) continue;   // v1.2.5: khối tiêu đề kèm badge cũng không phải dòng hội thoại
      var isHeaderLine = false;
      for (var h = 0; h < Math.min(3, lines.length); h++) {
        var nh = normText(lines[h]);
        if (nh === 'bo loc' || nh === 'chi chua doc') { isHeaderLine = true; break; }
      }
      if (isHeaderLine) continue;
      var tl = timeLineOf(lines);
      if (!tl) continue;   // dòng hội thoại thật luôn có thời gian
      var preview = lines.length > 1 ? lines[1] : '';
      if (preview === tl.time) preview = '';
      var dd = lastMsgDirection(preview, subtreeHasUnreadSignal(el));   // v1.2.8: luật chưa rep theo tin cuối
      var unread = dd.unread, dir = dd.direction;
      var key = name + '|' + preview + '|' + tl.time;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: name, preview: preview, time: tl.time, unread: unread, direction: dir });
    }
    return out;
  }
  // v1.2.7: đường danh sách cho trang /messages — chữ ký data-e2e ỔN ĐỊNH đo từ probe
  // thật (không phụ thuộc class hash): dòng = [data-e2e=dm-new-conversation-item],
  // tên = [data-e2e=dm-new-conversation-nickname] trong dòng, chưa đọc =
  // [data-e2e=dm-new-conversation-unread] trong dòng. Chạy TRƯỚC đường generic cũ.
  function extractDmRows() {
    // v1.2.9: try/catch THEO TỪNG DÒNG (1 dòng lỗi không giết cả danh sách như
    // try/catch ngoài trước đây) + đếm số dòng bị từng bộ lọc loại, chỉ gồm số lượng
    // (không tên, không xem trước, không nội dung) để chẩn đoán vụ quét 0 dòng.
    var out = [], seen = new Set();
    var diag = { dmItemCount: 0, nickCount: 0, dropJunk: 0, dropNoName: 0, dropNameLong: 0, dropNoText: 0, dropDup: 0, dropError: 0, e2eConversationCount: -1, e2eDmCount: -1 };
    try { diag.dmItemCount = document.querySelectorAll('[data-e2e="dm-new-conversation-item"]').length; } catch (e) {}
    try { diag.nickCount = document.querySelectorAll('[data-e2e="dm-new-conversation-nickname"]').length; } catch (e) {}
    var items = [];
    try { items = document.querySelectorAll('[data-e2e="dm-new-conversation-item"]'); } catch (e) {}
    for (var i = 0; i < items.length; i++) {
      try {
        var el = items[i];
        if (isJunkNode(el)) { diag.dropJunk++; continue; }
        var nameEl = null;
        try { nameEl = el.querySelector('[data-e2e="dm-new-conversation-nickname"]'); } catch (e) {}
        var name = nameEl ? (nameEl.innerText || '').trim() : '';
        if (!name) { diag.dropNoName++; continue; }
        if (name.length > 60) { diag.dropNameLong++; continue; }
        var raw = (el.innerText || '').trim();
        if (!raw) { diag.dropNoText++; continue; }
        var lines = raw.split('\n').map(function (s) { return s.trim(); }).filter(function (s) { return !!s; });
        var tl = timeLineOf(lines);
        var preview = '';
        for (var j = 0; j < lines.length; j++) {
          if (lines[j] === name) continue;
          if (tl && j === tl.idx) continue;
          if (/^\d{1,3}$/.test(lines[j])) continue;   // badge số chưa đọc, không phải preview
          preview = lines[j]; break;
        }
        var hasUnread = false;
        try { hasUnread = !!el.querySelector('[data-e2e="dm-new-conversation-unread"]'); } catch (e) {}
        var dd = lastMsgDirection(preview, hasUnread);   // v1.2.8: luật chưa rep theo tin cuối
        var unread = dd.unread, dir = dd.direction;
        var key = name + '|' + preview + '|' + (tl ? tl.time : '');
        if (seen.has(key)) { diag.dropDup++; continue; }
        seen.add(key);
        out.push({ name: name, preview: preview, time: tl ? tl.time : '', unread: unread, direction: dir });
      } catch (e) { diag.dropError++; }
    }
    // v1.2.9 (theo dõi sau đợt TikTok update): chỉ khi không thấy dòng dm nào mới
    // quét thêm 2 số đếm gợi ý đổi tên chữ ký — nếu dmItemCount = 0 mà vẫn có nhiều
    // phần tử data-e2e chứa 'conversation'/'dm-' thì chữ ký cũ đã bị TikTok đổi tên,
    // cần đối chiếu file đo mới thay vì bám file đo cũ.
    if (diag.dmItemCount === 0) {
      try {
        var allE2e = document.querySelectorAll('[data-e2e]');
        var cc = 0, dc = 0;
        for (var k = 0; k < allE2e.length; k++) {
          var v = '';
          try { v = (allE2e[k].getAttribute('data-e2e') || '').toLowerCase(); } catch (e) {}
          if (v.indexOf('conversation') !== -1) cc++;
          if (v.indexOf('dm-') === 0) dc++;
        }
        diag.e2eConversationCount = cc;
        diag.e2eDmCount = dc;
      } catch (e) {}
    }
    return { rows: out, diag: diag };
  }
  function listScan() {
    // v1.2.9: cổng pathname (không so sánh href tuyệt đối) nên tham số URL mới của
    // TikTok (?lang=vi-VN&from=homepage) không ảnh hưởng — quét chạy được cả trên
    // /messages lẫn /business-suite/messages. Mọi lần quét đều ghi state.lastListDiag
    // (chỉ số lượng) để log WATCHER_DIAG + popup chẩn đoán đọc được.
    if (!cfg.captureEnabled || location.pathname.indexOf('/messages') === -1) {
      state.lastListDiag = { dmItemCount: 0, nickCount: 0, dmRowsExtracted: 0, genericRows: 0, rowsOut: 0, branch: 'skipped', dropJunk: 0, dropNoName: 0, dropNameLong: 0, dropNoText: 0, dropDup: 0, dropError: 0, e2eConversationCount: -1, e2eDmCount: -1, frameCount: 0, path: location.pathname };
      try { saveStats(); } catch (e) {}
      return;
    }
    try {
      // v1.2.5: LUÔN set listStats kể cả khi không tìm được cột hoặc 0 dòng, kèm reason
      // để popup phân biệt được "chưa quét" / "chưa tìm thấy cột" / "0 hội thoại".
      // v1.2.7: thử đường data-e2e trước; chỉ khi không có dòng nào mới dùng đường generic cũ.
      var now = new Date().toISOString();
      var dm = extractDmRows();
      var rows = dm.rows;
      var diag = dm.diag;
      diag.dmRowsExtracted = dm.rows.length;
      diag.genericRows = 0;
      diag.branch = 'dm';
      if (!rows.length) {
        var col = findListColumn();
        if (!col) {
          diag.branch = 'no-column';
          diag.rowsOut = 0;
          diag.path = location.pathname;
          try { diag.frameCount = window.frames ? window.frames.length : 0; } catch (e) { diag.frameCount = -1; }
          state.lastListDiag = diag;
          state.listStats = { total: 0, unread: 0, reason: 'no-column', at: now };
          saveStats(); renderChip();
          return;
        }
        rows = extractListRows(col);
        diag.genericRows = rows.length;
        if (!rows.length) {
          diag.branch = 'no-rows';
          diag.rowsOut = 0;
          diag.path = location.pathname;
          try { diag.frameCount = window.frames ? window.frames.length : 0; } catch (e) { diag.frameCount = -1; }
          state.lastListDiag = diag;
          state.listStats = { total: 0, unread: 0, reason: 'no-rows', at: now };
          saveStats(); renderChip();
          return;
        }
        diag.branch = 'generic';
      }
      diag.rowsOut = rows.length;
      try { diag.frameCount = window.frames ? window.frames.length : 0; } catch (e) { diag.frameCount = -1; }
      diag.path = location.pathname;
      state.lastListDiag = diag;
      var acctKey = cfg.accountId || (state.identity && state.identity.username) || state.account || '';
      var upserts = rows.map(function (r) {
        return {
          account_id: acctKey,
          counterpart: r.name,
          counterpart_username: (r.name && state.profileByName[CORE.normName(r.name)]) || null,
          last_preview: r.preview,
          last_at: r.time,
          unread: r.unread,
          direction: r.direction,
          updated_at: now
        };
      });
      supa('conversations?on_conflict=account_id,counterpart', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: upserts }).catch(function () {});
      // v1.2.8: số "chưa rep" = số hội thoại có direction 'in' (tin cuối của fan),
      // không còn đếm theo dấu chưa đọc (tin đã đọc mà chưa rep vẫn tính là chưa rep).
      var unreadCount = 0;
      for (var i = 0; i < rows.length; i++) { if (rows[i].direction === 'in') unreadCount++; }
      var changed = !state.listStats || state.listStats.total !== rows.length || state.listStats.unread !== unreadCount;
      state.listStats = { total: rows.length, unread: unreadCount, reason: 'ok', at: now };
      saveStats(); renderChip();
      if (changed) logBE('WATCHER_LIST', 'Danh sách: ' + rows.length + ' hội thoại (' + unreadCount + ' chưa rep) -> Supabase', 'WATCHER_007');
    } catch (e) {}
  }
  function scanAll() { domScan(); listScan(); }

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
    detectDomIdentity();
    state.account = guessAccount();
    var value = { account: state.account, accountId: cfg.accountId || '', identitySource: state.identity ? (state.identity.source || 'tab') : '', url: location.href, at: new Date().toISOString(), version: '1.2.10', pushedTotal: state.pushedTotal, capturedTotal: state.capturedTotal, captcha: state.captcha, lastError: state.lastError, blockedUnknown: state.blockedUnknown };
    supa('app_state?on_conflict=key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: { key: 'watcher_status', value: value, updated_at: new Date().toISOString() } }).catch(function () {});
    saveStats();
  }
  function saveStats() {
    var st = { lastSync: state.lastSync, lastPush: state.lastPush, pushedTotal: state.pushedTotal, capturedTotal: state.capturedTotal, captcha: state.captcha, lastError: state.lastError, account: state.account, at: Date.now(), blockedUnknown: state.blockedUnknown, lastScanAllBlocked: state.lastScanAllBlocked, lastListDiag: state.lastListDiag || null };
    if (state.listStats) { st.listTotal = state.listStats.total; st.listUnread = state.listStats.unread; st.listReason = state.listStats.reason || 'ok'; }
    storageSet({ pandaWatcherStats: st });
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
    var composer = findComposer();
    if (!composer) throw new Error('Không tìm thấy ô nhập tin nhắn');
    var pane0 = null;
    try { pane0 = findMessagePane(composer); } catch (e) {}
    function paneHas(pane, needle) {
      if (!pane || !needle) return false;
      try {
        var ns = pane.querySelectorAll('*');
        for (var i = 0; i < ns.length; i++) { if ((ns[i].innerText || '').indexOf(needle) !== -1) return true; }
      } catch (e) {}
      return false;
    }
    var hadBefore = paneHas(pane0, job.content.slice(0, 40));
    var before = (document.querySelectorAll('[data-e2e*="message-item"], [class*="MessageItem"]').length);
    setComposerText(composer, job.content);
    await sleep(1200);
    var sendBtn = document.querySelector('[data-e2e="message-send"], button[aria-label*="Send"], button[aria-label*="Gửi"]');
    if (sendBtn) sendBtn.click();
    else composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    await sleep(2500);
    var bubbles = document.querySelectorAll('[data-e2e*="message-item"], [class*="MessageItem"], [class*="ChatMessage"]');
    var ok = false;
    if (pane0 && paneHas(pane0, job.content.slice(0, 40)) && !hadBefore) ok = true;   // v1.2.2: xác minh không phụ thuộc class
    bubbles.forEach(function (b) { if ((b.innerText || '').indexOf(job.content.slice(0, 40)) !== -1) ok = true; });
    if (!ok && bubbles.length <= before) throw new Error('Đã bấm gửi nhưng không thấy bong bóng tin xuất hiện');
    return true;
  }

  function pollQueue() {
    if (!cfg.autoSendEnabled || state.queueBusy || state.captcha) return;
    // v1.2.2: lọc queue theo open_id nếu có, nếu không theo @username từ tab TikTok (+ dòng cũ chưa gắn acc)
    var aq;
    if (cfg.accountId) aq = '&account_id=eq.' + encodeURIComponent(cfg.accountId);
    else if (state.identity && state.identity.username) aq = '&or=(account_id.eq.' + encodeURIComponent(state.identity.username) + ',account_id.is.null)';
    else aq = '&account_id=is.null';
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
    // v1.2.6: trạng thái lỗi nổi bật khi toàn bộ dòng của lần quét đều bị chặn;
    // có dòng bị chặn thì luôn hiện dòng lỗi rõ, không chỉ hiện số đã đẩy như bình thường.
    var head = state.captcha ? '<b style="color:#ff8a80">⛔ CAPTCHA — đã dừng</b>'
      : (state.lastScanAllBlocked ? '<b style="color:#ff8a80">⛔ Lỗi quét — toàn bộ tin bị chặn</b>' : '<b style="color:#9fe8a9">● đang canh</b>');
    chip.innerHTML = '🐼 Panda Watcher ' + head +
      '<br>Đã đẩy: <b>' + state.pushedTotal + '</b> tin · Bắt được: ' + state.capturedTotal + ' gói' +
      (state.blockedUnknown > 0 ? '<br><span style="color:#ff8a80">Lỗi: có ' + state.blockedUnknown + ' tin không rõ người gửi đã bị chặn — cần sửa bộ quét</span>' : '') +
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

  /* ---------- v1.2.8: Tự lấy @username qua trang hồ sơ khi khởi động ---------- */
  // BỐI CẢNH: 2 probe DOM thật chứng minh TikTok web KHÔNG render link /@ cho người xem
  // (atLinkTotal 0 trên cả business-suite lẫn /messages) nên tab không tự lấy được @username
  // từ DOM. Giải pháp theo lệnh user: khi khởi động mà chưa có identity thì tự đi qua trang
  // hồ sơ 1 lần để lấy username từ URL, rồi quay về messages. Chạy tối đa 1 vòng đi-về mỗi
  // phiên: cờ + mốc thời gian lưu chrome.storage.local (content script nạp lại mỗi lần
  // chuyển trang nên cờ bộ nhớ không đủ giữ qua vòng đi-về). Chỉ TỰ KHỞI ĐỘNG trên trang
  // messages (tránh cướp trang user đang xem dở ở nơi khác); trên trang hồ sơ chỉ lấy khi
  // cờ đang bật — cờ tắt (user tự mở hồ sơ người khác xem) thì KHÔNG lấy gì, KHÔNG chuyển
  // hướng, tránh nhận nhầm hồ sơ người khác làm tài khoản mình.
  var PROFILE_USER_RE = /^\/@([A-Za-z0-9._]{2,24})(?:[?#\/]|$)/;
  var IDENTITY_FETCH_WINDOW_MS = 30 * 60 * 1000; // 1 lần thử trong 30 phút coi như cùng phiên
  var identityFetch009Logged = false;
  var identityFetchPollTimer = null;
  var identityFetchButtonTimer = null;
  function extractProfileUsername(pathname) {
    var m = String(pathname || '').match(PROFILE_USER_RE);
    return m ? m[1] : '';
  }
  function getIdentityFetchRecord(cb) {
    try { chrome.storage.local.get(['pandaWatcherIdentityFetch'], function (o) { cb((o && o.pandaWatcherIdentityFetch) || null); }); }
    catch (e) { cb(null); }
  }
  function setIdentityFetchRecord(rec, cb) {
    try { chrome.storage.local.set({ pandaWatcherIdentityFetch: rec }, function () { if (cb) cb(); }); }
    catch (e) { if (cb) cb(); }
  }
  function findProfileButton() {
    try {
      var btn = document.querySelector('[data-e2e="profile-icon"]');
      if (btn) return btn;
      // Dự phòng Business Suite (probe không thấy profile-icon ở đó): tổ tiên bấm được
      // gần nhất của ảnh đại diện trong header/nav.
      var imgs = document.querySelectorAll('img');
      for (var i = 0; i < imgs.length; i++) {
        if (!elInTopBar(imgs[i])) continue;
        var node = imgs[i];
        while (node && node !== document.body) {
          var tag = node.tagName || '';
          var role = '';
          try { role = node.getAttribute ? (node.getAttribute('role') || '') : ''; } catch (e) {}
          if (tag === 'A' || tag === 'BUTTON' || role === 'button') return node;
          node = node.parentElement;
        }
      }
    } catch (e) {}
    return null;
  }
  function visibleAtLinks() {
    var out = [];
    try {
      var links = document.querySelectorAll('a');
      for (var i = 0; i < links.length; i++) {
        var href = '';
        try { href = links[i].getAttribute ? (links[i].getAttribute('href') || '') : ''; } catch (e) {}
        if (!PROFILE_USER_RE.test(href)) continue;
        var r = links[i].getBoundingClientRect();
        if (r && r.width > 0 && r.height > 0) out.push(links[i]);
      }
    } catch (e) {}
    return out;
  }
  function failProfileFetch(reason) {
    if (identityFetchPollTimer) { try { clearTimeout(identityFetchPollTimer); } catch (e) {} identityFetchPollTimer = null; }
    if (identityFetchButtonTimer) { try { clearTimeout(identityFetchButtonTimer); } catch (e) {} identityFetchButtonTimer = null; }
    getIdentityFetchRecord(function (rec) {
      setIdentityFetchRecord({ inProgress: false, returnUrl: (rec && rec.returnUrl) || '', attemptedAt: (rec && rec.attemptedAt) || Date.now() });
    });
    if (!identityFetch009Logged) {
      identityFetch009Logged = true;
      logBE('WATCHER_PROFILE_FAIL', 'Không mở được trang hồ sơ để lấy @username: ' + reason, 'WATCHER_009');
    }
  }
  function startProfileFetchClick() {
    // v1.2.10: CHỜ nút hồ sơ hiện lên thay vì tìm 1 lần rồi kết luận ngay — trang
    // TikTok lúc khởi động còn trắng/chưa tải xong header nên nút chưa tồn tại.
    // Poll mỗi 400ms tối đa ~15s; hết giờ vẫn không có nút mới fail + log WATCHER_009.
    var waitAttempts = 0;
    var maxWaitAttempts = 38; // ~15.2s với bước 400ms
    var waitForButton = function () {
      var btn = findProfileButton();
      if (!btn) {
        waitAttempts++;
        if (waitAttempts >= maxWaitAttempts) { failProfileFetch('Không thấy nút hồ sơ sau ~15s chờ trang tải'); return; }
        identityFetchButtonTimer = setTimeout(waitForButton, 400);
        return;
      }
      identityFetchButtonTimer = null;
      clickProfileButtonAndWaitMenu(btn);
    };
    waitForButton();
  }
  function clickProfileButtonAndWaitMenu(btn) {
    var before = visibleAtLinks().map(function (a) { try { return a.getAttribute('href') || ''; } catch (e) { return ''; } });
    try { btn.click(); } catch (e) { failProfileFetch('Không bấm được nút hồ sơ'); return; }
    // Sau khi bấm, hoặc trình duyệt tự chuyển trang (nút là link), hoặc menu hiện ra chứa
    // link /@. Poll tối đa ~5s tìm link /@ MỚI xuất hiện rồi bấm nó; hết giờ thì dừng + log 1 lần.
    var attempts = 0;
    var maxAttempts = 13; // ~5.2s với bước 400ms
    var poll = function () {
      attempts++;
      var links = visibleAtLinks();
      var fresh = null;
      for (var i = 0; i < links.length; i++) {
        var href = '';
        try { href = links[i].getAttribute('href') || ''; } catch (e) {}
        if (before.indexOf(href) === -1) { fresh = links[i]; break; }
      }
      if (fresh) {
        try { fresh.click(); } catch (e) {}
        return; // trình duyệt tự chuyển tới trang hồ sơ; cờ vẫn bật để bước lấy xử lý
      }
      if (attempts >= maxAttempts) { failProfileFetch('Không thấy link hồ sơ trong menu sau ~5s'); return; }
      identityFetchPollTimer = setTimeout(poll, 400);
    };
    identityFetchPollTimer = setTimeout(poll, 400);
  }
  function retryProfileIdentityFetchFromScan() {
    // v1.2.10: Quét ngay thử lại identity khi chưa có — hành động bấm nút của user
    // chính là lệnh thử lại nên BỎ QUA khóa 30 phút cho đúng 1 lần thử này (không
    // phải vòng lặp tự động); lần thử tay vẫn cập nhật attemptedAt để lần khởi động
    // tự động sau đó không thử trùng ngay. Đã có identity thì không động vào luồng này.
    if (!isMessagesPage()) return;
    if (state.identity && state.identity.username) return;
    if (cfg.account && cfg.account.replace(/^@/, '')) return;
    getIdentityFetchRecord(function (rec) {
      if (rec && rec.inProgress) return; // đang có chuyến đi hồ sơ chạy rồi, không chồng thêm
      setIdentityFetchRecord({ inProgress: true, returnUrl: location.href, attemptedAt: Date.now() }, function () {
        startProfileFetchClick();
      });
    });
  }
  function maybeStartProfileIdentityFetch() {
    if (!isMessagesPage()) return;
    // Đã có identity (mạng/tab/DOM/profile) hoặc đã điền tay @username -> không làm gì thêm.
    if (state.identity && state.identity.username) return;
    if (cfg.account && cfg.account.replace(/^@/, '')) return;
    getIdentityFetchRecord(function (rec) {
      var now = Date.now();
      if (rec && rec.inProgress) {
        // Đã quay về messages mà không qua bước lấy ở trang hồ sơ (vòng trước hỏng giữa
        // chừng / user tự quay lại) -> xóa cờ để lần sau ghé hồ sơ người khác không bị nhận
        // nhầm; giữ attemptedAt để không thử lại trong phiên này.
        setIdentityFetchRecord({ inProgress: false, returnUrl: rec.returnUrl || '', attemptedAt: rec.attemptedAt || now });
        return;
      }
      if (rec && rec.attemptedAt && (now - rec.attemptedAt < IDENTITY_FETCH_WINDOW_MS)) return; // đã thử trong phiên
      setIdentityFetchRecord({ inProgress: true, returnUrl: location.href, attemptedAt: now }, function () {
        startProfileFetchClick();
      });
    });
  }
  function handleProfilePageCapture() {
    var username = extractProfileUsername(location.pathname);
    if (!username) return;
    getIdentityFetchRecord(function (rec) {
      if (!rec || !rec.inProgress) return; // cờ TẮT: user tự mở hồ sơ người khác -> KHÔNG lấy, KHÔNG chuyển hướng
      var id = { username: username, user_id: '', user_id_str: '', sec_user_id: '', screen_name: '', avatar_url: '', source: 'profile' };
      state.identity = id;
      state.account = username;
      var back = (rec && rec.returnUrl) || BS_HOME;
      setIdentityFetchRecord({ inProgress: false, returnUrl: '', attemptedAt: rec.attemptedAt || Date.now() });
      storageSet({ pandaWatcherIdentity: Object.assign({}, id, { at: Date.now() }) });
      saveStats();
      logBE('WATCHER_IDENTITY', 'Tự nhận identity từ trang hồ sơ: @' + username, 'WATCHER_006');
      try { location.href = back; } catch (e) {}
    });
  }

  /* ---------- Khởi động ---------- */
  // v1.2.3: hook.js đã chạy sẵn dưới dạng content script MAIN world ở document_start
  // (khai trong manifest) nên KHÔNG còn chèn thẻ script ở đây nữa.

  storageGet().then(function (o) {
    if (o.pandaWatcherCfg) cfg = Object.assign({}, cfg, o.pandaWatcherCfg);
    // v1.2.1: tự nhận Account ID từ bản web (bridge ghi pandaWatcherAccountId / pandaWatcherLogin)
    // để tin đẩy lên gắn đúng acc mà không cần điền tay; ô nhập popup chỉ còn là ghi đè thủ công.
    var boot = function () {
      handleProfilePageCapture(); // trang hồ sơ + cờ bật -> lấy username từ URL rồi về messages
      detectDomIdentity();
      maybeStartProfileIdentityFetch(); // trang messages + chưa có identity -> đi hồ sơ 1 vòng duy nhất
      buildChip();
      setInterval(buildChip, 4000);
      setInterval(renderChip, 5000);
      setInterval(scanAll, (cfg.domScanSec || 20) * 1000);
      setInterval(heartbeat, (cfg.heartbeatSec || 60) * 1000);
      setInterval(function () { detectCaptcha(); pollQueue(); }, (cfg.queuePollSec || 8) * 1000);
      setInterval(pollOpenCommand, (cfg.openPollSec || 10) * 1000);
      setTimeout(function () { scanAll(); heartbeat(); }, 3000);
      logBE('WATCHER_START', 'Watcher khởi động trên tab TikTok (account: ' + (guessAccount() || 'chưa rõ') + ')', 'WATCHER_000');
    };
    try {
      chrome.storage.local.get(['pandaWatcherLogin', 'pandaWatcherAccountId', 'pandaWatcherIdentity', 'pandaWatcherProfiles'], function (a) {
        var autoId = (a && a.pandaWatcherLogin && a.pandaWatcherLogin.account && a.pandaWatcherLogin.account.open_id) || (a && a.pandaWatcherAccountId && a.pandaWatcherAccountId.open_id) || '';
        if (autoId && !cfg.accountId) { cfg.accountId = autoId; storageSet({ pandaWatcherCfg: cfg }); }
        // v1.2.2: khôi phục identity + map profile đã nhận từ tab TikTok ở phiên trước
        if (a && a.pandaWatcherIdentity && a.pandaWatcherIdentity.username && !state.identity) {
          state.identity = a.pandaWatcherIdentity;
          state.account = a.pandaWatcherIdentity.username;
        }
        if (a && a.pandaWatcherProfiles) {
          Object.assign(state.profileById, a.pandaWatcherProfiles);
          Object.keys(state.profileById).forEach(function (k) {
            var rec = state.profileById[k];
            var nn = CORE.normName(rec.nick_name || '');
            if (nn && rec.unique_id) state.profileByName[nn] = rec.unique_id;
          });
        }
        boot();
      });
    } catch (e) { boot(); }
  });

  try {
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (msg && msg.type === 'PANDA_SCAN_NOW') {
        retryProfileIdentityFetchFromScan(); // v1.2.10: chưa có identity -> bấm Quét ngay cũng kích hoạt 1 chuyến đi hồ sơ
        scanAll(); flush(); heartbeat();
        // v1.2.9: log chẩn đoán quét danh sách — CHỈ SỐ LƯỢNG, không tên/xem trước/
        // nội dung. Chạy trên mọi lần quét tay, cả /messages lẫn business-suite/messages.
        try {
          var d = state.lastListDiag || {};
          logBE('WATCHER_DIAG', 'Chan doan quet danh sach: path=' + (d.path || location.pathname) + ' dmItems=' + (d.dmItemCount || 0) + ' nick=' + (d.nickCount || 0) + ' dmRows=' + (d.dmRowsExtracted || 0) + ' generic=' + (d.genericRows || 0) + ' rowsOut=' + (d.rowsOut || 0) + ' branch=' + (d.branch || '?') + ' loai: junk=' + (d.dropJunk || 0) + ' khong-ten=' + (d.dropNoName || 0) + ' ten-dai=' + (d.dropNameLong || 0) + ' khong-text=' + (d.dropNoText || 0) + ' trung=' + (d.dropDup || 0) + ' loi-dong=' + (d.dropError || 0) + ' e2e-conv=' + (d.e2eConversationCount !== undefined ? d.e2eConversationCount : -1) + ' e2e-dm=' + (d.e2eDmCount !== undefined ? d.e2eDmCount : -1) + ' frames=' + (d.frameCount !== undefined ? d.frameCount : -1), 'WATCHER_DIAG');
        } catch (e) {}
        sendResponse({ ok: true, pushedTotal: state.pushedTotal });
      }
      if (msg && msg.type === 'PANDA_GET_STATE') { sendResponse({ state: state, cfg: { captureEnabled: cfg.captureEnabled, autoSendEnabled: cfg.autoSendEnabled, account: cfg.account } }); }
      return true;
    });
  } catch (e) {}
})();
