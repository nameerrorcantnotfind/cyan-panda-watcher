// Cyan Panda Watcher — popup.js (v1.2.10)
// v1.2.3: ghi chú nguồn identity — 'tab TikTok' = gói mạng passport, 'tab TikTok (DOM)' =
// fallback nhận diện từ link avatar header khi gói mạng không về. Các tính năng v1.2.1 giữ
// nguyên: ID + username tự nhận, mọi nút bấm đều hiện toast + cập nhật trạng thái.
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
    chrome.storage.local.get(['pandaWatcherCfg', 'pandaWatcherStats', 'pandaWatcherAccountId', 'pandaWatcherLogin', 'pandaWatcherIdentity'], function (o) {
      var cfg = o.pandaWatcherCfg || {};
      var st = o.pandaWatcherStats || {};
      var autoId = cfg.accountId || (o.pandaWatcherAccountId && o.pandaWatcherAccountId.open_id) || (o.pandaWatcherLogin && o.pandaWatcherLogin.account && o.pandaWatcherLogin.account.open_id) || '';
      var ident = o.pandaWatcherIdentity || null;
      var autoUser = (ident && ident.username) || cfg.account || st.account || '';
      $('ckCapture').checked = cfg.captureEnabled !== false;
      $('ckAuto').checked = !!cfg.autoSendEnabled;
      $('inAccount').value = autoUser;
      $('inAccountId').value = autoId;
      // v1.2.2: identity tự nhận từ chính tab TikTok — hiện rõ nguồn, khỏi dòng "Chưa tự nhận được"
      // v1.2.3: phân biệt nguồn — gói mạng passport = "từ tab TikTok", fallback DOM = "từ tab TikTok (DOM)"
      // v1.2.8: nguồn profile = tự đi qua trang hồ sơ lấy username từ URL khi khởi động
      $('autoNote').textContent = autoId
        ? '✅ Account ID đã tự nhận từ bản web — không cần điền tay.'
        : (ident && ident.username
          ? (ident.source === 'profile'
            ? '✅ @' + ident.username + ' đã tự nhận (từ trang hồ sơ) — không cần đăng nhập web.'
            : '✅ @' + ident.username + ' đã tự nhận từ tab TikTok' + (ident.source === 'dom' ? ' (DOM)' : '') + ' — không cần đăng nhập web.')
          : 'Chưa tự nhận được tài khoản — mở 1 tab TikTok đã đăng nhập là Watcher tự nhận từ tab đó.');
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
      // v1.2.4: dòng trạng thái danh sách — số hội thoại + số chưa rep (từ listScan)
      // v1.2.5: phân biệt rõ lý do — chưa chạy lần nào / không tìm thấy cột / 0 dòng / có dữ liệu
      if (st.listTotal !== undefined && st.listTotal !== null) {
        if (st.listReason === 'no-column') $('stList').textContent = 'Danh sách: chưa tìm thấy cột';
        else if (st.listReason === 'no-rows') $('stList').textContent = 'Danh sách: 0 hội thoại';
        else $('stList').textContent = 'Danh sách: ' + st.listTotal + ' hội thoại (' + (st.listUnread || 0) + ' chưa rep)';
      }
      else $('stList').textContent = 'Danh sách: chưa quét';
      // v1.2.9: dòng chẩn đoán quét danh sách — chỉ số lượng, không tên/nội dung.
      if (st.lastListDiag && st.lastListDiag.dmItemCount !== undefined) {
        $('stDiag').textContent = 'Chẩn đoán: trang có ' + st.lastListDiag.dmItemCount + ' dòng, tách được ' + (st.lastListDiag.rowsOut || 0) + ' dòng';
      }
      else $('stDiag').textContent = 'Chẩn đoán: chưa có dữ liệu';
      // v1.2.6: dòng trạng thái chặn — số tin không rõ người gửi đã bị chặn thay vì lưu 'unknown'
      if (st.blockedUnknown !== undefined && st.blockedUnknown !== null) {
        $('stBlocked').textContent = 'Đã chặn: ' + st.blockedUnknown + ' tin không rõ người gửi';
        if (st.blockedUnknown > 0 && st.at && age < 180) $('stDetail').textContent += ' · ⛔ Đã chặn ' + st.blockedUnknown + ' tin không rõ người gửi';
      }
      else $('stBlocked').textContent = 'Đã chặn: chưa có dữ liệu';
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
    // v1.2.9: QUÉT ĐÚNG TAB ĐANG MỞ — trước đây gửi cho tabs[0] trong toàn bộ tab
    // tiktok.com (thường là tab Business Suite mở trước) nên bấm Quét ngay lúc đang
    // xem /messages vẫn quét nhầm tab Business Suite và báo 0. Giờ ưu tiên tab đang
    // mở nếu là tab TikTok, chỉ khi tab đang mở không phải TikTok mới dùng tab TikTok đầu tiên.
    var doScan = function (tabId) {
      chrome.tabs.sendMessage(tabId, { type: 'PANDA_SCAN_NOW' }, function (res) {
        if (chrome.runtime.lastError) { showToast('Tab TikTok chưa nhận extension — tải lại trang TikTok rồi quét lại.'); return; }
        showToast('Đã gọi quét ✓ — tổng đã đẩy trong phiên này: ' + ((res && res.pushedTotal) || 0) + ' tin.');
        setTimeout(load, 1500);
      });
    };
    chrome.tabs.query({ active: true, currentWindow: true }, function (active) {
      var t = active && active[0];
      if (t && t.url && t.url.indexOf('tiktok.com') !== -1) { doScan(t.id); return; }
      chrome.tabs.query({ url: 'https://www.tiktok.com/*' }, function (tabs) {
        if (!tabs || !tabs.length) { showToast('Chưa có tab TikTok nào đang mở.'); return; }
        doScan(tabs[0].id);
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
