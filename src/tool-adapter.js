// Cyan Panda Watcher v1.2 — tool-adapter.js (chạy trong tab Tool của extension)
// Việc duy nhất: đưa phiên đăng nhập TikTok từ bản web (github.io) sang tab Tool của extension,
// vì TikTok chỉ chấp nhận redirect về github.io nên đăng nhập không thể hoàn tất ngay trong extension.
// Luồng: bấm nút "Đồng bộ đăng nhập từ web" -> mở tab web tool -> bridge trên trang web (khi có yêu cầu mới < 5 phút)
// đọc token/account từ localStorage của trang web -> cất vào chrome.storage -> adapter nhận -> ghi vào localStorage của extension -> tải lại trang.
// Token chỉ di chuyển trong máy + trình duyệt của chủ tài khoản, không qua server nào khác.
(function () {
  'use strict';
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
  var BTN_ID = 'pandaSyncLoginBtn';
  function readPageLogin() {
    try {
      var t = localStorage.getItem('panda_real_token_v262');
      var a = localStorage.getItem('panda_real_account_v262');
      if (!t || !a) return null;
      return { token: JSON.parse(t), account: JSON.parse(a) };
    } catch (e) { return null; }
  }
  function applyLogin(stored) {
    if (!stored || !stored.token || !stored.account) return false;
    var cur = readPageLogin();
    if (cur && cur.account && cur.account.open_id === stored.account.open_id) return false; // đã khớp, khỏi ghi lại
    try {
      localStorage.setItem('panda_real_token_v262', JSON.stringify(stored.token));
      localStorage.setItem('panda_real_account_v262', JSON.stringify(stored.account));
      return true;
    } catch (e) { return false; }
  }
  function buildBtn() {
    if (document.getElementById(BTN_ID)) return;
    var b = document.createElement('button');
    b.id = BTN_ID;
    b.textContent = '🔑 Đồng bộ đăng nhập từ web';
    b.title = 'Đăng nhập TikTok 1 lần trên bản web, rồi bấm nút này để đưa phiên sang tab Tool của Watcher';
    b.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483647;background:#2E7D32;color:#fff;border:0;border-radius:12px;padding:9px 14px;font:13px/1.4 sans-serif;font-weight:700;cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,.35)';
    b.addEventListener('click', function () {
      b.disabled = true; b.textContent = '⏳ Đang mở bản web để lấy phiên…';
      chrome.storage.local.set({ pandaWatcherLoginRequest: Date.now() }, function () {
        chrome.tabs.create({ url: 'https://nameerrorcantnotfind.github.io/cyan-pandatool/' });
        var t0 = Date.now();
        var timer = setInterval(function () {
          chrome.storage.local.get(['pandaWatcherLogin'], function (o) {
            var s = o && o.pandaWatcherLogin;
            if (s && s.at && s.at >= t0 - 5000) {
              clearInterval(timer);
              if (applyLogin(s)) { b.textContent = '✅ Đã đồng bộ — đang tải lại…'; location.reload(); }
              else { b.disabled = false; b.textContent = '🔑 Đồng bộ đăng nhập từ web'; }
            } else if (Date.now() - t0 > 90000) {
              clearInterval(timer); b.disabled = false; b.textContent = '🔑 Đồng bộ đăng nhập từ web';
              alert('Chưa lấy được phiên đăng nhập. Hãy chắc chắn bản web đã đăng nhập TikTok rồi bấm lại.');
            }
          });
        }, 3000);
      });
    });
    document.body.appendChild(b);
  }
  function init() {
    // Áp dụng phiên đã đồng bộ từ trước (nếu acc khác với phiên hiện tại trong tab này)
    chrome.storage.local.get(['pandaWatcherLogin'], function (o) {
      var s = o && o.pandaWatcherLogin;
      if (s && applyLogin(s)) { location.reload(); return; }
      buildBtn();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
