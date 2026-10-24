// Cyan Panda Watcher — popup.js (v1.2.1)
// v1.2.1: (1) ID + username TỰ NHẬN — Account ID lấy từ bản web đã đăng nhập (bridge ghi vào
// pandaWatcherAccountId), username lấy từ trang TikTok đang mở (stats.account); ô nhập chỉ còn là
// ghi đè thủ công khi tự nhận thất bại. (2) Mọi nút bấm đều hiện toast + cập nhật trạng thái,
// để người bấm biết chắc nút đã được gọi (kể cả khi tab TikTok chưa nhận extension).
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var toastTimer = null;

  function showToast(msg) {
    var t = $('pandaToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'pandaToast';
      t.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;background:#10281a;color:#eaffea;border:1px solid #2E7D32;border-radius:12px;padding:9px 12px;font:13px/1.5 sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35)';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.display = 'block';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.style.display = 'none'; }, 2600);
  }

  function load() {
    chrome.storage.local.get(['pandaWatcherCfg', 'pandaWatcherStats', 'pandaWatcherAccountId', 'pandaWatcherLogin'], function (o) {
      var cfg = o.pandaWatcherCfg || {};
      var st = o.pandaWatcherStats || {};
      var autoId = cfg.accountId || (o.pandaWatcherAccountId && o.pandaWatcherAccountId.open_id) || (o.pandaWatcherLogin && o.pandaWatcherLogin.account && o.pandaWatcherLogin.account.open_id) || '';
      var autoUser = cfg.account || st.account || '';
      $('ckCapture').checked = cfg.captureEnabled !== false;
      $('ckAuto').checked = !!cfg.autoSendEnabled;
      $('inAccount').value = autoUser;
      $('inAccountId').value = autoId;
      $('autoNote').textContent = autoId
        ? '✅ Account ID đã tự nhận từ bản web — không cần điền tay.'
        : 'Chưa tự nhận được Account ID — mở bản web đã đăng nhập TikTok 1 lần là tự nhận.';
      var age = st.at ? Math.round((Date.now() - st.at) / 1000) : null;
      if (st.at && age < 180) {
        $('stDot').className = 'dot ' + (st.captcha ? 'err' : 'on');
        $('stText').textContent = st.captcha ? 'Đang bị CAPTCHA chặn' : 'Watcher đang chạy';
        $('stDetail').textContent = 'Đã đẩy ' + (st.pushedTotal || 0) + ' tin · nhịp cuối ' + age + 's trước' + (st.lastError ? ' · Lỗi: ' + st.lastError : '');
      } else {
        $('stDot').className = 'dot';
        $('stText').textContent = 'Chưa thấy Watcher chạy';
        $('stDetail').textContent = 'Mở 1 tab tiktok.com (đã đăng nhập) là Watcher tự khởi động.';
      }
    });
  }

  $('btnSave').addEventListener('click', function () {
    chrome.storage.local.get(['pandaWatcherCfg'], function (o) {
      var cfg = o.pandaWatcherCfg || {};
      cfg.captureEnabled = $('ckCapture').checked;
      cfg.autoSendEnabled = $('ckAuto').checked;
      cfg.account = $('inAccount').value.trim().replace(/^@/, '');
      cfg.accountId = $('inAccountId').value.trim();
      chrome.storage.local.set({ pandaWatcherCfg: cfg }, function () {
        showToast('Đã lưu cấu hình ✓ (tải lại tab TikTok để áp dụng)');
        setTimeout(load, 600);
      });
    });
  });

  $('btnScan').addEventListener('click', function () {
    chrome.tabs.query({ url: 'https://www.tiktok.com/*' }, function (tabs) {
      if (!tabs || !tabs.length) { showToast('Chưa có tab TikTok nào đang mở.'); return; }
      chrome.tabs.sendMessage(tabs[0].id, { type: 'PANDA_SCAN_NOW' }, function (res) {
        if (chrome.runtime.lastError) { showToast('Tab TikTok chưa nhận extension — tải lại trang TikTok rồi quét lại.'); return; }
        showToast('Đã gọi quét ✓ — tổng đã đẩy trong phiên này: ' + ((res && res.pushedTotal) || 0) + ' tin.');
        setTimeout(load, 1500);
      });
    });
  });

  $('btnTool').addEventListener('click', function () {
    chrome.tabs.create({ url: 'https://nameerrorcantnotfind.github.io/cyan-pandatool/' });
    showToast('Đã mở Cyan Panda Tool (bản web).');
  });

  $('btnToolFull').addEventListener('click', function () {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/tool.html') });
    showToast('Đã mở tab Tool đầy đủ của Watcher.');
  });

  $('btnSuite').addEventListener('click', function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var t = tabs && tabs[0];
      if (t && t.url && t.url.indexOf('tiktok.com') !== -1) { chrome.tabs.update(t.id, { url: 'https://www.tiktok.com/business-suite/messages' }); showToast('Đã chuyển tab tới Business Suite Messages.'); }
      else { chrome.tabs.create({ url: 'https://www.tiktok.com/business-suite/messages' }); showToast('Đã mở Business Suite Messages.'); }
    });
  });

  load();
})();
