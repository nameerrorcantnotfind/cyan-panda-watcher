// Cyan Panda Watcher — capture-core: chuẩn hoá + chống trùng (dedupe)
// Dùng chung cho: extension (trình duyệt), bản test Node (tools/), và đường ingest kiểm chứng.
// KHÔNG phụ thuộc DOM hay chrome API — chỉ xử lý dữ liệu thuần.

(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PandaCaptureCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // FNV-1a hash -> hex ngắn, đủ làm vân tay nội dung
  function fnv(str) {
    var h = 0x811c9dc5;
    str = String(str || '');
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  function slugify(name) {
    return String(name || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd').replace(/Đ/g, 'D')
      .toLowerCase().replace(/[^a-z0-9._]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
  }

  // Khoá chống trùng: tài khoản | hội thoại | chiều | mốc giờ (giây) | vân tay nội dung
  function dedupeKey(rec) {
    var ts = rec.at ? Math.floor(new Date(rec.at).getTime() / 1000) : 0;
    return [rec.account || '', rec.conversation || '', rec.direction || '', ts, fnv(rec.content || '')].join('|');
  }

  // Chuẩn hoá 1 bản ghi thô -> bản ghi sẵn sàng ghi vào bảng messages của Supabase
  // raw: { account, conversation, counterpartName, counterpartUsername, direction: 'in'|'out'|'sys', content, at: Date|number|string }
  function normalizeMessage(raw, source) {
    if (!raw || !raw.content || !String(raw.content).trim()) return null;
    var at = raw.at ? new Date(raw.at) : new Date();
    if (isNaN(at.getTime())) at = new Date();
    var rec = {
      account: raw.account || '',
      conversation: raw.conversation || raw.counterpartUsername || slugify(raw.counterpartName),
      counterpartName: raw.counterpartName || '',
      counterpartUsername: raw.counterpartUsername || '',
      direction: raw.direction || 'in',
      content: String(raw.content).trim(),
      at: at.toISOString()
    };
    rec.dedupe_key = dedupeKey(rec);
    return {
      fan_username: rec.counterpartUsername || slugify(rec.counterpartName) || rec.conversation,
      direction: rec.direction,
      content: rec.content,
      created_at: rec.at,
      source: source || 'watcher',
      dedupe_key: rec.dedupe_key,
      meta: {
        account: rec.account,
        conversation: rec.conversation,
        counterpart_name: rec.counterpartName || '',
        via: raw.via || 'api'
      }
    };
  }

  // Quét sâu 1 object JSON bất kỳ, tìm các cấu trúc giống TIN NHẮN / HỘI THOẠI.
  // Trả về mảng raw records (chưa normalize). Đây là tầng "đoán cấu trúc" — luôn kèm via:'api-scan'
  // để đối chiếu với dữ liệu DOM thật; không khẳng định 100% cho tới khi có log thật từ máy người dùng.
  var TEXT_KEYS = ['text', 'content', 'message', 'body', 'msg_content'];
  var TIME_KEYS = ['create_time', 'created_at', 'createTime', 'timestamp', 'time', 'send_time'];
  var CONV_KEYS = ['conversation_id', 'conversationId', 'chat_id', 'room_id'];
  var SENDER_KEYS = ['from', 'sender', 'sender_id', 'from_id', 'author', 'user_id'];

  function pick(obj, keys) {
    for (var i = 0; i < keys.length; i++) {
      if (obj[keys[i]] !== undefined && obj[keys[i]] !== null && obj[keys[i]] !== '') return obj[keys[i]];
    }
    return undefined;
  }

  function toDate(v) {
    if (v === undefined || v === null) return null;
    var n = typeof v === 'string' && /^\d+$/.test(v) ? parseInt(v, 10) : v;
    if (typeof n === 'number') {
      if (n > 1e12) return new Date(n);            // ms
      if (n > 1e9) return new Date(n * 1000);      // s
      return null;
    }
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  function scanJsonForMessages(json, selfUsername, out, depth) {
    out = out || [];
    depth = depth || 0;
    if (!json || typeof json !== 'object' || depth > 8 || out.length > 500) return out;
    if (Array.isArray(json)) {
      for (var i = 0; i < json.length; i++) scanJsonForMessages(json[i], selfUsername, out, depth + 1);
      return out;
    }
    var text = pick(json, TEXT_KEYS);
    var time = toDate(pick(json, TIME_KEYS));
    if (typeof text === 'string' && text.trim() && time) {
      var sender = pick(json, SENDER_KEYS);
      var conv = pick(json, CONV_KEYS);
      var senderName = (sender && typeof sender === 'object') ? (sender.nickname || sender.display_name || sender.unique_id || '') : '';
      var senderId = (sender && typeof sender === 'object') ? (sender.unique_id || sender.id || '') : String(sender || '');
      out.push({
        account: selfUsername || '',
        conversation: conv ? String(conv) : (senderId || ''),
        counterpartName: senderName,
        counterpartUsername: senderId && senderId !== selfUsername ? senderId : '',
        direction: (selfUsername && senderId && senderId === selfUsername) ? 'out' : 'in',
        content: text,
        at: time,
        via: 'api-scan'
      });
    }
    for (var k in json) {
      if (Object.prototype.hasOwnProperty.call(json, k) && typeof json[k] === 'object') {
        scanJsonForMessages(json[k], selfUsername, out, depth + 1);
      }
    }
    return out;
  }

  // v1.2.2 — Recognizer cho 2 endpoint allowlist (xác minh từ log thật trên máy người dùng).
  // (a) passport/web/account/info -> identity của NGƯỜI XEM (chính chủ tab TikTok).
  // Trả về { username, user_id, user_id_str, sec_user_id, screen_name, avatar_url } hoặc null.
  function parsePassportAccountInfo(json) {
    if (!json || typeof json !== 'object') return null;
    var d = json.data;
    if (!d || typeof d !== 'object') return null;
    if (!d.username && !d.user_id && !d.user_id_str) return null;
    return {
      username: d.username ? String(d.username) : '',
      user_id: d.user_id !== undefined && d.user_id !== null ? String(d.user_id) : '',
      user_id_str: d.user_id_str ? String(d.user_id_str) : '',
      sec_user_id: d.sec_user_id ? String(d.sec_user_id) : '',
      screen_name: d.screen_name ? String(d.screen_name) : '',
      avatar_url: d.avatar_url ? String(d.avatar_url) : ''
    };
  }

  // (b) tiktok/v1/im/user/profile -> map đối tác.
  // Trả về { byId: { user_id/user_id_str -> { unique_id, nick_name, user_id, user_id_str } },
  //           byName: { nick_name đã chuẩn hoá (bỏ dấu, thường) -> unique_id } }.
  // byName dùng để đối chiếu tên hiển thị trên tiêu đề hội thoại -> @username thật
  // (sửa lỗi fan "unknown" trước đây, khi map chỉ dựa vào slug tên).
  function normName(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function parseImUserProfiles(json) {
    var byId = {}, byName = {};
    if (!json || typeof json !== 'object' || !Array.isArray(json.users)) return { byId: byId, byName: byName };
    for (var i = 0; i < json.users.length; i++) {
      var u = json.users[i];
      var p = (u && u.im_user_profile) || null;
      if (!p) continue;
      var rec = {
        unique_id: p.unique_id ? String(p.unique_id) : '',
        nick_name: p.nick_name ? String(p.nick_name) : '',
        user_id: p.user_id !== undefined && p.user_id !== null ? String(p.user_id) : '',
        user_id_str: p.user_id_str ? String(p.user_id_str) : ''
      };
      if (rec.user_id) byId[rec.user_id] = rec;
      if (rec.user_id_str) byId[rec.user_id_str] = rec;
      var nn = normName(rec.nick_name);
      if (nn && rec.unique_id) byName[nn] = rec.unique_id;
    }
    return { byId: byId, byName: byName };
  }

  return { fnv: fnv, slugify: slugify, dedupeKey: dedupeKey, normalizeMessage: normalizeMessage, scanJsonForMessages: scanJsonForMessages, toDate: toDate, parsePassportAccountInfo: parsePassportAccountInfo, parseImUserProfiles: parseImUserProfiles, normName: normName };
});
