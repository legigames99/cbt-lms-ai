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

async function test() {
  const loginRes = await post('/api/v1/auth/login', { username: 'siswa_1003', password: 'siswa123' });
  const t = loginRes.body.data.access_token;

  console.log('Test token salah dengan akun siswa_1003:');
  const wrongRes = await post('/api/v1/cbt/schedules/1/start', { token_code: 'SALAH123' }, t);
  console.log('Status salah:', wrongRes.status, wrongRes.body.message);

  console.log('Test token benar PAS2026:');
  const rightRes = await post('/api/v1/cbt/schedules/1/start', { token_code: 'PAS2026' }, t);
  console.log('Status benar:', rightRes.status, 'Session ID:', rightRes.body.data?.session_id);
}

test();
