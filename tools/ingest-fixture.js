// ingest-fixture.js — kiểm chứng đường ống chuẩn hoá -> chống trùng -> Supabase bằng capture-core THẬT.
// Cách chạy: node ingest-fixture.js [--dry-run] [--source watcher-test]
// Mặc định: đọc fixture-clone-conversation.json, normalize bằng ../src/capture-core.js,
// kiểm tra dedupe_key đã có trên BE chưa, chỉ POST những dòng mới, in kết quả + lưu backup.
const fs = require('fs');
const path = require('path');
const CORE = require('../src/capture-core.js');

const SUPA_URL = 'https://zhqujumtnwejaynjfmtd.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpocXVqdW10bndlamF5bmpmbXRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3NzQ0MjMsImV4cCI6MjEwODM1MDQyM30.kDpEgq9GCVZnqLaUjn5xaWl_-3HDJzqBSCCWbAwx3Qc';
const dryRun = process.argv.includes('--dry-run');
const sourceArg = (process.argv.find(a => a.startsWith('--source=')) || '--source=watcher-test').split('=')[1];

async function supa(p, opts = {}) {
  const r = await fetch(SUPA_URL + '/rest/v1/' + p, {
    method: opts.method || 'GET',
    headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
  return { ok: r.ok, status: r.status, json: j, text: t };
}

(async () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture-clone-conversation.json'), 'utf8'));
  const rows = fixture.messages
    .map(m => CORE.normalizeMessage({ account: fixture.account, counterpartName: fixture.conversation.counterpartName, counterpartUsername: fixture.conversation.counterpartUsername, direction: m.direction, content: m.content, at: m.at, via: m.via }, sourceArg))
    .filter(Boolean);
  console.log('Fixture:', fixture.messages.length, 'tin -> normalize OK:', rows.length);
  rows.forEach(r => console.log(' -', r.direction, '|', r.created_at, '|', r.dedupe_key, '|', r.content.slice(0, 40)));

  // Chống trùng: chạy normalize 2 lần phải cho dedupe_key giống hệt
  const again = CORE.normalizeMessage({ account: fixture.account, counterpartName: fixture.conversation.counterpartName, direction: 'out', content: 'a li', at: '2024-10-29T11:52:00+07:00' }, sourceArg);
  console.log('Dedupe ổn định:', again.dedupe_key === rows[0].dedupe_key ? 'PASS' : 'FAIL');

  if (dryRun) { console.log('DRY-RUN: không ghi BE.'); return; }

  const keys = rows.map(r => r.dedupe_key);
  const q = 'messages?select=id,dedupe_key&dedupe_key=in.(' + keys.map(k => '"' + k + '"').join(',') + ')';
  const ex = await supa(q);
  if (!ex.ok) { console.log('LỖI đọc BE:', ex.status, ex.text.slice(0, 300)); process.exit(2); }
  const have = new Set((ex.json || []).map(r => r.dedupe_key));
  const fresh = rows.filter(r => !have.has(r.dedupe_key));
  console.log('Đã có trên BE:', have.size, '| Mới:', fresh.length);

  // Fan (đối tác hội thoại) — upsert theo username
  const fanUser = rows[0].fan_username;
  const fan = await supa('fans?on_conflict=username', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: { username: fanUser, display_name: fixture.conversation.counterpartName, call_as: 'anh', intimacy: 3, category: 'Chưa phân loại', notes: 'Watcher test — hội thoại của acc clone (sẽ dọn sau khi CYAN duyệt)' } });
  console.log('Upsert fan', fanUser, ':', fan.ok ? 'OK' : 'LỖI ' + fan.status + ' ' + fan.text.slice(0, 200));

  if (fresh.length) {
    const ins = await supa('messages', { method: 'POST', headers: { Prefer: 'return=representation' }, body: fresh });
    if (!ins.ok) { console.log('LỖI insert messages:', ins.status, ins.text.slice(0, 400)); process.exit(3); }
    const backup = { at: new Date().toISOString(), source: sourceArg, inserted: ins.json };
    const bf = path.join(__dirname, 'backup-ingest-' + Date.now() + '.json');
    fs.writeFileSync(bf, JSON.stringify(backup, null, 2));
    console.log('ĐÃ ĐẨY', ins.json.length, 'tin lên BE. Backup:', bf);
    ins.json.forEach(r => console.log('  BE id', r.id, '|', r.direction, '|', r.created_at, '|', r.content.slice(0, 40)));
  } else {
    console.log('Không có tin mới để đẩy (dedupe hoạt động đúng).');
  }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
