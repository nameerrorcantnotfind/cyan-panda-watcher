// Cyan Panda Watcher — hook.js v1.2.2 (chạy trong page world của tiktok.com)
// Bắt các response JSON mà CHÍNH trang TikTok tự gọi (fetch/XHR) rồi chuyển sang content script
// qua window.postMessage. Không thay đổi request/response gốc — chỉ sao chép dữ liệu trang đã nhận.
//
// v1.2.2 — ALLOWLIST HẸP (theo lệnh "dư thừa k cần bắt"): CHỈ chuyển tiếp 2 endpoint có ích:
//   (1) passport/web/account/info  -> identity của NGƯỜI XEM (chính chủ tab TikTok)
//   (2) tiktok/v1/im/user/profile -> map đối tác (user_id -> unique_id/nick_name)
// Mọi thứ khác (monitoring, story, quảng cáo, permission...) KHÔNG bắt nữa — đó là nguồn
// 27 gói rác/phiên trước đây. Tin nhắn KHÔNG lấy từ tầng mạng (im-api trả protobuf rỗng),
// mà lấy từ DOM đã render (xem domScan trong content.js).
(function () {
  'use strict';
  if (window.__PANDA_HOOKED__) return;
  window.__PANDA_HOOKED__ = true;

  var MAX_BODY = 200000;

  function isAllowlisted(url) {
    return url.indexOf('passport/web/account/info') !== -1 ||
           url.indexOf('tiktok/v1/im/user/profile') !== -1;
  }

  function emit(kind, url, status, body) {
    try {
      window.postMessage({ __panda: 'capture', kind: kind, url: url, status: status, body: body ? body.slice(0, MAX_BODY) : '' }, location.origin);
    } catch (e) {}
  }

  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function () {
      var args = arguments;
      var reqUrl = '';
      try { reqUrl = (args[0] && args[0].url) ? args[0].url : String(args[0]); } catch (e) {}
      return origFetch.apply(this, args).then(function (res) {
        try {
          if (isAllowlisted(reqUrl)) {
            res.clone().text().then(function (t) { emit('fetch', reqUrl, res.status, t); }).catch(function () {});
          }
        } catch (e) {}
        return res;
      });
    };
  }

  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) { this.__panda_url = url; return origOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    var xhr = this;
    xhr.addEventListener('load', function () {
      try {
        var url = String(xhr.__panda_url || '');
        if (!isAllowlisted(url)) return;
        var body = '';
        if (!xhr.responseType || xhr.responseType === 'text') body = xhr.responseText || '';
        else if (xhr.responseType === 'json' && xhr.response) body = JSON.stringify(xhr.response);
        emit('xhr', url, xhr.status, body);
      } catch (e) {}
    });
    return origSend.apply(this, arguments);
  };
})();
