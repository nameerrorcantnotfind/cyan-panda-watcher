# Hướng dẫn cài Cyan Panda Watcher (bản unpacked)

## Bước 1 — Tải gói extension
Tải thư mục `watcher-extension` (hoặc giải nén file .zip) về máy, để nguyên cấu trúc:
```
watcher-extension/
  manifest.json
  src/ (config.js, capture-core.js, hook.js, content.js, popup.html, popup.js)
```

## Bước 2 — Cài vào Chrome / Cốc Cốc
1. Mở `chrome://extensions` (Cốc Cốc: `coccoc://extensions`).
2. Bật **Chế độ nhà phát triển (Developer mode)** ở góc phải trên.
3. Bấm **Tải tiện ích đã giải nén (Load unpacked)** → chọn thư mục `watcher-extension`.
4. Ghim 📌 "Cyan Panda Watcher" lên thanh công cụ.

## Bước 3 — Chạy
1. Mở tab `tiktok.com`, đăng nhập tài khoản của bạn, vào mục **Tin nhắn**.
2. Bấm icon Watcher: thấy "Watcher đang chạy" là xong. Data mới sẽ tự chảy vào Supabase → mở Cyan Panda Tool, tab Inbox sẽ thấy tin (bộ lọc "Gần nhất").
3. (Tuỳ chọn) Điền `@username` của bạn trong popup để gắn nhãn tài khoản chính xác.

## Để Watcher canh được lâu (chế độ treo)
- **Đừng để máy ngủ**: Windows → Settings → Power → Screen and sleep: khi cắm điện chọn *Never* cho Sleep.
- **Giữ tab TikTok "luôn hoạt động"**: Chrome → Settings → Performance → *Always keep these sites active* → thêm `tiktok.com` (tránh bị đóng băng tab vì tiết kiệm bộ nhớ).
- **Để tab TikTok mở** và còn đăng nhập. Gặp CAPTCHA: bạn qua xử lý tay ~5 giây, Watcher tự chạy tiếp.

## Bật tự rep (cẩn thận)
Trong popup, bật "Chế độ treo: tự rep…" — chỉ khi bật, Watcher mới thực thi các lệnh đã duyệt trong hàng đợi của tool. Tin nhạy cảm nên để chờ duyệt trong tool như thường lệ.

## Gỡ / tắt nhanh
Vào `chrome://extensions` → tắt công tắc của Cyan Panda Watcher. Data đã đẩy lên Supabase không bị ảnh hưởng.
