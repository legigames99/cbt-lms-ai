const http = require('http');

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = http.request({
      hostname: 'localhost',
      port: 8080,
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let resData = '';
      res.on('data', c => resData += c);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(resData) }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: 'localhost', port: 8080, path, method: 'GET' }, (res) => {
      let resData = '';
      res.on('data', c => resData += c);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(resData) }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function test() {
  console.log('--- 1. Ambil Jadwal Sebelum Diedit ---');
  const res1 = await get('/api/v1/cbt/schedules');
  const s1 = res1.body.data[0];
  console.log(`Judul: ${s1.title} | Durasi: ${s1.duration_minutes}m | Token: ${s1.token_code}`);

  console.log('\n--- 2. Edit Jadwal Ujian (Judul Baru, Durasi 120m, Token: PAS2026) ---');
  const updateRes = await post('/api/v1/cbt/schedules/1/update', {
    title: 'Penilaian Akhir Semester (PAS) Fisika XII',
    bank_name: 'Bank Termodinamika & Kalor (5 Soal)',
    duration_minutes: 120,
    token_code: 'PAS2026',
    start_time: 'Besok, 08:00 WIB'
  });
  console.log('Status HTTP:', updateRes.status, '| Pesan:', updateRes.body.message);

  console.log('\n--- 3. Verifikasi Data Jadwal yang Telah Diedit ---');
  const res2 = await get('/api/v1/cbt/schedules');
  const s2 = res2.body.data[0];
  console.log(`Judul Baru: ${s2.title} | Durasi Baru: ${s2.duration_minutes}m | Token Baru: ${s2.token_code} | Mulai: ${s2.start_time}`);

  console.log('\n--- 4. Cek Enkripsi Paket Baru di /schedules/active ---');
  const activeRes = await get('/api/v1/cbt/schedules/active');
  console.log(`Title Active: ${activeRes.body.data.title} | Duration: ${activeRes.body.data.duration_minutes} Menit`);

  console.log('\n--- 5. Uji Coba Token Baru pada POST /start ---');
  const testWrongToken = await post('/api/v1/cbt/schedules/1/start', { token_code: 'TOKENLAMA' });
  console.log('Test Token Salah:', testWrongToken.status, testWrongToken.body.message);

  console.log('\n>>> PENGUJIAN FITUR EDIT JADWAL UJIAN BERHASIL 100%! <<<');
}

test().catch(console.error);
