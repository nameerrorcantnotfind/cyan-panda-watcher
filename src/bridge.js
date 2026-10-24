// Cyan Panda Watcher v1.2 — bridge.js (content script, chạy trên trang web cyan-pandatool)
// Chỉ sao chép phiên đăng nhập TikTok (token + account) từ localStorage của trang web sang chrome.storage
// KHI CÓ yêu cầu mới (< 5 phút) từ tab Tool của extension (người dùng bấm nút "Đồng bộ đăng nhập từ web").
// Không tự động sao chép khi không có yêu cầu. Token chỉ di chuyển trong máy + trình duyệt của chủ tài khoản.
(function () {
  'use strict';
  try {
    chrome.storage.local.get(['pandaWatcherLoginRequest'], function (o) {
      var req = o && o.pandaWatcherLoginRequest;
      if (!req || Date.now() - req > 5 * 60 * 1000) return;
      var s = document.createElement('script');
      s.textContent = '(' + function () {
        try {
          var t = localStorage.getItem('panda_real_token_v262');
          var a = localStorage.getItem('panda_real_account_v262');
          if (t && a) window.postMessage({ __pandaLogin: { token: JSON.parse(t), account: JSON.parse(a) } }, location.origin);
        } catch (e) {}
      } + ')();';
      (document.head || document.documentElement).appendChild(s);
      s.remove();
    });
    window.addEventListener('message', function (ev) {
      if (ev.origin !== location.origin || !ev.data || !ev.data.__pandaLogin) return;
      var d = ev.data.__pandaLogin;
      if (!d.token || !d.account) return;
      chrome.storage.local.set({ pandaWatcherLogin: { token: d.token, account: d.account, at: Date.now() } });
      chrome.storage.local.remove('pandaWatcherLoginRequest');
    });
  } catch (e) {}
})();
