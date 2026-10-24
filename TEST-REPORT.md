# Báo cáo test E2E — Cyan Panda Watcher v1.0.0 (trên máy Gà Con, 24/10/2026)

## Mục tiêu (CYAN giao 04:39)
Watcher quét được data từ TikTok web → đẩy xuống BE (Supabase) → Cyan Panda Tool hiển thị được tin nhắn
của hội thoại **HƯNG THÁI - DUBAI** (acc clone @dy0lzqk9wxwn) trong tab Inbox — kể cả tin cũ >30 ngày.

## Data nguồn (THẬT)
4 bản ghi do Gà Con quan sát trực tiếp trên TikTok web bằng acc clone (phiên CYAN đăng nhập):
3 tin acc clone đã gửi ngày 29/10/2024 11:52 ("a li", "anh ouw", "em đây") + 1 dòng hệ thống 01/11/2024 17:47.
Lưu tại `tools/fixture-clone-conversation.json`.

## Kết quả
1. **Migration BE: PASS** — `messages` thêm cột `source / dedupe_key / meta` + unique index chống trùng;
   bật Realtime cho `messages` + `queue` (SQL chạy không lỗi).
2. **Chuẩn hoá + dedupe (capture-core của Watcher): PASS** — 4/4 tin normalize OK, dedupe_key ổn định qua 2 lần chạy.
3. **Đẩy lên BE: PASS** — lần 1: insert 4 tin (BE id 2–5) + upsert fan `hung-thai-dubai`.
   Lần 2 (chạy lại y hệt): **0 tin mới** — chống trùng hoạt động đúng trên BE thật.
4. **Tool hiển thị: PASS 7/7** — nạp đúng 4 dòng BE thật vào FE v3.11: Inbox bộ lọc "Gần nhất" thấy hội thoại,
   xem trước thấy đủ 3 tin + dòng hệ thống (kiểm chứng bằng harness + verify311live).
   FE v3.11 tổng thể: harness 15/15 PASS.

## Giới hạn trung thực
Extension chạy *bên trong Chrome của CYAN* chưa kiểm chứng được từ máy Gà Con (trình duyệt của Gà Con
không cài được extension vào phiên TikTok). Phần đã kiểm chứng là toàn bộ đường ống từ điểm bắt data
(dùng đúng capture-core của Watcher) → BE → FE. Lượt chạy thật đầu tiên của extension trong Chrome
của CYAN sẽ có log `WATCHER_*` trên BE để đối chiếu/tinh chỉnh selector nếu cần.

## Dọn dẹp sau test (theo lệnh CYAN)
Sau khi có bằng chứng trên, toàn bộ data test của acc clone (messages `source=watcher-test` + fan
`hung-thai-dubai`) đã được XOÁ khỏi BE. Bản sao bằng chứng giữ tại `tools/backup-ingest-*.json`.
Data thật của CYAN không bị đụng.

