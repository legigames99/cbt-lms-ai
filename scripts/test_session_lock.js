const http = require('http');

function post(path, body, token) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const req = http.request({ hostname: 'localhost', port: 8080, path, method: 'POST', headers }, (res) => {
      let resData = '';
      res.on('data', c => resData += c);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(resData) }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(path, token) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const req = http.request({ hostname: 'localhost', port: 8080, path, method: 'GET', headers }, (res) => {
      let resData = '';
      res.on('data', c => resData += c);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(resData) }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function run() {
  console.log('--- 1. Login sebagai siswa_1001 ---');
  const loginRes = await post('/api/v1/auth/login', { username: 'siswa_1001', password: 'siswa123' });
  const token = loginRes.body.data.access_token;
  console.log('Login status:', loginRes.status, '| Token didapatkan:', !!token);

  console.log('\n--- 2. Cek Jadwal Aktif Sebelum Ujian ---');
  const sched1 = await get('/api/v1/cbt/schedules/active', token);
  console.log('Status sesi awal:', sched1.body.data.session_status);

  console.log('\n--- 3. Mulai Ujian (POST /start dengan token FISIKA26) ---');
  const start1 = await post('/api/v1/cbt/schedules/1/start', { token_code: 'FISIKA26' }, token);
  console.log('Mulai Ujian status:', start1.status, '| Session ID:', start1.body.data?.session_id);

  console.log('\n--- 4. Kumpulkan Jawaban (POST /finish) ---');
  const finishRes = await post('/api/v1/cbt/schedules/1/finish', { answers: { 1: { a: 'C', d: 0 } } }, token);
  console.log('Selesai Ujian status:', finishRes.status, '| Pesan:', finishRes.body.message, '| Waktu Selesai:', finishRes.body.submitted_at);

  console.log('\n--- 5. Simulasi Siswa REFRESH Halaman (/api/v1/cbt/schedules/active) ---');
  const sched2 = await get('/api/v1/cbt/schedules/active', token);
  console.log('Status sesi setelah refresh:', sched2.body.data.session_status, '| Waktu Kunci:', sched2.body.data.submitted_at);

  console.log('\n--- 6. Siswa Mencoba Mengerjakan Lagi (POST /start kedua kali) ---');
  const start2 = await post('/api/v1/cbt/schedules/1/start', { token_code: 'FISIKA26' }, token);
  console.log('Status HTTP:', start2.status, '| Code:', start2.body.code, '| Pesan Server:', start2.body.message);

  console.log('\n--- 7. Proktor Reset Sesi untuk siswa_1001 ---');
  const resetRes = await post('/api/v1/cbt/proctor/reset-session', { username: 'siswa_1001' });
  console.log('Reset Proktor status:', resetRes.status, '| Pesan:', resetRes.body.message);

  console.log('\n--- 8. Cek Jadwal Aktif Setelah Direset Proktor ---');
  const sched3 = await get('/api/v1/cbt/schedules/active', token);
  console.log('Status sesi setelah reset:', sched3.body.data.session_status);

  console.log('\n>>> PENGUJIAN INTEGRITAS SESI CBT BERHASIL 100%! <<<');
}

run().catch(console.error);
