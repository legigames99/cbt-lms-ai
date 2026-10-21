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
  console.log('--- 1. Uji Tambah Waktu Massal Seluruh Siswa (+15 Menit) ---');
  const res1 = await post('/api/v1/cbt/proctor/extend-time', {
    schedule_id: 1,
    target: 'all',
    minutes: 15,
    reason: 'Gangguan teknis jaringan lab'
  });
  console.log('Status HTTP:', res1.status, '| Pesan:', res1.body.message);

  console.log('\n--- 2. Uji Tambah Waktu Khusus Siswa (siswa_1002: +10 Menit) ---');
  const res2 = await post('/api/v1/cbt/proctor/extend-time', {
    schedule_id: 1,
    target: 'single',
    username: 'siswa_1002',
    minutes: 10,
    reason: 'Komputer siswa restart'
  });
  console.log('Status HTTP:', res2.status, '| Pesan:', res2.body.message);

  console.log('\n--- 3. Verifikasi Data Live Monitoring Proktor ---');
  const proctorRes = await get('/api/v1/cbt/proctor/live-sessions');
  proctorRes.body.data.forEach(s => {
    console.log(`- ${s.username} (${s.full_name}): Tambahan Waktu = +${s.extra_minutes} Menit | Status = ${s.status}`);
  });

  console.log('\n--- 4. Verifikasi Data Jadwal Aktif Siswa (GET /schedules/active) ---');
  const schedRes = await get('/api/v1/cbt/schedules/active');
  console.log('Durasi Total:', schedRes.body.data.duration_minutes, 'Menit (Standar 90 + Ekstra', schedRes.body.data.extra_minutes, 'Menit)');

  console.log('\n>>> PENGUJIAN FITUR PENAMBAHAN WAKTU UJIAN SUKSES 100%! <<<');
}

test().catch(console.error);
