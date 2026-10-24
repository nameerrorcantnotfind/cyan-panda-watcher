// Cyan Panda Watcher v1.2.1 — bridge.js (content script, chạy trên trang web cyan-pandatool)
// Hai luồng tách riêng:
// (1) LUÔN đồng bộ open_id + username (không phải bí mật — hiện sẵn trong tab Kết Nối của tool)
//     sang chrome.storage (pandaWatcherAccountId) để Watcher tự nhận Account ID, khỏi điền tay.
// (2) Token CHỈ sao chép khi có yêu cầu mới (< 5 phút) từ tab Tool của extension (người dùng bấm nút
//     "Đồng bộ đăng nhập từ web") — token không tự động di chuyển.
// Cả hai chỉ di chuyển trong máy + trình duyệt của chủ tài khoản.
(function () {
  'use strict';
  function inject(fn) {
    try {
      var s = document.createElement('script');
      s.textContent = '(' + fn + ')();';
      (document.head || document.documentElement).appendChild(s);
      s.remove();
    } catch (e) {}
  }
  // (1) Luôn đồng bộ open_id.
  inject(function () {
    try {
      var a = localStorage.getItem('panda_real_account_v262');
      if (a) {
        var acc = JSON.parse(a);
        if (acc && acc.open_id) window.postMessage({ __pandaAccount: { open_id: acc.open_id, username: acc.username || '' } }, location.origin);
      }
    } catch (e) {}
  });
  // (2) Token: chỉ khi có yêu cầu mới.
  try {
    chrome.storage.local.get(['pandaWatcherLoginRequest'], function (o) {
      var req = o && o.pandaWatcherLoginRequest;
      if (!req || Date.now() - req > 5 * 60 * 1000) return;
      inject(function () {
        try {
          var t = localStorage.getItem('panda_real_token_v262');
          var a = localStorage.getItem('panda_real_account_v262');
          if (t && a) window.postMessage({ __pandaLogin: { token: JSON.parse(t), account: JSON.parse(a) } }, location.origin);
        } catch (e) {}
      });
    });
    window.addEventListener('message', function (ev) {
      if (ev.origin !== location.origin || !ev.data) return;
      if (ev.data.__pandaAccount && ev.data.__pandaAccount.open_id) {
        chrome.storage.local.set({ pandaWatcherAccountId: { open_id: ev.data.__pandaAccount.open_id, username: ev.data.__pandaAccount.username || '', at: Date.now() } });
      }
      if (ev.data.__pandaLogin && ev.data.__pandaLogin.token && ev.data.__pandaLogin.account) {
        chrome.storage.local.set({ pandaWatcherLogin: { token: ev.data.__pandaLogin.token, account: ev.data.__pandaLogin.account, at: Date.now() } });
        chrome.storage.local.remove('pandaWatcherLoginRequest');
      }
    });
  } catch (e) {}
})();
