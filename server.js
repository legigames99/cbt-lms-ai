/**
 * CBT & LMS AI - Local Development Server (Node.js Native Engine)
 * Berjalan langsung di atas Node.js v24 bawaan tanpa perlu npm install.
 * Melayani seluruh API endpoint CBT, Auth, AI SSE, dan Web Frontend.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const STATIC_PKG_DIR = path.join(__dirname, 'static', 'packages');
const STATIC_UPLOADS_DIR = path.join(__dirname, 'static', 'uploads');
const WEB_DIR = path.join(__dirname, 'web');

if (!fs.existsSync(STATIC_PKG_DIR)) {
  fs.mkdirSync(STATIC_PKG_DIR, { recursive: true });
}
if (!fs.existsSync(STATIC_UPLOADS_DIR)) {
  fs.mkdirSync(STATIC_UPLOADS_DIR, { recursive: true });
}

// In-Memory Database & State
let lockdownMode = false;
let activeExamStudents = new Set();
let dirtySessionCount = 0;

// Master Users (Bcrypt hash mock: password123 / siswa123 / guru123 / admin123)
const USERS = [
  { id: 1, username: 'admin', pass: 'admin123', full_name: 'Administrator Sekolah', role: 'admin' },
  { id: 2, username: 'guru', pass: 'guru123', full_name: 'Drs. Budi Pratama, M.Pd.', role: 'teacher' },
  { id: 3, username: 'proktor', pass: 'proktor123', full_name: 'Proktor Lab 1', role: 'proctor' },
  {
    id: 1001,
    username: 'siswa_1001',
    pass: 'siswa123',
    full_name: 'Ahmad Rizki Pratama',
    role: 'student',
    class_name: 'XII IPA 1',
    nisn: '0078123451',
    nis: '23241001',
    exam_no: '26-01-05-1001',
    birth_place_date: 'Jakarta, 12 Mei 2008',
    gender: 'Laki-laki',
    room: 'Ruang Lab Komputer 01',
    session: 'Sesi 1 (07:30 - 09:30)',
    server: 'SRV-01',
  },
  {
    id: 1002,
    username: 'siswa_1002',
    pass: 'siswa123',
    full_name: 'Siti Nur Aisyah',
    role: 'student',
    class_name: 'XII IPA 1',
    nisn: '0078123452',
    nis: '23241002',
    exam_no: '26-01-05-1002',
    birth_place_date: 'Jakarta, 18 Agustus 2008',
    gender: 'Perempuan',
    room: 'Ruang Lab Komputer 01',
    session: 'Sesi 1 (07:30 - 09:30)',
    server: 'SRV-01',
  },
  {
    id: 1003,
    username: 'siswa_1003',
    pass: 'siswa123',
    full_name: 'Budi Santoso',
    role: 'student',
    class_name: 'XII IPA 1',
    nisn: '0078123453',
    nis: '23241003',
    exam_no: '26-01-05-1003',
    birth_place_date: 'Bandung, 03 Januari 2008',
    gender: 'Laki-laki',
    room: 'Ruang Lab Komputer 01',
    session: 'Sesi 1 (07:30 - 09:30)',
    server: 'SRV-01',
  },
  {
    id: 1004,
    username: 'siswa_1004',
    pass: 'siswa123',
    full_name: 'Dewi Lestari Putri',
    role: 'student',
    class_name: 'XII IPA 2',
    nisn: '0078123454',
    nis: '23241004',
    exam_no: '26-01-05-1004',
    birth_place_date: 'Jakarta, 25 Juli 2008',
    gender: 'Perempuan',
    room: 'Ruang Lab Komputer 02',
    session: 'Sesi 2 (10:00 - 12:00)',
    server: 'SRV-02',
  },
  {
    id: 1005,
    username: 'siswa_1005',
    pass: 'siswa123',
    full_name: 'Muhammad Fadlan Ramadhan',
    role: 'student',
    class_name: 'XII IPA 2',
    nisn: '0078123455',
    nis: '23241005',
    exam_no: '26-01-05-1005',
    birth_place_date: 'Depok, 14 September 2008',
    gender: 'Laki-laki',
    room: 'Ruang Lab Komputer 02',
    session: 'Sesi 2 (10:00 - 12:00)',
    server: 'SRV-02',
  },
  {
    id: 1006,
    username: 'siswa_1006',
    pass: 'siswa123',
    full_name: 'Zahra Amelia Safitri',
    role: 'student',
    class_name: 'XII IPA 2',
    nisn: '0078123456',
    nis: '23241006',
    exam_no: '26-01-05-1006',
    birth_place_date: 'Bekasi, 09 November 2008',
    gender: 'Perempuan',
    room: 'Ruang Lab Komputer 02',
    session: 'Sesi 2 (10:00 - 12:00)',
    server: 'SRV-02',
  },
];

// Profile & Konfigurasi Sekolah (Settings & Kop Kartu Peserta)
const SCHOOL_PROFILE_PATH = path.join(__dirname, 'school_profile.json');
const DEFAULT_SCHOOL_PROFILE = {
  name: 'SMK NEGERI 5 JAKARTA',
  npsn: '20102551',
  level: 'SMK',
  status: 'Negeri',
  dinas: 'PEMERINTAH PROVINSI DAERAH KHUSUS IBUKOTA JAKARTA\nDINAS PENDIDIKAN',
  address: 'Jl. Pisangan Baru Timur VII No. 6',
  village: 'Pisangan Baru',
  district: 'Matraman',
  city: 'Kota Jakarta Timur',
  province: 'DKI Jakarta',
  postal_code: '13110',
  phone: '(021) 8564230',
  email: 'info@smkn5jakarta.sch.id',
  website: 'https://smkn5jakarta.sch.id',
  headmaster_name: 'Drs. H. Ahmad Fauzi, M.Pd.',
  headmaster_nip: '19710815 199802 1 003',
  exam_title_1: 'KARTU PESERTA UJIAN',
  exam_title_2: 'ASESMEN SUMATIF AKHIR SEMESTER (ASAS)',
  academic_year: '2026/2027',
  semester: 'Ganjil',
  signature_place: 'Jakarta',
  signature_date: '21 Oktober 2026',
  logo_url: '',
  exam_rules: '1. Membawa Kartu Peserta Ujian ini selama berlangsungnya tes.\n2. Hadir di ruang ujian 15 menit sebelum ujian dimulai.\n3. Dilarang membawa HP, alat komunikasi atau catatan ke dalam ruang ujian.\n4. Mentaati tata tertib dan petunjuk dari pengawas ujian.',
  show_student_photo: true,
  show_signatures: true,
  show_exam_rules: true
};

let schoolProfile = { ...DEFAULT_SCHOOL_PROFILE };
if (fs.existsSync(SCHOOL_PROFILE_PATH)) {
  try {
    const raw = fs.readFileSync(SCHOOL_PROFILE_PATH, 'utf8');
    schoolProfile = { ...schoolProfile, ...JSON.parse(raw) };
  } catch (err) {
    console.error('[Pengaturan] Gagal membaca school_profile.json, menggunakan default:', err.message);
  }
} else {
  try {
    fs.writeFileSync(SCHOOL_PROFILE_PATH, JSON.stringify(schoolProfile, null, 2), 'utf8');
  } catch (err) {}
}

// Master Questions (Fisika)
const QUESTIONS = [
  {
    id: 1,
    type: 'mcq',
    cog: 'C2',
    stem: '<p>Prinsip utama yang mendasari Hukum Pertama Termodinamika adalah...</p>',
    options: [
      { id: 'A', text: 'Kekekalan momentum' },
      { id: 'B', text: 'Kekekalan massa' },
      { id: 'C', text: 'Kekekalan energi' },
      { id: 'D', text: 'Entropi selalu bertambah' },
      { id: 'E', text: 'Suhu nol mutlak' },
    ],
    weight: 1.0,
  },
  {
    id: 2,
    type: 'mcq',
    cog: 'C3',
    stem: '<p>Suatu gas menyerap kalor sebesar 800 J dan melakukan usaha sebesar 300 J. Berapakah perubahan energi dalam gas tersebut?</p>',
    options: [
      { id: 'A', text: '1.100 Joule' },
      { id: 'B', text: '500 Joule' },
      { id: 'C', text: '-500 Joule' },
      { id: 'D', text: '240 Joule' },
      { id: 'E', text: '300 Joule' },
    ],
    weight: 1.0,
  },
  {
    id: 3,
    type: 'mcq',
    cog: 'C2',
    stem: '<p>Proses termodinamika yang berlangsung pada volume tetap disebut proses...</p>',
    options: [
      { id: 'A', text: 'Isotermik' },
      { id: 'B', text: 'Isobarik' },
      { id: 'C', text: 'Isokhorik' },
      { id: 'D', text: 'Adiabatik' },
      { id: 'E', text: 'Politropik' },
    ],
    weight: 1.0,
  },
  {
    id: 4,
    type: 'mcq',
    cog: 'C4',
    stem: '<p>Pada proses adiabatik, tidak terjadi perpindahan kalor (Q = 0). Jika gas melakukan usaha W > 0, apa yang terjadi pada energi dalam sistem?</p>',
    options: [
      { id: 'A', text: 'Energi dalam sistem bertambah' },
      { id: 'B', text: 'Energi dalam sistem berkurang' },
      { id: 'C', text: 'Suhu sistem selalu naik' },
      { id: 'D', text: 'Tekanan gas tetap konstan' },
      { id: 'E', text: 'Tidak terjadi perubahan suhu' },
    ],
    weight: 1.0,
  },
  {
    id: 5,
    type: 'mcq',
    cog: 'C3',
    stem: '<p>Efisiensi maksimum mesin Carnot yang bekerja antara reservoir suhu tinggi 600 K dan reservoir suhu rendah 300 K adalah...</p>',
    options: [
      { id: 'A', text: '25%' },
      { id: 'B', text: '33%' },
      { id: 'C', text: '50%' },
      { id: 'D', text: '60%' },
      { id: 'E', text: '75%' },
    ],
    weight: 1.0,
  },
];

// Jadwal Ujian Aktif & Paket AES-256-GCM
let currentAESKeyHex = '';
let currentPackageSHA256 = '';

let activeSchedule = {
  id: 1,
  title: 'UAS Fisika Peminatan XII',
  bank_name: 'Bank Termodinamika (5 Soal)',
  start_time: 'Hari ini, 07:30 WIB',
  duration_minutes: 90,
  token_code: 'FISIKA26',
  shuffle_questions: true,
  shuffle_options: true,
};

function compileAndEncryptPackage() {
  const key = crypto.randomBytes(32);
  const nonce = crypto.randomBytes(12);

  const payload = JSON.stringify({
    schedule_id: activeSchedule.id,
    title: activeSchedule.title,
    duration_minutes: activeSchedule.duration_minutes,
    shuffle_questions: activeSchedule.shuffle_questions,
    shuffle_options: activeSchedule.shuffle_options,
    questions: QUESTIONS,
  });

  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  let encrypted = cipher.update(payload, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');

  // Format GCM: ciphertext + auth_tag
  const fullCipherHex = encrypted + tag;

  const pkgObj = {
    schedule_id: activeSchedule.id,
    title: activeSchedule.title,
    nonce: nonce.toString('hex'),
    ciphertext: fullCipherHex,
  };

  const fileData = JSON.stringify(pkgObj);
  const targetPath = path.join(STATIC_PKG_DIR, 'exam_1_enc.json');
  fs.writeFileSync(targetPath, fileData);

  currentAESKeyHex = key.toString('hex');
  currentPackageSHA256 = crypto.createHash('sha256').update(fileData).digest('hex');

  console.log('[CBT Packager] Paket soal berhasil dienkripsi AES-256-GCM');
  console.log('   File     :', targetPath);
  console.log('   AES Key  :', currentAESKeyHex);
  console.log('   SHA256   :', currentPackageSHA256);
}

compileAndEncryptPackage();

// In-Memory Session & Answer Store
const studentAnswersStore = {
  1001: { 1: { a: 'C', d: 0 }, 2: { a: 'B', d: 0 }, 3: { a: 'C', d: 0 }, 4: { a: 'B', d: 0 }, 5: { a: 'C', d: 0 } },
  1002: { 1: { a: 'A', d: 1 }, 2: { a: 'B', d: 0 }, 3: { a: 'C', d: 0 } },
  1003: {},
};

const studentSessions = {
  '1_1001': {
    status: 'submitted',
    started_at: '21 Okt 2026 10.30.00 WIB',
    submitted_at: '21 Okt 2026 11.42.15 WIB',
    tab_violations: 0,
    ip_address: '192.168.1.102',
    answers: studentAnswersStore[1001],
  },
  '1_1002': {
    status: 'in_progress',
    started_at: '21 Okt 2026 10.35.00 WIB',
    submitted_at: null,
    tab_violations: 2,
    ip_address: '192.168.1.105',
    answers: studentAnswersStore[1002],
  },
  '1_1003': {
    status: 'not_started',
    started_at: null,
    submitted_at: null,
    tab_violations: 0,
    ip_address: '192.168.1.108',
    answers: {},
  },
};

// Penambahan Waktu Ujian (Dispensasi Proktor)
let scheduleExtraMinutes = 0;
const studentExtraMinutes = {}; // { [studentId]: extraMinutes }

// Helper Extract User from Bearer Token
function getUserFromToken(req) {
  try {
    const auth = req.headers.authorization || '';
    if (auth.startsWith('Bearer ')) {
      const b64 = auth.slice(7);
      const json = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
      return json; // { uid, usr, rol }
    }
  } catch (e) {}
  return null;
}

// Helper Parse JSON Body
function parseBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        resolve({});
      }
    });
  });
}

// Server HTTP
const server = http.createServer(async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, Content-Type, Accept, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  const sendJSON = (statusCode, obj) => {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  // 1. Static Files Serving
  if (pathname === '/' || pathname === '/login') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(path.join(WEB_DIR, 'index.html')).pipe(res);
  }
  if (pathname === '/dashboard' || pathname === '/admin' || pathname === '/teacher') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(path.join(WEB_DIR, 'dashboard.html')).pipe(res);
  }
  if (pathname === '/exam') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(path.join(WEB_DIR, 'student.html')).pipe(res);
  }
  if (pathname.startsWith('/static/packages/')) {
    const filename = path.basename(pathname);
    const filePath = path.join(STATIC_PKG_DIR, filename);
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return fs.createReadStream(filePath).pipe(res);
    }
  }
  if (pathname.startsWith('/static/uploads/')) {
    const filename = path.basename(pathname);
    const filePath = path.join(STATIC_UPLOADS_DIR, filename);
    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.webp': 'image/webp'
      };
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      return fs.createReadStream(filePath).pipe(res);
    }
  }
  if (pathname.endsWith('.js')) {
    const filePath = path.join(WEB_DIR, path.basename(pathname));
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      return fs.createReadStream(filePath).pipe(res);
    }
  }

  // 2. API Routes
  // GET /api/v1/health
  if (pathname === '/api/v1/health' && req.method === 'GET') {
    return sendJSON(200, { status: 'ok', time: Math.floor(Date.now() / 1000) });
  }

  // GET /api/v1/school/profile (Identitas Sekolah & Pengaturan Kartu)
  if (pathname === '/api/v1/school/profile' && req.method === 'GET') {
    return sendJSON(200, {
      status: 'success',
      data: schoolProfile,
    });
  }

  // POST /api/v1/school/profile/update (Simpan Identitas & Kop Sekolah)
  if (pathname === '/api/v1/school/profile/update' && req.method === 'POST') {
    const body = await parseBody(req);
    const updatableKeys = [
      'name', 'npsn', 'level', 'status', 'dinas', 'address', 'village',
      'district', 'city', 'province', 'postal_code', 'phone', 'email',
      'website', 'headmaster_name', 'headmaster_nip', 'exam_title_1',
      'exam_title_2', 'academic_year', 'semester', 'signature_place',
      'signature_date', 'logo_url', 'exam_rules',
      'show_student_photo', 'show_signatures', 'show_exam_rules'
    ];
    for (const k of updatableKeys) {
      if (body[k] !== undefined) {
        schoolProfile[k] = typeof body[k] === 'string' ? body[k].trim() : body[k];
      }
    }
    try {
      fs.writeFileSync(SCHOOL_PROFILE_PATH, JSON.stringify(schoolProfile, null, 2), 'utf8');
    } catch (e) {
      console.error('[Pengaturan] Gagal menulis school_profile.json:', e.message);
    }
    return sendJSON(200, {
      status: 'success',
      message: 'Pengaturan identitas sekolah dan kartu peserta ujian berhasil disimpan!',
      data: schoolProfile,
    });
  }

  // POST /api/v1/school/upload-logo (Unggah Berkas Gambar Logo Sekolah)
  if (pathname === '/api/v1/school/upload-logo' && req.method === 'POST') {
    const body = await parseBody(req);
    if (!body.image_data) {
      return sendJSON(400, { status: 'error', message: 'Data gambar logo tidak ditemukan.' });
    }

    try {
      const match = body.image_data.match(/^data:image\/([a-zA-Z0-9\+\-]+);base64,(.+)$/);
      let ext = 'png';
      let buffer;
      if (match) {
        ext = match[1].replace('svg+xml', 'svg').replace('jpeg', 'jpg');
        buffer = Buffer.from(match[2], 'base64');
      } else {
        buffer = Buffer.from(body.image_data, 'base64');
      }

      if (!fs.existsSync(STATIC_UPLOADS_DIR)) {
        fs.mkdirSync(STATIC_UPLOADS_DIR, { recursive: true });
      }

      const safeExt = ['png', 'jpg', 'jpeg', 'svg', 'webp', 'gif'].includes(ext) ? ext : 'png';
      const filename = `logo_sekolah_${Date.now()}.${safeExt}`;
      const filePath = path.join(STATIC_UPLOADS_DIR, filename);
      fs.writeFileSync(filePath, buffer);

      const fileUrl = `/static/uploads/${filename}`;
      schoolProfile.logo_url = fileUrl;

      try {
        fs.writeFileSync(SCHOOL_PROFILE_PATH, JSON.stringify(schoolProfile, null, 2), 'utf8');
      } catch (e) {
        console.error('[Pengaturan] Gagal menulis school_profile.json:', e.message);
      }

      return sendJSON(200, {
        status: 'success',
        message: 'Logo sekolah berhasil diunggah dan disimpan!',
        logo_url: fileUrl,
        filename: filename
      });
    } catch (err) {
      return sendJSON(500, { status: 'error', message: 'Gagal memproses unggahan logo: ' + err.message });
    }
  }

  // GET /api/v1/master/students (Daftar Siswa untuk Master Data & Cetak Kartu)
  if (pathname === '/api/v1/master/students' && req.method === 'GET') {
    const classFilter = parsedUrl.searchParams.get('class');
    const sessionFilter = parsedUrl.searchParams.get('session');
    let students = USERS.filter((u) => u.role === 'student');
    if (classFilter && classFilter !== 'all') {
      students = students.filter((u) => u.class_name === classFilter);
    }
    if (sessionFilter && sessionFilter !== 'all') {
      students = students.filter((u) => (u.session || '').includes(sessionFilter));
    }
    const allClasses = Array.from(new Set(USERS.filter(u => u.role === 'student').map(u => u.class_name)));
    const allSessions = Array.from(new Set(USERS.filter(u => u.role === 'student').map(u => u.session).filter(Boolean)));
    return sendJSON(200, {
      status: 'success',
      data: students,
      total: students.length,
      classes: allClasses,
      sessions: allSessions,
      school_profile: schoolProfile,
    });
  }

  // POST /api/v1/master/students/add
  if (pathname === '/api/v1/master/students/add' && req.method === 'POST') {
    const body = await parseBody(req);
    if (!body.full_name || !body.username) {
      return sendJSON(400, { status: 'error', message: 'Nama lengkap dan username siswa wajib diisi!' });
    }
    const nextId = Math.max(...USERS.map(u => u.id), 1000) + 1;
    const newStudent = {
      id: nextId,
      username: body.username.trim(),
      pass: body.password || 'siswa123',
      full_name: body.full_name.trim(),
      role: 'student',
      class_name: body.class_name || 'XII IPA 1',
      nisn: body.nisn || `007812${nextId}`,
      nis: body.nis || `2324${nextId}`,
      exam_no: body.exam_no || `26-01-05-${nextId}`,
      birth_place_date: body.birth_place_date || 'Jakarta, 01 Januari 2008',
      gender: body.gender || 'Laki-laki',
      room: body.room || 'Ruang Lab Komputer 01',
      session: body.session || 'Sesi 1 (07:30 - 09:30)',
      server: body.server || 'SRV-01',
    };
    USERS.push(newStudent);
    return sendJSON(200, {
      status: 'success',
      message: `Siswa baru ${newStudent.full_name} berhasil ditambahkan!`,
      data: newStudent,
    });
  }

  // POST /api/v1/master/students/:id/delete atau DELETE
  if ((pathname.endsWith('/delete') || req.method === 'DELETE') && pathname.includes('/api/v1/master/students/')) {
    const parts = pathname.split('/');
    const studentId = parseInt(parts[parts.length - (pathname.endsWith('/delete') ? 2 : 1)], 10);
    const idx = USERS.findIndex(u => u.id === studentId);
    if (idx !== -1) {
      const removed = USERS.splice(idx, 1)[0];
      return sendJSON(200, {
        status: 'success',
        message: `Siswa ${removed.full_name} (${removed.username}) berhasil dihapus!`,
      });
    }
    return sendJSON(404, { status: 'error', message: 'Siswa tidak ditemukan' });
  }

  // POST /api/v1/auth/login
  if (pathname === '/api/v1/auth/login' && req.method === 'POST') {
    const body = await parseBody(req);
    const user = USERS.find((u) => u.username === body.username && u.pass === body.password);
    if (!user) {
      return sendJSON(401, { status: 'error', message: 'Username atau password salah' });
    }
    const token = Buffer.from(JSON.stringify({ uid: user.id, usr: user.username, rol: user.role })).toString('base64');
    return sendJSON(200, {
      status: 'success',
      data: {
        access_token: token,
        expires_in: 28800,
        exam_lockdown_mode: lockdownMode,
        user: {
          id: user.id,
          username: user.username,
          full_name: user.full_name,
          role: user.role,
          class_name: user.class_name,
        },
      },
    });
  }

  // GET /api/v1/cbt/schedules (Daftar Jadwal Ujian untuk Dashboard)
  if (pathname === '/api/v1/cbt/schedules' && req.method === 'GET') {
    return sendJSON(200, {
      status: 'success',
      data: [
        {
          id: activeSchedule.id,
          title: activeSchedule.title,
          bank_name: activeSchedule.bank_name,
          start_time: activeSchedule.start_time,
          duration_minutes: activeSchedule.duration_minutes,
          token_code: activeSchedule.token_code,
          shuffle_questions: activeSchedule.shuffle_questions,
          shuffle_options: activeSchedule.shuffle_options,
          package_url: '/static/packages/exam_1_enc.json',
          package_sha256: currentPackageSHA256,
        },
      ],
    });
  }

  // POST /api/v1/cbt/schedules/:id/update (Edit & Perbarui Jadwal Ujian)
  if ((pathname.endsWith('/update') || req.method === 'PUT') && pathname.includes('/api/v1/cbt/schedules/')) {
    const body = await parseBody(req);
    if (body.title) activeSchedule.title = body.title.trim();
    if (body.bank_name) activeSchedule.bank_name = body.bank_name.trim();
    if (body.start_time) activeSchedule.start_time = body.start_time.trim();
    if (body.duration_minutes) activeSchedule.duration_minutes = parseInt(body.duration_minutes, 10) || activeSchedule.duration_minutes;
    if (body.token_code) activeSchedule.token_code = body.token_code.trim().toUpperCase();
    if (body.shuffle_questions !== undefined) activeSchedule.shuffle_questions = !!body.shuffle_questions;
    if (body.shuffle_options !== undefined) activeSchedule.shuffle_options = !!body.shuffle_options;

    // Enkripsi ulang paket soal dengan konfigurasi terbaru
    compileAndEncryptPackage();

    return sendJSON(200, {
      status: 'success',
      message: 'Jadwal ujian berhasil diperbarui dan paket soal telah dienkripsi ulang!',
      data: activeSchedule,
    });
  }

  // GET /api/v1/cbt/schedules/active
  if (pathname === '/api/v1/cbt/schedules/active' && req.method === 'GET') {
    const user = getUserFromToken(req);
    const uid = user ? user.uid : 1001;
    const sessionKey = `1_${uid}`;
    const session = studentSessions[sessionKey];
    const totalExtra = scheduleExtraMinutes + (studentExtraMinutes[uid] || 0);
    const isInProgress = session && session.status === 'in_progress';

    return sendJSON(200, {
      status: 'success',
      data: {
        schedule_id: activeSchedule.id,
        title: activeSchedule.title,
        duration_minutes: activeSchedule.duration_minutes + totalExtra,
        extra_minutes: totalExtra,
        package_url: '/static/packages/exam_1_enc.json',
        package_sha256: currentPackageSHA256,
        session_status: session ? session.status : 'not_started',
        submitted_at: session ? session.submitted_at : null,
        // Kredensial dekripsi sesi untuk auto-resume saat browser di-refresh
        session_id: isInProgress ? 88400 + uid : null,
        decryption_key_hex: isInProgress ? currentAESKeyHex : null,
        saved_answers: isInProgress ? (studentAnswersStore[uid] || session.answers || {}) : {},
      },
    });
  }

  // POST /api/v1/cbt/schedules/:id/start
  if (pathname.startsWith('/api/v1/cbt/schedules/') && pathname.endsWith('/start') && req.method === 'POST') {
    const body = await parseBody(req);
    const user = getUserFromToken(req);
    const uid = user ? user.uid : 1001;
    const sessionKey = `1_${uid}`;

    // Cek apakah siswa sudah mengumpulkan lembar jawaban
    if (studentSessions[sessionKey] && studentSessions[sessionKey].status === 'submitted') {
      return sendJSON(403, {
        status: 'error',
        code: 'ALREADY_SUBMITTED',
        message: 'Ujian ini sudah Anda selesaikan dan lembar jawaban telah dikunci permanen!',
        submitted_at: studentSessions[sessionKey].submitted_at,
      });
    }

    if (body.token_code !== activeSchedule.token_code) {
      return sendJSON(403, { status: 'error', message: `Token ujian salah! Gunakan: ${activeSchedule.token_code}` });
    }

    // Tandai status sesi ujian siswa: in_progress
    studentSessions[sessionKey] = {
      status: 'in_progress',
      started_at: new Date().toISOString(),
      answers: studentAnswersStore[uid] || {},
    };

    activeExamStudents.add(uid);
    return sendJSON(200, {
      status: 'success',
      data: {
        session_id: 88400 + uid,
        decryption_key_hex: currentAESKeyHex,
        server_time: Math.floor(Date.now() / 1000),
        saved_answers: studentAnswersStore[uid] || {},
      },
    });
  }

  // POST /api/v1/cbt/schedules/:id/sync
  if (pathname.startsWith('/api/v1/cbt/schedules/') && pathname.endsWith('/sync') && req.method === 'POST') {
    const body = await parseBody(req);
    const user = getUserFromToken(req);
    const uid = user ? user.uid : 1001;
    const sessionKey = `1_${uid}`;

    if (studentSessions[sessionKey] && studentSessions[sessionKey].status === 'submitted') {
      return sendJSON(403, { status: 'error', message: 'Sesi ujian telah dikunci (submitted)' });
    }

    if (body.answers) {
      if (!studentAnswersStore[uid]) studentAnswersStore[uid] = {};
      Object.assign(studentAnswersStore[uid], body.answers);
      if (studentSessions[sessionKey]) {
        studentSessions[sessionKey].answers = studentAnswersStore[uid];
      }
      dirtySessionCount++;
    }
    const totalExtra = scheduleExtraMinutes + (studentExtraMinutes[uid] || 0);
    return sendJSON(200, {
      ack: true,
      synced_count: Object.keys(body.answers || {}).length,
      server_ts: Math.floor(Date.now() / 1000),
      extra_minutes: totalExtra,
    });
  }

  // POST /api/v1/cbt/schedules/:id/finish
  if (pathname.startsWith('/api/v1/cbt/schedules/') && pathname.endsWith('/finish') && req.method === 'POST') {
    const body = await parseBody(req);
    const user = getUserFromToken(req);
    const uid = user ? user.uid : 1001;
    const sessionKey = `1_${uid}`;

    if (body.answers) {
      if (!studentAnswersStore[uid]) studentAnswersStore[uid] = {};
      Object.assign(studentAnswersStore[uid], body.answers);
    }

    const now = new Date();
    const formattedDate = now.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }) + ' ' + now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' WIB';

    studentSessions[sessionKey] = {
      status: 'submitted',
      submitted_at: formattedDate,
      answers: studentAnswersStore[uid] || {},
    };

    activeExamStudents.delete(uid);

    return sendJSON(200, {
      status: 'success',
      message: 'Ujian berhasil diselesaikan dan disimpan!',
      submitted_at: formattedDate,
      server_ts: Math.floor(Date.now() / 1000),
    });
  }

  // GET /api/v1/cbt/proctor/live-sessions (Monitoring Real-time Live Proktor)
  if (pathname === '/api/v1/cbt/proctor/live-sessions' && req.method === 'GET') {
    const answerKeys = { 1: 'C', 2: 'B', 3: 'C', 4: 'B', 5: 'C' };
    const classFilter = parsedUrl.searchParams.get('class');
    let students = USERS.filter((u) => u.role === 'student');
    if (classFilter && classFilter !== 'all') {
      students = students.filter((u) => u.class_name === classFilter);
    }

    const result = students.map((st) => {
      const sessionKey = `1_${st.id}`;
      const sess = studentSessions[sessionKey] || {
        status: 'not_started',
        answers: {},
        tab_violations: 0,
        ip_address: `192.168.1.${100 + (st.id % 100)}`,
      };

      const userAnswers = studentAnswersStore[st.id] || sess.answers || {};
      const answeredKeys = Object.keys(userAnswers);
      const answeredCount = answeredKeys.filter((k) => userAnswers[k] && userAnswers[k].a).length;
      const isDoubt = answeredKeys.some((k) => userAnswers[k] && userAnswers[k].d === 1);

      let correctCount = 0;
      for (const [qId, correctOpt] of Object.entries(answerKeys)) {
        if (userAnswers[qId] && userAnswers[qId].a === correctOpt) {
          correctCount++;
        }
      }
      const score = Math.round((correctCount / QUESTIONS.length) * 100);

      return {
        id: st.id,
        username: st.username,
        full_name: st.full_name,
        class_name: st.class_name,
        status: sess.status || 'not_started',
        submitted_at: sess.submitted_at || null,
        started_at: sess.started_at || null,
        answered_count: answeredCount,
        total_questions: QUESTIONS.length,
        is_doubt: isDoubt,
        tab_violations: sess.tab_violations || 0,
        ip_address: sess.ip_address || `192.168.1.${100 + (st.id % 100)}`,
        score: score,
        correct_count: correctCount,
        wrong_count: QUESTIONS.length - correctCount,
        is_passed: score >= 75,
        extra_minutes: scheduleExtraMinutes + (studentExtraMinutes[st.id] || 0),
      };
    });

    return sendJSON(200, {
      status: 'success',
      data: result,
      server_time: new Date().toISOString(),
    });
  }

  // POST /api/v1/cbt/proctor/extend-time (Penambahan Waktu Ujian Massal / Per Siswa)
  if (pathname === '/api/v1/cbt/proctor/extend-time' && req.method === 'POST') {
    const body = await parseBody(req);
    const minutes = parseInt(body.minutes, 10) || 15;
    const target = body.target || 'all';
    const username = body.username;
    const reason = body.reason || 'Dispensasi Proktor';

    if (target === 'all') {
      scheduleExtraMinutes += minutes;
      return sendJSON(200, {
        status: 'success',
        message: `Waktu ujian seluruh siswa berhasil ditambah +${minutes} menit! (${reason})`,
        extra_minutes: scheduleExtraMinutes,
        target: 'all',
      });
    } else {
      const targetUser = USERS.find((u) => u.username === username);
      const uid = targetUser ? targetUser.id : 1001;
      studentExtraMinutes[uid] = (studentExtraMinutes[uid] || 0) + minutes;

      return sendJSON(200, {
        status: 'success',
        message: `Waktu ujian untuk ${username} (${targetUser?.full_name || 'Siswa'}) berhasil ditambah +${minutes} menit! (${reason})`,
        extra_minutes: scheduleExtraMinutes + studentExtraMinutes[uid],
        target: username,
      });
    }
  }

  // POST /api/v1/cbt/proctor/force-finish (Proktor Kunci Selesai Secara Paksa)
  if (pathname === '/api/v1/cbt/proctor/force-finish' && req.method === 'POST') {
    const body = await parseBody(req);
    const studentUsername = body.username || 'siswa_1001';
    const targetUser = USERS.find((u) => u.username === studentUsername);
    const uid = targetUser ? targetUser.id : 1001;
    const sessionKey = `1_${uid}`;

    const now = new Date();
    const formattedDate = now.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }) + ' ' + now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' WIB';

    studentSessions[sessionKey] = {
      ...(studentSessions[sessionKey] || {}),
      status: 'submitted',
      submitted_at: formattedDate,
      answers: studentAnswersStore[uid] || {},
    };
    activeExamStudents.delete(uid);

    return sendJSON(200, {
      status: 'success',
      message: `Ujian ${studentUsername} telah dikunci permanen oleh proktor!`,
      submitted_at: formattedDate,
    });
  }

  // POST /api/v1/cbt/proctor/reset-session (Reset oleh Proktor / Guru)
  if (pathname === '/api/v1/cbt/proctor/reset-session' && req.method === 'POST') {
    const body = await parseBody(req);
    const studentUsername = body.username || 'siswa_1001';
    const targetUser = USERS.find((u) => u.username === studentUsername);
    const uid = targetUser ? targetUser.id : 1001;
    const sessionKey = `1_${uid}`;

    delete studentSessions[sessionKey];
    delete studentAnswersStore[uid];
    activeExamStudents.delete(uid);

    return sendJSON(200, {
      status: 'success',
      message: `Sesi ujian untuk ${studentUsername} berhasil direset! Siswa dapat mengerjakan kembali.`,
    });
  }

  // POST /api/v1/cbt/schedules/:id/publish-package
  if (pathname.startsWith('/api/v1/cbt/schedules/') && pathname.endsWith('/publish-package') && req.method === 'POST') {
    compileAndEncryptPackage();
    return sendJSON(200, {
      status: 'success',
      message: 'Paket berhasil dienkripsi ulang',
      data: {
        schedule_id: 1,
        package_url: '/static/packages/exam_1_enc.json',
        package_sha256: currentPackageSHA256,
      },
    });
  }

  // POST /api/v1/ai/generate-questions
  if (pathname === '/api/v1/ai/generate-questions' && req.method === 'POST') {
    const body = await parseBody(req);
    const jobId = `job_ai_${crypto.randomBytes(4).toString('hex')}`;
    return sendJSON(202, {
      job_id: jobId,
      status: 'queued',
      stream_url: `/api/v1/ai/jobs/${jobId}/events`,
    });
  }

  // GET /api/v1/ai/jobs/:id/events (SSE)
  if (pathname.startsWith('/api/v1/ai/jobs/') && pathname.endsWith('/events') && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    res.write(`event: progress\ndata: ${JSON.stringify({ status: 'processing', completed: 2, total: 5, message: 'Mengambil bahan ajar termodinamika...' })}\n\n`);

    setTimeout(() => {
      res.write(`event: progress\ndata: ${JSON.stringify({ status: 'processing', completed: 4, total: 5, message: 'Gemini AI menyusun opsi A-E dan kunci jawaban...' })}\n\n`);
    }, 1000);

    setTimeout(() => {
      res.write(`event: completed\ndata: ${JSON.stringify({ status: 'completed', completed: 5, total: 5, message: 'Berhasil menghasilkan 5 butir soal terstruktur!' })}\n\n`);
      res.end();
    }, 2200);
    return;
  }

  // GET /api/v1/system/metrics
  if (pathname === '/api/v1/system/metrics' && req.method === 'GET') {
    const memUsage = process.memoryUsage();
    return sendJSON(200, {
      status: 'success',
      ram_alloc_mb: parseFloat((memUsage.heapUsed / 1024 / 1024).toFixed(1)),
      ram_sys_mb: parseFloat((memUsage.rss / 1024 / 1024).toFixed(1)),
      num_goroutines: 28,
      active_exam_students: Math.max(1, activeExamStudents.size),
      pending_redis_dirty_sessions: dirtySessionCount,
      pg_pool_acquired_conns: 4,
      pg_pool_max_conns: 80,
      server_time: new Date().toISOString(),
    });
  }

  // POST /api/v1/admin/lockdown/toggle
  if (pathname === '/api/v1/admin/lockdown/toggle' && req.method === 'POST') {
    const body = await parseBody(req);
    lockdownMode = !!body.enabled;
    return sendJSON(200, {
      status: 'success',
      message: 'Lockdown status updated',
      lockdown_mode: lockdownMode,
    });
  }

  // Fallback 404
  sendJSON(404, { status: 'error', message: 'Endpoint tidak ditemukan' });
});

server.listen(PORT, () => {
  console.log('================================================================');
  console.log(` CBT & LMS AI Server Aktif di: http://localhost:${PORT}`);
  console.log('================================================================');
  console.log(`   * Halaman Login   : http://localhost:${PORT}/`);
  console.log(`   * Ruang Ujian     : http://localhost:${PORT}/exam`);
  console.log(`   * Panel Guru AI   : http://localhost:${PORT}/teacher`);
  console.log(`   * Admin Monitoring: http://localhost:${PORT}/admin`);
  console.log('----------------------------------------------------------------');
  console.log(' Akun Uji Coba:');
  console.log('   - Siswa : siswa_1001 / siswa123 (Token: FISIKA26)');
  console.log('   - Guru  : guru / guru123');
  console.log('   - Admin : admin / admin123');
  console.log('================================================================');
});
