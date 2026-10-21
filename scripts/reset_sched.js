const http = require('http');
const req = http.request({
  hostname: 'localhost',
  port: 8080,
  path: '/api/v1/cbt/schedules/1/update',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
}, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => console.log('Reset Default:', res.statusCode, JSON.parse(d).message));
});
req.write(JSON.stringify({
  title: 'UAS Fisika Peminatan XII',
  bank_name: 'Bank Termodinamika (5 Soal)',
  duration_minutes: 90,
  token_code: 'FISIKA26',
  start_time: 'Hari ini, 07:30 WIB'
}));
req.end();
