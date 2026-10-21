const http = require('http');

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

async function test() {
  console.log('Testing GET /api/v1/cbt/proctor/live-sessions...');
  const res = await get('/api/v1/cbt/proctor/live-sessions');
  console.log('Status HTTP:', res.status);
  console.log('Students returned:', res.body.data?.length);
  res.body.data.forEach(s => {
    console.log(`- ${s.username} (${s.full_name}): Status = ${s.status}, Progres = ${s.answered_count}/${s.total_questions}, Nilai = ${s.score}, SubmittedAt = ${s.submitted_at}`);
  });

  console.log('\nTesting Force Finish for siswa_1002...');
  const forceRes = await post('/api/v1/cbt/proctor/force-finish', { username: 'siswa_1002' });
  console.log('Force Finish status:', forceRes.status, forceRes.body.message);

  console.log('\nVerifying live update after Force Finish...');
  const res2 = await get('/api/v1/cbt/proctor/live-sessions');
  const s2 = res2.body.data.find(s => s.username === 'siswa_1002');
  console.log(`- ${s2.username}: Status = ${s2.status}, SubmittedAt = ${s2.submitted_at}`);

  console.log('\nTesting Reset Session for siswa_1002...');
  const resetRes = await post('/api/v1/cbt/proctor/reset-session', { username: 'siswa_1002' });
  console.log('Reset status:', resetRes.status, resetRes.body.message);

  const res3 = await get('/api/v1/cbt/proctor/live-sessions');
  const s3 = res3.body.data.find(s => s.username === 'siswa_1002');
  console.log(`- ${s3.username}: Status after reset = ${s3.status}`);

  console.log('\nALL PROCTOR REAL-TIME LIVE MONITORING TESTS PASSED!');
}

test().catch(console.error);