## v1.1.0 — Business Suite (25/10, theo hướng CYAN)
- Nhà là Business Suite messages: mọi thao tác (quét/gửi/mở) đi qua https://www.tiktok.com/business-suite/messages; nếu tab đang không ở trang tin nhắn thì tự chuyển tới đó (nếu acc không có Business Suite, TikTok tự chuyển về /messages — khung chat vẫn cùng loại).
- Tìm hội thoại: khớp cả tên hiển thị + @username, không phân biệt dấu (normText: bỏ dấu + gộp dấu phân cách) — vì danh sách chỉ hiện tên hiển thị, không hiện @username.
- Không thấy trong danh sách đã tải: cuộn tải thêm tối đa 10 nhịp, cuối cùng thử ô Tìm kiếm chung của trang (chưa xác minh có lọc hội thoại không — chỉ thử, không bảo đảm).
- Điều hướng bằng click nội trang, KHÔNG deep link (mở hội thoại không đổi URL — đã xác minh 25/10).
- Lệnh mở từ tool web: tool v3.14 có nút "Mở trên TikTok (Business Suite)" trong khung xem trước hội thoại → ghi app_state watcher_open → Watcher kiểm tra mỗi 10s, tự chuyển tab + mở đúng hội thoại, ghi log WATCHER_005 (thành công/thất bại).
- Giữ nguyên: accountId (v1.0.1), lọc queue theo acc, CAPTCHA dừng + báo, gửi xong mới ghi sent.
- Kiểm thử: node --check toàn bộ src/*.js PASS; harness314 (tool web) 5/5 PASS (nút mở + ghi watcher_open đúng username/displayName/at).
- CHƯA xác minh trên acc chính: class hash thật của dòng/bong bóng, nút Gửi có hiện sau khi nhập không, ô Tìm kiếm chung có lọc hội thoại không, infinite scroll với 1631 hội thoại — chốt bằng lượt chạy thật đầu tiên trên Chrome của CYAN.

## v1.1.1 — Tự trả lời (25/10, theo luật mới của CYAN)
- Đổi tên "chế độ treo" → "Tự trả lời" (popup + chip trạng thái trên trang).
- Thêm nút "↻ Tải lại tab TikTok" trong popup: bấm sau khi giải CAPTCHA tay xong để trang sạch lại rồi Watcher chạy tiếp (do người bấm, không tự lách CAPTCHA).
- KHÔNG thêm: tự đóng tab/mở lại để qua CAPTCHA (mở lại vẫn hiện CAPTCHA vì trạng thái chặn nằm phía server TikTok, mở lại nhiều lần còn giống bot hơn), không xóa khung CAPTCHA để lách (thao tác vẫn bị chặn phía server).
- Đi kèm tool web v3.15: vòng Tự trả lời + luật tin nhạy cảm mới (xem changelog v3.15).

## v1.2.0 — Extension làm chính (25/10, theo khung CYAN: web chỉ là mẫu/demo, extension mới lấy dữ liệu làm việc)
- Tab Tool toàn trang mới: `src/tool.html` = code web v3.15 nguyên vẹn (chỉ đổi <title> + gắn thêm `tool-adapter.js`), đủ mọi chức năng: fan, duyệt tin, gợi ý AI, hàng đợi, dán tin, AI Training, tài liệu, ký ức, cài đặt, nhật ký, theme, vòng Tự trả lời + luật tin nhạy cảm. Mở bằng nút "🧰 Mở Tool đầy đủ (tab Watcher)" trong popup.
- Đăng nhập: TikTok chỉ chấp nhận redirect về github.io nên đăng nhập vẫn bắt đầu trên bản web; cầu nối `src/bridge.js` (content script trên trang web) CHỈ sao chép token/account khi có yêu cầu mới < 5 phút từ tab Tool (người dùng bấm nút "🔑 Đồng bộ đăng nhập từ web" góc dưới tab Tool) -> chrome.storage -> `tool-adapter.js` ghi vào localStorage của extension -> tải lại trang. Token chỉ di chuyển trong máy + trình duyệt của chủ tài khoản.
- Lưu ý trung thực: (1) KEY AI trong Setting của bản web KHÔNG tự sang extension (localStorage khác origin, KEY không qua Supabase theo thiết kế) — mở tab Tool lần đầu nhập lại KEY 1 lần. (2) Supabase config mặc định đã nhúng sẵn trong code nên không cần nhập lại. (3) Web có tính năng mới thì phải port sang tool.html của extension (không tự có như cách nhúng iframe) — chấp nhận được vì web chỉ là mẫu.
- Kiểm thử: node --check toàn bộ src/*.js PASS; diff tool.html vs index.html chỉ khác <title> + dòng gắn adapter; test adapter 2/2 PASS (phiên mới -> ghi + tải lại; phiên đã khớp -> không tải lại + hiện nút); manifest 1.2.0 đã có content script bridge + host_permissions cho Supabase và 4 API AI.
- CHƯA xác minh trong Chrome thật: tab Tool chạy + nút đồng bộ đăng nhập + gọi API AI từ extension page — chốt bằng lượt chạy thật đầu tiên trên Chrome của CYAN (cùng đợt với kiểm chứng Business Suite v1.1).

## v1.2.1 — Tự nhận ID/username + toast mọi nút + gọn nút (25/10, theo yêu cầu CYAN)
- KHÔNG CÒN ĐIỀN TAY: Account ID tự nhận từ bản web đã đăng nhập — bridge trên trang web luôn đồng bộ open_id sang chrome.storage (pandaWatcherAccountId); content script lúc khởi động tự lấy ID này (hoặc từ pandaWatcherLogin của tab Tool) gắn vào tin đẩy lên; username tự nhận từ trang TikTok đang mở (link profile) + hiển thị trong popup. Ô nhập popup chỉ còn là ghi đè thủ công khi tự nhận thất bại, kèm dòng ghi chú "đã tự nhận / chưa tự nhận được".
- TOAST MỌI NÚT POPUP: bấm nút nào cũng hiện toast xác nhận đã gọi (Quét ngay / Lưu / Mở Tool / Mở Business Suite / Mở Tool đầy đủ) + cập nhật trạng thái; riêng Quét ngay: nếu tab TikTok chưa nhận extension thì toast báo rõ "tải lại trang TikTok rồi quét lại" thay vì im lặng như trước.
- GỌN NÚT (theo ý CYAN): BỎ nút "Tải lại tab TikTok" — giữ duy nhất nút "Mở Business Suite Messages" vì cả hai cùng là tải lại một trang, mà nút Business Suite còn về đúng trang làm việc (kể cả khi đang ở trang TikTok khác, hoặc khi chưa có tab TikTok thì mở tab mới).
- ĐÍNH CHÍNH: nhịp tim báo version 1.1.1 ở lần chạy trước KHÔNG phải do tab chạy script cũ — bản v1.2.0 không hề sửa content.js nên nhịp tim 1.1.1 là đúng bản mới nhất lúc đó. Từ v1.2.1, nhịp tim báo đúng 1.2.1.
- Kiểm thử: node --check toàn bộ src/*.js PASS; test popup 5/5 PASS (prefill ID + username tự động, ghi chú tự nhận, toast khi không có tab TikTok, toast khi lưu); grep xác nhận không còn btnReload trong popup.

## v1.2.2 — Lấy ID từ tab TikTok + quét DOM không phụ thuộc class + allowlist 2 endpoint (25/10, theo lệnh CYAN "dư thừa k cần bắt")
- BỐI CẢNH: phân tích file probe thật từ trình duyệt CYAN (247 records) cho thấy toàn bộ call im-api get_by_user_init/combo đều có body rỗng (protobuf nhị phân) — KHÔNG có dạng JSON tin nhắn để lấy từ tầng mạng. Tin nhắn chỉ lấy được từ DOM đã render. Đồng thời CYAN chất vấn đúng: Watcher chạy trên tab TikTok đã đăng nhập thì phải tự lấy @username/ID từ chính tab đó, không được bắt buộc đăng nhập web.
- HOOK ALLOWLIST HẸP: src/hook.js chỉ còn chuyển tiếp đúng 2 endpoint có ích — passport/web/account/info (identity người xem) và tiktok/v1/im/user/profile (map đối tác). Bỏ deep-scan chung chung mọi JSON — đó là nguồn 27 gói rác/phiên trước đây. Cơ chế hook fetch/XHR page-world giữ nguyên.
- RECOGNIZER MỚI (capture-core.js, giữ nguyên dedupeKey/normalizeMessage): parsePassportAccountInfo -> {username, user_id, user_id_str, sec_user_id, screen_name, avatar_url}; parseImUserProfiles -> map user_id/user_id_str -> {unique_id, nick_name} + map ngược nick_name (không dấu) -> unique_id để đối chiếu tên hiển thị trên tiêu đề hội thoại, sửa lỗi fan "unknown" trước đây.
- IDENTITY TỪ TAB: content.js khi nhận gói passport thì lưu identity vào chrome.storage (pandaWatcherIdentity) + dùng làm cfg.account; heartbeat báo version 1.2.2 + identitySource 'tab'; popup hiển thị "@username đã tự nhận từ tab TikTok" thay cho dòng "Chưa tự nhận được". Web bridge vẫn giữ làm fallback cho open_id.
- DOMSCAN VIẾT LẠI, KHÔNG PHỤ THUỘC CLASS HASH: neo theo ô soạn tin (placeholder chứa "Gửi tin nhắn") -> tìm khung hội thoại là container cuộn được cùng cột chat, loại cột danh sách (chứa tiêu đề "Tin nhắn") -> duyệt các khối tin con: text = innerText đã bỏ dòng chỉ là giờ/ngày, hướng = vị trí ngang block so với giữa khung (phải = mình gửi, trái = đối tác), timestamp = giờ/ngày gần nhất trong hàng chứa block (thêm dạng DD/MM), đối tác = tiêu đề hội thoại (h2) đối chiếu map profile, không thấy timestamp thì dùng mốc lần đầu thấy trong phiên để khoá dedupe ổn định. Chưa mở hội thoại (không có ô soạn) thì quét = 0 như cũ.
- ACCOUNT KEY: dòng đẩy lên ưu tiên open_id (web bridge), nếu không có thì dùng @username từ tab TikTok; lọc queue cũng mở rộng tương ứng (open_id, hoặc @username + dòng cũ chưa gắn acc). Tool web v3.16 đọc cả 2 dạng nên vòng lặp chạy được mà không cần đăng nhập web trước.
- GIỮ NGUYÊN v1.2.1: toast mọi nút popup, nút Quét ngay (PANDA_SCAN_NOW), nút Mở Business Suite (không có nút tải lại tab), tự nhận ID từ web bridge làm fallback, claim queue chống gửi trùng, phát hiện CAPTCHA thì dừng + báo. Gửi tin cũng dùng findComposer + xác minh bong bóng không phụ thuộc class (pane chứa nội dung mới) thay cho selector class cũ.
- Kiểm thử: node --check toàn bộ src/*.js PASS; harness122 (tools/harness122.js) 19/19 PASS: recognizer passport (4), recognizer profile + map ngược (3), hook allowlist (passport qua, monitoring chặn, profile XHR qua) (3), domScan trên DOM giả (3 tin, đúng hướng in/out/in, đối tác slug từ h2, không lẫn text danh sách, account key = username từ tab) (6), Quét ngay -> flush POST (1), popup prefill identity + ghi chú nguồn tab (2).
- CHƯA KIỂM CHỨNG ĐƯỢC: DOM thật của Business Suite trên acc chính (cấu trúc khung cuộn/ô soạn có thể khác DOM giả trong harness — harness mô phỏng theo bố cục chung cột danh sách trái + cột chat phải + ô soạn dưới). Chốt bằng lượt chạy thật đầu tiên trên Chrome của CYAN sau khi cài v1.2.2: mở 1 hội thoại + Quét ngay, "Đã đẩy" phải tăng.
