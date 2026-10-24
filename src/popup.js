// Cyan Panda Watcher — popup.js
(function () {
  var $ = function (id) { return document.getElementById(id); };

  function load() {
    chrome.storage.local.get(['pandaWatcherCfg', 'pandaWatcherStats'], function (o) {
      var cfg = o.pandaWatcherCfg || {};
      $('ckCapture').checked = cfg.captureEnabled !== false;
      $('ckAuto').checked = !!cfg.autoSendEnabled;
      $('inAccount').value = cfg.account || '';
      $('inAccountId').value = cfg.accountId || '';
      var st = o.pandaWatcherStats || {};
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
        $('btnSave').textContent = 'Đã lưu ✓ (tải lại tab TikTok để áp dụng)';
        setTimeout(load, 600);
      });
    });
  });

  $('btnScan').addEventListener('click', function () {
    chrome.tabs.query({ url: 'https://www.tiktok.com/*' }, function (tabs) {
      if (!tabs || !tabs.length) { $('stDetail').textContent = 'Chưa có tab TikTok nào đang mở.'; return; }
      chrome.tabs.sendMessage(tabs[0].id, { type: 'PANDA_SCAN_NOW' }, function () { setTimeout(load, 1500); });
    });
  });

  $('btnTool').addEventListener('click', function () {
    chrome.tabs.create({ url: 'https://nameerrorcantnotfind.github.io/cyan-pandatool/' });
  });

  $('btnSuite').addEventListener('click', function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var t = tabs && tabs[0];
      if (t && t.url && t.url.indexOf('tiktok.com') !== -1) chrome.tabs.update(t.id, { url: 'https://www.tiktok.com/business-suite/messages' });
      else chrome.tabs.create({ url: 'https://www.tiktok.com/business-suite/messages' });
    });
  });

  load();
})();
