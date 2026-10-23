// Cyan Panda Watcher — hook.js (chạy trong page world của tiktok.com)
// Bắt các response JSON mà CHÍNH trang TikTok tự gọi (fetch/XHR) rồi chuyển sang content script
// qua window.postMessage. Không thay đổi request/response gốc — chỉ sao chép dữ liệu trang đã nhận.
(function () {
  'use strict';
  if (window.__PANDA_HOOKED__) return;
  window.__PANDA_HOOKED__ = true;

  var IM_RE = /(im|message|inbox|conversation|notice|chat)/i;
  var MAX_BODY = 200000;

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
          var ct = (res.headers && res.headers.get) ? (res.headers.get('content-type') || '') : '';
          if (ct.indexOf('json') !== -1 || IM_RE.test(reqUrl)) {
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
        var ct = '';
        try { ct = xhr.getResponseHeader('content-type') || ''; } catch (e) {}
        if (ct.indexOf('json') !== -1 || IM_RE.test(url)) {
          var body = '';
          if (!xhr.responseType || xhr.responseType === 'text') body = xhr.responseText || '';
          else if (xhr.responseType === 'json' && xhr.response) body = JSON.stringify(xhr.response);
          emit('xhr', url, xhr.status, body);
        }
      } catch (e) {}
    });
    return origSend.apply(this, arguments);
  };
})();
