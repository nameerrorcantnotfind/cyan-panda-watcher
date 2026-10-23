// Cyan Panda Watcher — cấu hình mặc định (đều là thông tin CÔNG KHAI, giống trong tool web)
// Anon key của Supabase là key công khai phía client, đã nhúng sẵn trong Cyan Panda Tool.
window.PANDA_WATCHER_DEFAULTS = {
  supaUrl: 'https://zhqujumtnwejaynjfmtd.supabase.co',
  supaKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpocXVqdW10bndlamF5bmpmbXRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3NzQ0MjMsImV4cCI6MjEwODM1MDQyM30.kDpEgq9GCVZnqLaUjn5xaWl_-3HDJzqBSCCWbAwx3Qc',
  captureEnabled: true,   // quét data từ TikTok web -> Supabase
  autoSendEnabled: false, // chế độ treo tự rep — MẶC ĐỊNH TẮT, chủ tài khoản tự bật trong popup
  account: '',            // @username TikTok của tab này (điền trong popup; để trống thì tự đoán từ trang)
  heartbeatSec: 60,
  queuePollSec: 8,
  domScanSec: 20,
  source: 'watcher'
};
