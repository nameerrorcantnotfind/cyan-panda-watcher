// Cyan Panda Watcher — cấu hình mặc định (đều là thông tin CÔNG KHAI, giống trong tool web)
// Anon key của Supabase là key công khai phía client, đã nhúng sẵn trong Cyan Panda Tool.
window.PANDA_WATCHER_DEFAULTS = {
  supaUrl: 'https://zhqujumtnwejaynjfmtd.supabase.co',
  supaKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpocXVqdW10bndlamF5bmpmbXRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3NzQ0MjMsImV4cCI6MjEwODM1MDQyM30.kDpEgq9GCVZnqLaUjn5xaWl_-3HDJzqBSCCWbAwx3Qc',
  captureEnabled: true,   // quét data từ TikTok web -> Supabase
  autoSendEnabled: false, // chế độ treo tự rep — MẶC ĐỊNH TẮT, chủ tài khoản tự bật trong popup
  account: '',            // @username TikTok của tab này (điền trong popup; để trống thì tự đoán từ trang)
  accountId: '',          // v1.0.1: open_id của acc TikTok (copy từ tool web, tab Kết Nối) — data Watcher đẩy lên BE sẽ gắn account_id này; hàng đợi cũng chỉ lấy lệnh của acc này (để trống = chỉ lấy lệnh cũ chưa gắn acc)
  heartbeatSec: 60,
  queuePollSec: 8,
  openPollSec: 10,   // v1.1: moi 10s kiem tra lenh mo hoi thoai tu tool web (app_state watcher_open)
  domScanSec: 20,
  source: 'watcher'
};
