import http from 'k6/http';
import { check, sleep } from 'k6';

// Konfigurasi simulasi 1.700 siswa serentak (VU)
export const options = {
  stages: [
    { duration: '30s', target: 500 },   // Siswa mulai masuk ruang tunggu
    { duration: '30s', target: 1700 },  // 1.700 siswa online serentak di ruang tunggu
    { duration: '2m', target: 1700 },   // Mengerjakan ujian serentak & sync jawaban
    { duration: '30s', target: 0 },     // Siswa submit ujian dan logout
  ],
  thresholds: {
    // SLA Kebutuhan Sistem: p99 latensi harus di bawah 50ms (p95 < 20ms)
    http_req_duration: ['p(95)<20', 'p(99)<50'],
    http_req_failed: ['rate<0.001'], // Kegagalan di bawah 0.1%
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://127.0.0.1:8080';
const SCHEDULE_ID = 1;

export default function () {
  const studentId = 1000 + __VU;
  const username = `siswa_${studentId}`;
  
  // 1. Login Siswa
  const loginPayload = JSON.stringify({
    username: username,
    password: 'Password123',
    device_fingerprint: `device_${studentId}`,
  });

  const loginRes = http.post(`${BASE_URL}/api/v1/auth/login`, loginPayload, {
    headers: { 'Content-Type': 'application/json' },
  });

  check(loginRes, {
    'login status is 200': (r) => r.status === 200,
  });

  let token = '';
  try {
    token = loginRes.json('data.access_token');
  } catch (e) {
    return;
  }

  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };

  // 2. Pre-Fetch Info Ujian di Ruang Tunggu
  const activeRes = http.get(`${BASE_URL}/api/v1/cbt/schedules/active`, { headers: authHeaders });
  check(activeRes, {
    'get active schedule is 200': (r) => r.status === 200,
  });

  // Jeda acak 1-3 detik sebelum ujian dimulai
  sleep(Math.random() * 2 + 1);

  // 3. Mulai Ujian (Start Exam) & Ambil Kunci Dekripsi Hex (< 1 KB)
  const startRes = http.post(
    `${BASE_URL}/api/v1/cbt/schedules/${SCHEDULE_ID}/start`,
    JSON.stringify({ token_code: 'TOKEN123' }),
    { headers: authHeaders }
  );

  check(startRes, {
    'start exam status is 200': (r) => r.status === 200,
    'has decryption key': (r) => r.json('data.decryption_key_hex') !== undefined,
  });

  let sessionId = 0;
  try {
    sessionId = startRes.json('data.session_id');
  } catch (e) {}

  // 4. Simulasi Menjawab Soal & Sinkronisasi Berkala (Jitter 15-30s)
  for (let i = 0; i < 3; i++) {
    // Siswa membaca dan menjawab soal selama 10-20 detik
    sleep(Math.random() * 10 + 10);

    const qNum = Math.floor(Math.random() * 50) + 1;
    const chosenAns = ['A', 'B', 'C', 'D', 'E'][Math.floor(Math.random() * 5)];

    const syncPayload = JSON.stringify({
      session_id: sessionId,
      answers: {
        [qNum]: {
          a: chosenAns,
          d: 0,
          ts: Math.floor(Date.now() / 1000),
        },
      },
      violation_delta: 0,
    });

    const syncRes = http.post(
      `${BASE_URL}/api/v1/cbt/schedules/${SCHEDULE_ID}/sync`,
      syncPayload,
      { headers: authHeaders }
    );

    check(syncRes, {
      'sync answers is 200': (r) => r.status === 200,
      'sync ack is true': (r) => r.json('ack') === true,
    });
  }

  // 5. Submit Akhir Ujian (Finish Exam)
  const finishRes = http.post(
    `${BASE_URL}/api/v1/cbt/schedules/${SCHEDULE_ID}/finish`,
    JSON.stringify({ session_id: sessionId, answers: {} }),
    { headers: authHeaders }
  );

  check(finishRes, {
    'finish exam is 200': (r) => r.status === 200,
  });
}
