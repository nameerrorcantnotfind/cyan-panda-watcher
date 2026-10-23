# Cyan Panda Watcher

Tiện ích mở rộng (extension) cho trình duyệt Chrome / Cốc Cốc — cầu nối giữa **TikTok web** và **Cyan Panda Tool** qua Supabase.

## Nó làm gì

1. **Quét data thật từ TikTok web**: ngồi trong tab `tiktok.com` (đã đăng nhập), bắt các response mà chính TikTok trả về mỗi lần trang tải + quét DOM trang Tin nhắn (tầng dự phòng), chuẩn hoá thành tin nhắn/hội thoại.
2. **Đẩy data MỚI lên Supabase**: mỗi tin có `dedupe_key` (tài khoản | hội thoại | chiều | mốc giờ | vân tay nội dung) — chỉ đẩy tin chưa có trong DB, tải lại trang bao nhiêu lần cũng không trùng.
3. **Heartbeat**: mỗi phút ghi trạng thái vào bảng `app_state` (key `watcher_status`) để tool web hiện đèn "Watcher đang sống".
4. **Thực thi lệnh gửi** (MẶC ĐỊNH TẮT): khi chủ tài khoản bật trong popup, Watcher nhận lệnh ở bảng `queue` (status `approved`), claim lệnh (chống 2 tab gửi trùng), mở đúng hội thoại bằng click nội trang, điền thẳng vào ô chat (không dùng clipboard của máy), bấm Gửi, thấy bong bóng tin xuất hiện mới ghi `sent` — không thấy là `failed` + ghi log.
5. **CAPTCHA**: phát hiện CAPTCHA là dừng tự gửi + ghi log cảnh báo; chủ tài khoản xử lý tay, Watcher tự chạy tiếp.

## Cài đặt

Xem [HUONG-DAN-CAI-DAT.md](HUONG-DAN-CAI-DAT.md).

## Kiến trúc data

- Bảng `messages` (Supabase): `fan_username, direction (in|out|sys), content, created_at, source, dedupe_key, meta`.
- Bảng `queue`: băng chuyền lệnh gửi (`pending → approved → sending → sent|failed|processed`).
- Bảng `app_state`: key `watcher_status` = nhịp tim + thống kê của Watcher.
- Bảng `logs`: nhật ký sự kiện Watcher (mã `WATCHER_*`).

## An toàn & trung thực

- Quyền truy cập chỉ trên `tiktok.com` và Supabase của chính chủ tài khoản.
- Anon key Supabase là key công khai phía client (giống trong tool web) — không có secret nào trong gói này.
- Watcher KHÔNG tự giải CAPTCHA, KHÔNG gửi khi chưa được bật chế độ tự gửi, nhịp thao tác có giãn cách như người thật.
- Tầng quét API là "đoán cấu trúc JSON" (quét sâu tìm trường giống tin nhắn) — kết quả thực tế được ghi log để đối chiếu và tinh chỉnh selector/parser theo log thật.

Phiên bản: 1.0.0 · Thuộc hệ Cyan Panda Tool.
