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
