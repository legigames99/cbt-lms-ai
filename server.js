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
let USERS = [
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

// Persistensi Data Master Siswa (students.json)
const STUDENTS_FILE = path.join(__dirname, 'students.json');

function saveStudentsToFile() {
  try {
    const students = USERS.filter(u => u.role === 'student');
    fs.writeFileSync(STUDENTS_FILE, JSON.stringify(students, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save students.json:', e.message);
  }
}

function loadStudentsFromFile() {
  try {
    if (fs.existsSync(STUDENTS_FILE)) {
      const raw = fs.readFileSync(STUDENTS_FILE, 'utf8');
      const saved = JSON.parse(raw);
      if (Array.isArray(saved)) {
        const nonStudents = USERS.filter(u => u.role !== 'student');
        USERS.length = 0;
        USERS.push(...nonStudents, ...saved);
        console.log(`[Master Data] Memuat ${saved.length} siswa dari students.json`);
        return;
      }
    }
  } catch (e) {
    console.error('Failed to load students.json:', e.message);
  }
  saveStudentsToFile();
}

loadStudentsFromFile();

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
  signature_url: '',
  stamp_url: '',
  signature_size: 110,
  stamp_size: 60,
  stamp_offset_x: 10,
  stamp_offset_y: -5,
  exam_rules: '1. Membawa Kartu Peserta Ujian ini selama berlangsungnya tes.\n2. Hadir di ruang ujian 15 menit sebelum ujian dimulai.\n3. Dilarang membawa HP, alat komunikasi atau catatan ke dalam ruang ujian.\n4. Mentaati tata tertib dan petunjuk dari pengawas ujian.',
  show_student_photo: true,
  show_signatures: true,
  show_exam_rules: true,
  cards_per_page: 6
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

// Jadwal Ujian (Multi-Jadwal CBT) & Paket AES-256-GCM
const SCHEDULES_FILE = path.join(__dirname, 'schedules.json');

const DEFAULT_SCHEDULES = [
  {
    id: 1,
    title: 'UAS Fisika Peminatan XII',
    bank_name: 'Bank Termodinamika (5 Soal)',
    start_time: 'Hari ini, 07:30 WIB',
    duration_minutes: 90,
    token_code: 'FISIKA26',
    shuffle_questions: true,
    shuffle_options: true,
    class_target: 'Semua Kelas',
    package_url: '/static/packages/exam_1_enc.json',
    is_active: true,
  },
  {
    id: 2,
    title: 'Penilaian Akhir Matematika Wajib XII',
    bank_name: 'Bank Aljabar & Matriks (5 Soal)',
    start_time: 'Hari ini, 10:00 WIB',
    duration_minutes: 120,
    token_code: 'MTK2026',
    shuffle_questions: true,
    shuffle_options: true,
    class_target: 'Semua Kelas',
    package_url: '/static/packages/exam_2_enc.json',
    is_active: true,
  },
  {
    id: 3,
    title: 'Asesmen Bahasa Indonesia XII',
    bank_name: 'Bank Teks Editorial & Puisi (5 Soal)',
    start_time: 'Hari ini, 13:00 WIB',
    duration_minutes: 90,
    token_code: 'BIND2026',
    shuffle_questions: true,
    shuffle_options: true,
    class_target: 'Semua Kelas',
    package_url: '/static/packages/exam_3_enc.json',
    is_active: true,
  },
  {
    id: 4,
    title: 'Penilaian Harian Kimia Organik XII',
    bank_name: 'Bank Senyawa Karbon & Benzena (5 Soal)',
    start_time: 'Hari ini, 14:30 WIB',
    duration_minutes: 90,
    token_code: 'KIMIA26',
    shuffle_questions: true,
    shuffle_options: true,
    class_target: 'XII IPA 1',
    package_url: '/static/packages/exam_4_enc.json',
    is_active: true,
  },
  {
    id: 5,
    title: 'Ujian Biologi Genetika & Mutasi XII',
    bank_name: 'Bank Substansi Genetika (5 Soal)',
    start_time: 'Besok, 07:30 WIB',
    duration_minutes: 75,
    token_code: 'BIOL2026',
    shuffle_questions: true,
    shuffle_options: true,
    class_target: 'XII IPA 2',
    package_url: '/static/packages/exam_5_enc.json',
    is_active: false,
  },
  {
    id: 6,
    title: 'Asesmen Bahasa Inggris XII (Listening & Reading)',
    bank_name: 'Bank Narrative & Discussion (5 Soal)',
    start_time: 'Besok, 10:00 WIB',
    duration_minutes: 90,
    token_code: 'ENG2026',
    shuffle_questions: true,
    shuffle_options: true,
    class_target: 'Semua Kelas',
    package_url: '/static/packages/exam_6_enc.json',
    is_active: true,
  },
  {
    id: 7,
    title: 'Ujian Sekolah Sejarah Indonesia XII',
    bank_name: 'Bank Pergerakan Nasional & Kemerdekaan (5 Soal)',
    start_time: 'Lusa, 08:00 WIB',
    duration_minutes: 60,
    token_code: 'SEJ2026',
    shuffle_questions: true,
    shuffle_options: true,
    class_target: 'Semua Kelas',
    package_url: '/static/packages/exam_7_enc.json',
    is_active: false,
  },
  {
    id: 8,
    title: 'Tryout Mandiri UTBK TPS XII',
    bank_name: 'Bank Penalaran Matematika & Literasi (5 Soal)',
    start_time: 'Lusa, 13:00 WIB',
    duration_minutes: 105,
    token_code: 'TPS2026',
    shuffle_questions: true,
    shuffle_options: true,
    class_target: 'Semua Kelas',
    package_url: '/static/packages/exam_8_enc.json',
    is_active: false,
  },
];

let SCHEDULES = [...DEFAULT_SCHEDULES];

function saveSchedulesToFile() {
  try {
    fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(SCHEDULES, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save schedules.json:', e.message);
  }
}

// Generator Token Ujian Acak (6 Karakter Huruf & Angka Bersih, Tanpa Karakter Mirip Seperti O/0, I/1)
function generateRandomToken(length = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let token = '';
  for (let i = 0; i < length; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

// Pengelolaan Token Dinamis & Statis (Berubah Otomatis Tiap 5m, 10m, 15m)
function updateScheduleDynamicToken(sch, forceNew = false) {
  if (!sch) return null;
  const isDynamic = sch.token_type === 'dynamic';
  const intervalMinutes = [5, 10, 15].includes(parseInt(sch.token_interval, 10)) ? parseInt(sch.token_interval, 10) : 15;
  const intervalMs = intervalMinutes * 60 * 1000;
  const now = Date.now();

  if (!isDynamic) {
    sch.token_type = 'static';
    return {
      token_code: sch.token_code,
      token_type: 'static',
      token_interval: 0,
      seconds_left: null,
    };
  }

  sch.token_type = 'dynamic';
  sch.token_interval = intervalMinutes;

  if (!sch.token_updated_at) {
    sch.token_updated_at = now;
  }

  const elapsed = now - sch.token_updated_at;
  let changed = false;

  if (forceNew || elapsed >= intervalMs) {
    sch.token_prev_code = sch.token_code;
    sch.token_prev_expires_at = now + (60 * 1000); // 60 detik toleransi transisi
    sch.token_code = generateRandomToken(6);
    sch.token_updated_at = now;
    changed = true;
  }

  if (changed) {
    saveSchedulesToFile();
  }

  const remainingMs = Math.max(0, intervalMs - (Date.now() - sch.token_updated_at));
  const secondsLeft = Math.ceil(remainingMs / 1000);

  return {
    token_code: sch.token_code,
    token_type: 'dynamic',
    token_interval: intervalMinutes,
    token_updated_at: sch.token_updated_at,
    seconds_left: secondsLeft,
  };
}

function loadSchedulesFromFile() {
  try {
    if (fs.existsSync(SCHEDULES_FILE)) {
      const raw = fs.readFileSync(SCHEDULES_FILE, 'utf8');
      const saved = JSON.parse(raw);
      if (Array.isArray(saved) && saved.length > 0) {
        SCHEDULES = saved.map(s => {
          const item = {
            ...s,
            is_active: s.is_active !== undefined ? !!s.is_active : true,
            token_type: s.token_type || 'static',
            token_interval: [5, 10, 15].includes(parseInt(s.token_interval, 10)) ? parseInt(s.token_interval, 10) : 15,
          };
          updateScheduleDynamicToken(item);
          return item;
        });
        console.log(`[Jadwal Ujian] Memuat ${SCHEDULES.length} jadwal dari schedules.json`);
        return;
      }
    }
  } catch (e) {
    console.error('Failed to load schedules.json:', e.message);
  }
  SCHEDULES = [...DEFAULT_SCHEDULES];
  saveSchedulesToFile();
}

loadSchedulesFromFile();

// Interval pemeriksaan token dinamis otomatis di latar belakang setiap 10 detik
setInterval(() => {
  SCHEDULES.forEach(s => {
    if (s.is_active !== false && s.token_type === 'dynamic') {
      updateScheduleDynamicToken(s);
    }
  });
}, 10000);

let activeSchedule = SCHEDULES[0] || DEFAULT_SCHEDULES[0];
let currentAESKeyHex = '';
let currentPackageSHA256 = '';
const scheduleKeys = {};

function compileAndEncryptPackage(targetScheduleId = null) {
  const targetList = targetScheduleId
    ? SCHEDULES.filter(s => s.id === targetScheduleId)
    : SCHEDULES;

  for (const sch of targetList) {
    const key = crypto.randomBytes(32);
    const nonce = crypto.randomBytes(12);

    const payload = JSON.stringify({
      schedule_id: sch.id,
      title: sch.title,
      duration_minutes: sch.duration_minutes,
      shuffle_questions: sch.shuffle_questions,
      shuffle_options: sch.shuffle_options,
      questions: QUESTIONS,
    });

    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    let encrypted = cipher.update(payload, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    const fullCipherHex = encrypted + tag;

    const pkgObj = {
      schedule_id: sch.id,
      title: sch.title,
      nonce: nonce.toString('hex'),
      ciphertext: fullCipherHex,
    };

    const fileData = JSON.stringify(pkgObj);
    const filename = `exam_${sch.id}_enc.json`;
    const targetPath = path.join(STATIC_PKG_DIR, filename);
    fs.writeFileSync(targetPath, fileData);

    const keyHex = key.toString('hex');
    const sha256 = crypto.createHash('sha256').update(fileData).digest('hex');
    scheduleKeys[sch.id] = { keyHex, sha256, packageUrl: `/static/packages/${filename}` };
    sch.package_url = `/static/packages/${filename}`;
  }

  if (scheduleKeys[activeSchedule.id]) {
    currentAESKeyHex = scheduleKeys[activeSchedule.id].keyHex;
    currentPackageSHA256 = scheduleKeys[activeSchedule.id].sha256;
  }
  console.log(`[CBT Packager] Berhasil mengompilasi ${targetList.length} paket soal terenkripsi AES-256-GCM`);
}

compileAndEncryptPackage();

// In-Memory Session & Answer Store (Multi-Jadwal: {schedule_id}_{student_id})
const studentAnswersStore = {
  // Jadwal 1 (UAS Fisika Peminatan XII)
  '1_1001': { 1: { a: 'C', d: 0 }, 2: { a: 'B', d: 0 }, 3: { a: 'C', d: 0 }, 4: { a: 'B', d: 0 }, 5: { a: 'C', d: 0 } },
  '1_1002': { 1: { a: 'A', d: 1 }, 2: { a: 'B', d: 0 }, 3: { a: 'C', d: 0 } },
  // Jadwal 2 (Penilaian Akhir Matematika Wajib XII)
  '2_1001': { 1: { a: 'B', d: 0 }, 2: { a: 'B', d: 0 }, 3: { a: 'B', d: 0 } },
  '2_1002': { 1: { a: 'C', d: 0 }, 2: { a: 'C', d: 0 }, 3: { a: 'C', d: 0 }, 4: { a: 'C', d: 0 }, 5: { a: 'C', d: 0 } },
  '2_1003': { 1: { a: 'A', d: 1 }, 2: { a: 'D', d: 0 } },
  // Jadwal 3 (Asesmen Bahasa Indonesia XII)
  '3_1001': { 1: { a: 'C', d: 0 }, 2: { a: 'B', d: 0 }, 3: { a: 'A', d: 0 }, 4: { a: 'D', d: 0 }, 5: { a: 'B', d: 0 } },
  '3_1003': { 1: { a: 'C', d: 0 }, 2: { a: 'C', d: 0 } },
};

const studentSessions = {
  // Jadwal 1 (UAS Fisika Peminatan XII)
  '1_1001': {
    status: 'submitted',
    started_at: '21 Okt 2026 07.30.00 WIB',
    submitted_at: '21 Okt 2026 08.45.15 WIB',
    tab_violations: 0,
    ip_address: '192.168.1.102',
    answers: studentAnswersStore['1_1001'],
  },
  '1_1002': {
    status: 'in_progress',
    started_at: '21 Okt 2026 07.35.00 WIB',
    submitted_at: null,
    tab_violations: 2,
    ip_address: '192.168.1.105',
    answers: studentAnswersStore['1_1002'],
  },
  '1_1003': {
    status: 'not_started',
    started_at: null,
    submitted_at: null,
    tab_violations: 0,
    ip_address: '192.168.1.108',
    answers: {},
  },
  // Jadwal 2 (Penilaian Akhir Matematika Wajib XII)
  '2_1001': {
    status: 'in_progress',
    started_at: '21 Okt 2026 10.05.00 WIB',
    submitted_at: null,
    tab_violations: 0,
    ip_address: '192.168.1.102',
    answers: studentAnswersStore['2_1001'],
  },
  '2_1002': {
    status: 'submitted',
    started_at: '21 Okt 2026 10.00.00 WIB',
    submitted_at: '21 Okt 2026 11.20.10 WIB',
    tab_violations: 1,
    ip_address: '192.168.1.105',
    answers: studentAnswersStore['2_1002'],
  },
  '2_1003': {
    status: 'in_progress',
    started_at: '21 Okt 2026 10.15.00 WIB',
    submitted_at: null,
    tab_violations: 0,
    ip_address: '192.168.1.108',
    answers: studentAnswersStore['2_1003'],
  },
  // Jadwal 3 (Asesmen Bahasa Indonesia XII)
  '3_1001': {
    status: 'submitted',
    started_at: '21 Okt 2026 13.00.00 WIB',
    submitted_at: '21 Okt 2026 14.15.00 WIB',
    tab_violations: 0,
    ip_address: '192.168.1.102',
    answers: studentAnswersStore['3_1001'],
  },
  '3_1003': {
    status: 'in_progress',
    started_at: '21 Okt 2026 13.10.00 WIB',
    submitted_at: null,
    tab_violations: 0,
    ip_address: '192.168.1.108',
    answers: studentAnswersStore['3_1003'],
  },
};

// Penambahan Waktu Ujian (Dispensasi Proktor)
const scheduleExtraMinutes = {};
const studentExtraMinutes = {};

// Inisialisasi Sample Jawaban Siswa & Sesi Realistis untuk Seluruh Jadwal
function initSampleStudentSessions() {
  const answerKeys = { 1: 'C', 2: 'B', 3: 'C', 4: 'B', 5: 'C' };
  const allOptions = ['A', 'B', 'C', 'D', 'E'];

  for (const sch of SCHEDULES) {
    const students = USERS.filter((u) => u.role === 'student');
    for (const st of students) {
      const sessionKey = `${sch.id}_${st.id}`;
      if (!studentAnswersStore[sessionKey] || Object.keys(studentAnswersStore[sessionKey]).length === 0) {
        studentAnswersStore[sessionKey] = {};
        const stSeed = (st.id * 17 + sch.id * 31) % 100;
        let numWrong = 0;
        if (stSeed < 30) numWrong = 0; // 100%
        else if (stSeed < 70) numWrong = 1; // 80%
        else if (stSeed < 90) numWrong = 2; // 60%
        else numWrong = 3; // 40%

        const wrongQuestions = [(stSeed % 5) + 1, ((stSeed + 2) % 5) + 1, ((stSeed + 3) % 5) + 1].slice(0, numWrong);

        for (let q = 1; q <= 5; q++) {
          const correct = answerKeys[q] || 'C';
          let chosen = correct;
          if (wrongQuestions.includes(q)) {
            const distractors = allOptions.filter((o) => o !== correct);
            chosen = distractors[(stSeed + q) % distractors.length];
          }
          studentAnswersStore[sessionKey][q] = {
            a: chosen,
            d: (stSeed % 6 === 0 && q === 2) ? 1 : 0,
          };
        }
      }

      if (!studentSessions[sessionKey]) {
        const isCompleted = sch.is_active === false || (st.id % 6 !== 0);
        studentSessions[sessionKey] = {
          status: isCompleted ? 'submitted' : 'in_progress',
          started_at: '21 Okt 2026 07.30.00 WIB',
          submitted_at: isCompleted ? `21 Okt 2026 08.${20 + (st.id % 35)}.12 WIB` : null,
          tab_violations: (st.id % 4 === 0) ? (st.id % 3) + 1 : 0,
          ip_address: `192.168.1.${100 + (st.id % 100)}`,
          answers: studentAnswersStore[sessionKey],
        };
      }
    }
  }
}

initSampleStudentSessions();

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
  if (pathname.startsWith('/static/')) {
    const safeRel = path.normalize(pathname.replace(/^\/static\//, '')).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(__dirname, 'static', safeRel);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.webp': 'image/webp',
        '.json': 'application/json',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.xls': 'application/vnd.ms-excel'
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
      'signature_date', 'logo_url', 'signature_url', 'stamp_url',
      'signature_size', 'stamp_size', 'stamp_offset_x', 'stamp_offset_y', 'exam_rules',
      'show_student_photo', 'show_signatures', 'show_exam_rules', 'cards_per_page'
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

  // POST /api/v1/school/upload-signature (Unggah Berkas Tanda Tangan Kepala Sekolah)
  if (pathname === '/api/v1/school/upload-signature' && req.method === 'POST') {
    const body = await parseBody(req);
    if (!body.image_data) {
      return sendJSON(400, { status: 'error', message: 'Data gambar tanda tangan tidak ditemukan.' });
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

      const safeExt = ['png', 'jpg', 'jpeg', 'svg', 'webp'].includes(ext) ? ext : 'png';
      const filename = `ttd_kepsek_${Date.now()}.${safeExt}`;
      const filePath = path.join(STATIC_UPLOADS_DIR, filename);
      fs.writeFileSync(filePath, buffer);

      const fileUrl = `/static/uploads/${filename}`;
      schoolProfile.signature_url = fileUrl;

      try {
        fs.writeFileSync(SCHOOL_PROFILE_PATH, JSON.stringify(schoolProfile, null, 2), 'utf8');
      } catch (e) {
        console.error('[Pengaturan] Gagal menulis school_profile.json:', e.message);
      }

      return sendJSON(200, {
        status: 'success',
        message: 'Tanda tangan kepala sekolah berhasil diunggah!',
        signature_url: fileUrl,
        filename: filename
      });
    } catch (err) {
      return sendJSON(500, { status: 'error', message: 'Gagal memproses tanda tangan: ' + err.message });
    }
  }

  // POST /api/v1/school/upload-stamp (Unggah Berkas Cap Stempel Sekolah)
  if (pathname === '/api/v1/school/upload-stamp' && req.method === 'POST') {
    const body = await parseBody(req);
    if (!body.image_data) {
      return sendJSON(400, { status: 'error', message: 'Data gambar cap tidak ditemukan.' });
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

      const safeExt = ['png', 'jpg', 'jpeg', 'svg', 'webp'].includes(ext) ? ext : 'png';
      const filename = `cap_sekolah_${Date.now()}.${safeExt}`;
      const filePath = path.join(STATIC_UPLOADS_DIR, filename);
      fs.writeFileSync(filePath, buffer);

      const fileUrl = `/static/uploads/${filename}`;
      schoolProfile.stamp_url = fileUrl;

      try {
        fs.writeFileSync(SCHOOL_PROFILE_PATH, JSON.stringify(schoolProfile, null, 2), 'utf8');
      } catch (e) {
        console.error('[Pengaturan] Gagal menulis school_profile.json:', e.message);
      }

      return sendJSON(200, {
        status: 'success',
        message: 'Cap stempel sekolah berhasil diunggah!',
        stamp_url: fileUrl,
        filename: filename
      });
    } catch (err) {
      return sendJSON(500, { status: 'error', message: 'Gagal memproses cap sekolah: ' + err.message });
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
    saveStudentsToFile();
    return sendJSON(200, {
      status: 'success',
      message: `Siswa baru ${newStudent.full_name} berhasil ditambahkan!`,
      data: newStudent,
    });
  }

  // POST /api/v1/master/students/bulk-import (Import Massal Siswa via Excel)
  if (pathname === '/api/v1/master/students/bulk-import' && req.method === 'POST') {
    const body = await parseBody(req);
    const list = body.students || [];
    const overwrite = body.overwrite !== false;

    if (!Array.isArray(list) || list.length === 0) {
      return sendJSON(400, { status: 'error', message: 'Data siswa dari file Excel kosong atau tidak valid!' });
    }

    let addedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let maxId = Math.max(...USERS.map(u => u.id || 0), 1000);

    for (const item of list) {
      const username = (item.username || '').toString().trim();
      const fullName = (item.full_name || item.name || item.nama || item.student_name || '').toString().trim();
      if (!username || !fullName) {
        skippedCount++;
        continue;
      }

      const existingIdx = USERS.findIndex(u => u.username === username);
      if (existingIdx !== -1) {
        if (overwrite) {
          USERS[existingIdx] = {
            ...USERS[existingIdx],
            full_name: fullName,
            pass: item.password || item.pass || USERS[existingIdx].pass || 'siswa123',
            class_name: item.class_name || item.class || USERS[existingIdx].class_name || 'XII IPA 1',
            nisn: item.nisn || USERS[existingIdx].nisn || '',
            nis: item.nis || USERS[existingIdx].nis || '',
            exam_no: item.exam_no || USERS[existingIdx].exam_no || '',
            gender: item.gender || USERS[existingIdx].gender || 'Laki-laki',
            room: item.room || item.lab || USERS[existingIdx].room || 'Ruang Lab Komputer 01',
            session: item.session || USERS[existingIdx].session || 'Sesi 1 (07:30 - 09:30)',
            server: item.server || USERS[existingIdx].server || 'SRV-01',
          };
          updatedCount++;
        } else {
          skippedCount++;
        }
      } else {
        maxId++;
        const newStudent = {
          id: maxId,
          username: username,
          pass: item.password || item.pass || 'siswa123',
          full_name: fullName,
          role: 'student',
          class_name: item.class_name || item.class || 'XII IPA 1',
          nisn: item.nisn || `007812${maxId}`,
          nis: item.nis || `2324${maxId}`,
          exam_no: item.exam_no || `26-01-05-${maxId}`,
          birth_place_date: item.birth_place_date || 'Jakarta, 01 Januari 2008',
          gender: item.gender || 'Laki-laki',
          room: item.room || item.lab || 'Ruang Lab Komputer 01',
          session: item.session || 'Sesi 1 (07:30 - 09:30)',
          server: item.server || 'SRV-01',
        };
        USERS.push(newStudent);
        addedCount++;
      }
    }

    saveStudentsToFile();

    return sendJSON(200, {
      status: 'success',
      message: `Import Excel berhasil! ${addedCount} siswa baru ditambahkan, ${updatedCount} diperbarui, ${skippedCount} dilewati.`,
      added: addedCount,
      updated: updatedCount,
      skipped: skippedCount,
      total: USERS.filter(u => u.role === 'student').length,
    });
  }

  // POST /api/v1/master/students/bulk-delete (Hapus Beberapa Siswa atau Semua Siswa Sekaligus)
  if (pathname === '/api/v1/master/students/bulk-delete' && req.method === 'POST') {
    const body = await parseBody(req);
    const deleteAll = body.all === true || body.delete_all === true || body.ids === 'all';
    const ids = Array.isArray(body.ids) ? body.ids.map(Number) : [];

    if (!deleteAll && ids.length === 0) {
      return sendJSON(400, { status: 'error', message: 'Daftar ID siswa yang ingin dihapus belum dipilih!' });
    }

    const currentStudents = USERS.filter(u => u.role === 'student');
    const initialCount = currentStudents.length;

    if (deleteAll) {
      USERS = USERS.filter(u => u.role !== 'student');
      saveStudentsToFile();
      return sendJSON(200, {
        status: 'success',
        message: `Berhasil menghapus seluruh data siswa (${initialCount} siswa) dari sistem!`,
        deleted_count: initialCount,
        remaining_count: 0
      });
    } else {
      const targetIds = new Set(ids);
      const beforeTotal = USERS.length;
      USERS = USERS.filter(u => !(u.role === 'student' && targetIds.has(Number(u.id))));
      const deletedCount = beforeTotal - USERS.length;
      saveStudentsToFile();
      const remainingCount = USERS.filter(u => u.role === 'student').length;
      return sendJSON(200, {
        status: 'success',
        message: `Berhasil menghapus ${deletedCount} data siswa terpilih!`,
        deleted_count: deletedCount,
        remaining_count: remainingCount
      });
    }
  }

  // POST /api/v1/master/students/:id/delete atau DELETE
  if ((pathname.endsWith('/delete') || req.method === 'DELETE') && pathname.includes('/api/v1/master/students/')) {
    const parts = pathname.split('/');
    const studentId = parseInt(parts[parts.length - (pathname.endsWith('/delete') ? 2 : 1)], 10);
    const idx = USERS.findIndex(u => u.id === studentId);
    if (idx !== -1) {
      const removed = USERS.splice(idx, 1)[0];
      saveStudentsToFile();
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

  // GET /api/v1/cbt/schedules (Daftar Semua Jadwal Ujian dengan Filter Status & Pencarian)
  if (pathname === '/api/v1/cbt/schedules' && req.method === 'GET') {
    const statusFilter = parsedUrl.searchParams.get('status') || 'all';
    const searchQuery = (parsedUrl.searchParams.get('search') || '').trim().toLowerCase();

    let list = SCHEDULES;
    if (statusFilter === 'active') {
      list = list.filter(s => s.is_active !== false);
    } else if (statusFilter === 'inactive') {
      list = list.filter(s => s.is_active === false);
    }

    if (searchQuery) {
      list = list.filter(s =>
        (s.title && s.title.toLowerCase().includes(searchQuery)) ||
        (s.token_code && s.token_code.toLowerCase().includes(searchQuery)) ||
        (s.bank_name && s.bank_name.toLowerCase().includes(searchQuery)) ||
        (s.class_target && s.class_target.toLowerCase().includes(searchQuery))
      );
    }

    const counts = {
      all: SCHEDULES.length,
      active: SCHEDULES.filter(s => s.is_active !== false).length,
      inactive: SCHEDULES.filter(s => s.is_active === false).length,
    };

    const mappedList = list.map(s => {
      const tInfo = updateScheduleDynamicToken(s);
      return {
        ...s,
        token_code: s.token_code,
        token_type: s.token_type || 'static',
        token_interval: s.token_interval || 15,
        seconds_left: tInfo ? tInfo.seconds_left : null,
      };
    });

    return sendJSON(200, {
      status: 'success',
      data: mappedList,
      total: mappedList.length,
      counts: counts,
    });
  }

  // POST /api/v1/cbt/schedules/:id/toggle-status (Ubah Status Jadwal Aktif / Tidak Aktif)
  if (pathname.includes('/api/v1/cbt/schedules/') && pathname.endsWith('/toggle-status') && req.method === 'POST') {
    const parts = pathname.split('/');
    const schId = parseInt(parts[parts.length - 2], 10);
    const sch = SCHEDULES.find(s => s.id === schId);
    if (!sch) {
      return sendJSON(404, { status: 'error', message: 'Jadwal ujian tidak ditemukan' });
    }
    const body = await parseBody(req);
    if (body.is_active !== undefined) {
      sch.is_active = !!body.is_active;
    } else {
      sch.is_active = (sch.is_active === false) ? true : false;
    }
    saveSchedulesToFile();
    return sendJSON(200, {
      status: 'success',
      message: `Status jadwal "${sch.title}" berhasil diubah menjadi ${sch.is_active ? 'AKTIF' : 'TIDAK AKTIF'}!`,
      data: sch,
    });
  }

  // POST /api/v1/cbt/schedules/create (Tambah Jadwal Ujian Baru)
  if ((pathname === '/api/v1/cbt/schedules/create' || pathname === '/api/v1/cbt/schedules/add') && req.method === 'POST') {
    const body = await parseBody(req);
    const nextId = Math.max(...SCHEDULES.map(s => s.id || 0), 0) + 1;
    const tokenType = body.token_type === 'dynamic' ? 'dynamic' : 'static';
    const tokenInterval = [5, 10, 15].includes(parseInt(body.token_interval, 10)) ? parseInt(body.token_interval, 10) : 15;
    let tokenCode = (body.token_code || '').trim().toUpperCase();
    if (!tokenCode) {
      tokenCode = tokenType === 'dynamic' ? generateRandomToken(6) : `TOKEN${nextId}`;
    }
    const newSch = {
      id: nextId,
      title: body.title?.trim() || `Jadwal Ujian #${nextId}`,
      bank_name: body.bank_name?.trim() || 'Bank Termodinamika (5 Soal)',
      start_time: body.start_time?.trim() || 'Hari ini, 08:00 WIB',
      duration_minutes: parseInt(body.duration_minutes, 10) || 90,
      token_code: tokenCode,
      token_type: tokenType,
      token_interval: tokenInterval,
      token_updated_at: Date.now(),
      shuffle_questions: body.shuffle_questions !== false,
      shuffle_options: body.shuffle_options !== false,
      class_target: body.class_target || 'Semua Kelas',
      package_url: `/static/packages/exam_${nextId}_enc.json`,
      is_active: body.is_active !== undefined ? !!body.is_active : true,
    };
    SCHEDULES.push(newSch);
    compileAndEncryptPackage(nextId);
    saveSchedulesToFile();
    return sendJSON(200, {
      status: 'success',
      message: `Jadwal ujian "${newSch.title}" berhasil dibuat dan paket soal telah dienkripsi!`,
      data: newSch,
    });
  }

  // POST /api/v1/cbt/schedules/:id/update (Edit & Perbarui Jadwal Ujian)
  if ((pathname.endsWith('/update') || req.method === 'PUT') && pathname.includes('/api/v1/cbt/schedules/')) {
    const parts = pathname.split('/');
    const schId = parseInt(parts[pathname.endsWith('/update') ? parts.length - 2 : parts.length - 1], 10) || 1;
    const sch = SCHEDULES.find(s => s.id === schId);
    if (!sch) {
      return sendJSON(404, { status: 'error', message: 'Jadwal ujian tidak ditemukan' });
    }
    const body = await parseBody(req);
    if (body.title) sch.title = body.title.trim();
    if (body.bank_name) sch.bank_name = body.bank_name.trim();
    if (body.start_time) sch.start_time = body.start_time.trim();
    if (body.duration_minutes) sch.duration_minutes = parseInt(body.duration_minutes, 10) || sch.duration_minutes;
    if (body.token_type !== undefined) {
      const prevType = sch.token_type;
      sch.token_type = body.token_type === 'dynamic' ? 'dynamic' : 'static';
      if (prevType !== 'dynamic' && sch.token_type === 'dynamic') {
        sch.token_updated_at = Date.now();
        if (!body.token_code) sch.token_code = generateRandomToken(6);
      }
    }
    if (body.token_interval !== undefined) {
      sch.token_interval = [5, 10, 15].includes(parseInt(body.token_interval, 10)) ? parseInt(body.token_interval, 10) : 15;
    }
    if (body.token_code) sch.token_code = body.token_code.trim().toUpperCase();
    if (body.shuffle_questions !== undefined) sch.shuffle_questions = !!body.shuffle_questions;
    if (body.shuffle_options !== undefined) sch.shuffle_options = !!body.shuffle_options;
    if (body.is_active !== undefined) sch.is_active = !!body.is_active;

    compileAndEncryptPackage(schId);
    saveSchedulesToFile();

    return sendJSON(200, {
      status: 'success',
      message: `Jadwal ujian "${sch.title}" berhasil diperbarui dan paket soal telah dienkripsi ulang!`,
      data: sch,
    });
  }

  // POST /api/v1/cbt/schedules/:id/refresh-token (Rilis Token Baru Manual)
  if (pathname.includes('/api/v1/cbt/schedules/') && pathname.endsWith('/refresh-token') && req.method === 'POST') {
    const parts = pathname.split('/');
    const schId = parseInt(parts[parts.length - 2], 10);
    const sch = SCHEDULES.find(s => s.id === schId);
    if (!sch) {
      return sendJSON(404, { status: 'error', message: 'Jadwal ujian tidak ditemukan' });
    }
    const tokenInfo = updateScheduleDynamicToken(sch, true);
    return sendJSON(200, {
      status: 'success',
      message: `Token baru untuk "${sch.title}" berhasil dirilis: ${sch.token_code}`,
      data: {
        id: sch.id,
        token_code: sch.token_code,
        token_type: sch.token_type,
        token_interval: sch.token_interval,
        seconds_left: tokenInfo ? tokenInfo.seconds_left : (sch.token_interval || 15) * 60,
      }
    });
  }

  // POST /api/v1/cbt/schedules/:id/delete (Hapus Jadwal Ujian)
  if ((pathname.endsWith('/delete') || req.method === 'DELETE') && pathname.includes('/api/v1/cbt/schedules/')) {
    const parts = pathname.split('/');
    const schId = parseInt(parts[pathname.endsWith('/delete') ? parts.length - 2 : parts.length - 1], 10);
    const idx = SCHEDULES.findIndex(s => s.id === schId);
    if (idx !== -1) {
      const removed = SCHEDULES.splice(idx, 1)[0];
      saveSchedulesToFile();
      return sendJSON(200, {
        status: 'success',
        message: `Jadwal ujian "${removed.title}" berhasil dihapus!`,
      });
    }
    return sendJSON(404, { status: 'error', message: 'Jadwal ujian tidak ditemukan' });
  }

  // GET /api/v1/cbt/schedules/active
  if (pathname === '/api/v1/cbt/schedules/active' && req.method === 'GET') {
    const user = getUserFromToken(req);
    const uid = user ? user.uid : 1001;
    const schId = parseInt(parsedUrl.searchParams.get('schedule_id'), 10) || SCHEDULES[0]?.id || 1;
    const curSch = SCHEDULES.find(s => s.id === schId) || SCHEDULES[0];
    const sessionKey = `${curSch.id}_${uid}`;
    const session = studentSessions[sessionKey];
    const totalExtra = (scheduleExtraMinutes[curSch.id] || 0) + (studentExtraMinutes[`${curSch.id}_${uid}`] || 0);
    const isInProgress = session && session.status === 'in_progress';
    const schKeyInfo = scheduleKeys[curSch.id] || { keyHex: currentAESKeyHex, sha256: currentPackageSHA256, packageUrl: `/static/packages/exam_${curSch.id}_enc.json` };

    return sendJSON(200, {
      status: 'success',
      data: {
        schedule_id: curSch.id,
        title: curSch.title,
        duration_minutes: curSch.duration_minutes + totalExtra,
        extra_minutes: totalExtra,
        package_url: schKeyInfo.packageUrl || curSch.package_url,
        package_sha256: schKeyInfo.sha256,
        session_status: session ? session.status : 'not_started',
        submitted_at: session ? session.submitted_at : null,
        // Kredensial dekripsi sesi untuk auto-resume saat browser di-refresh
        session_id: isInProgress ? 88400 + uid : null,
        decryption_key_hex: isInProgress ? schKeyInfo.keyHex : null,
        saved_answers: isInProgress ? (studentAnswersStore[sessionKey] || session.answers || {}) : {},
      },
    });
  }

  // POST /api/v1/cbt/schedules/:id/start
  if (pathname.startsWith('/api/v1/cbt/schedules/') && pathname.endsWith('/start') && req.method === 'POST') {
    const body = await parseBody(req);
    const user = getUserFromToken(req);
    const uid = user ? user.uid : 1001;
    const parts = pathname.split('/');
    const schId = parseInt(parts[5], 10) || 1;
    const curSch = SCHEDULES.find(s => s.id === schId) || SCHEDULES[0];
    const sessionKey = `${curSch.id}_${uid}`;

    // Cek apakah jadwal ujian sedang aktif
    if (curSch.is_active === false) {
      return sendJSON(403, {
        status: 'error',
        code: 'SCHEDULE_INACTIVE',
        message: `Jadwal ujian "${curSch.title}" saat ini berstatus TIDAK AKTIF atau belum dibuka oleh proktor.`,
      });
    }

    // Cek apakah siswa sudah mengumpulkan lembar jawaban
    if (studentSessions[sessionKey] && studentSessions[sessionKey].status === 'submitted') {
      return sendJSON(403, {
        status: 'error',
        code: 'ALREADY_SUBMITTED',
        message: 'Ujian ini sudah Anda selesaikan dan lembar jawaban telah dikunci permanen!',
        submitted_at: studentSessions[sessionKey].submitted_at,
      });
    }

    updateScheduleDynamicToken(curSch);
    const inputToken = (body.token_code || '').trim().toUpperCase();
    const curToken = (curSch.token_code || '').toUpperCase();
    const prevToken = (curSch.token_prev_code || '').toUpperCase();
    const isGraceValid = curSch.token_type === 'dynamic' &&
      prevToken &&
      inputToken === prevToken &&
      curSch.token_prev_expires_at &&
      Date.now() <= curSch.token_prev_expires_at;

    if (inputToken !== curToken && !isGraceValid) {
      return sendJSON(403, { status: 'error', message: `Token ujian salah atau telah berganti! Masukkan token aktif saat ini: ${curSch.token_code}` });
    }

    const schKeyInfo = scheduleKeys[curSch.id] || { keyHex: currentAESKeyHex };

    // Tandai status sesi ujian siswa: in_progress
    studentSessions[sessionKey] = {
      status: 'in_progress',
      started_at: new Date().toISOString(),
      answers: studentAnswersStore[sessionKey] || studentAnswersStore[uid] || {},
    };

    activeExamStudents.add(uid);
    return sendJSON(200, {
      status: 'success',
      data: {
        session_id: 88400 + uid,
        decryption_key_hex: schKeyInfo.keyHex || currentAESKeyHex,
        server_time: Math.floor(Date.now() / 1000),
        saved_answers: studentSessions[sessionKey].answers,
      },
    });
  }

  // POST /api/v1/cbt/schedules/:id/sync
  if (pathname.startsWith('/api/v1/cbt/schedules/') && pathname.endsWith('/sync') && req.method === 'POST') {
    const body = await parseBody(req);
    const user = getUserFromToken(req);
    const uid = user ? user.uid : 1001;
    const parts = pathname.split('/');
    const schId = parseInt(parts[5], 10) || 1;
    const curSch = SCHEDULES.find(s => s.id === schId) || SCHEDULES[0];
    const sessionKey = `${curSch.id}_${uid}`;

    if (studentSessions[sessionKey] && studentSessions[sessionKey].status === 'submitted') {
      return sendJSON(403, { status: 'error', message: 'Sesi ujian telah dikunci (submitted)' });
    }

    if (body.answers) {
      if (!studentAnswersStore[sessionKey]) studentAnswersStore[sessionKey] = {};
      Object.assign(studentAnswersStore[sessionKey], body.answers);
      if (studentSessions[sessionKey]) {
        studentSessions[sessionKey].answers = studentAnswersStore[sessionKey];
      }
      dirtySessionCount++;
    }
    const totalExtra = (scheduleExtraMinutes[curSch.id] || 0) + (studentExtraMinutes[sessionKey] || 0);
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
    const parts = pathname.split('/');
    const schId = parseInt(parts[5], 10) || 1;
    const curSch = SCHEDULES.find(s => s.id === schId) || SCHEDULES[0];
    const sessionKey = `${curSch.id}_${uid}`;

    if (body.answers) {
      if (!studentAnswersStore[sessionKey]) studentAnswersStore[sessionKey] = {};
      Object.assign(studentAnswersStore[sessionKey], body.answers);
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
      answers: studentAnswersStore[sessionKey] || {},
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
    const scheduleId = parseInt(parsedUrl.searchParams.get('schedule_id'), 10) || SCHEDULES[0]?.id || 1;
    const curSchedule = SCHEDULES.find((s) => s.id === scheduleId) || SCHEDULES[0];

    let students = USERS.filter((u) => u.role === 'student');
    if (classFilter && classFilter !== 'all') {
      students = students.filter((u) => u.class_name === classFilter);
    }

    const result = students.map((st) => {
      const sessionKey = `${curSchedule.id}_${st.id}`;
      const sess = studentSessions[sessionKey] || {
        status: 'not_started',
        answers: {},
        tab_violations: 0,
        ip_address: `192.168.1.${100 + (st.id % 100)}`,
      };

      const userAnswers = studentAnswersStore[sessionKey] || studentAnswersStore[st.id] || sess.answers || {};
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
      const extraMinutesKey = `${curSchedule.id}_${st.id}`;
      const schExtra = scheduleExtraMinutes[curSchedule.id] || 0;
      const stExtra = studentExtraMinutes[extraMinutesKey] || studentExtraMinutes[st.id] || 0;

      return {
        id: st.id,
        username: st.username,
        full_name: st.full_name,
        class_name: st.class_name,
        nisn: st.nisn || '',
        nis: st.nis || '',
        exam_no: st.exam_no || '',
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
        extra_minutes: schExtra + stExtra,
        answers: userAnswers,
      };
    });

    return sendJSON(200, {
      status: 'success',
      data: result,
      schedule: {
        id: curSchedule.id,
        title: curSchedule.title,
        bank_name: curSchedule.bank_name,
        duration_minutes: curSchedule.duration_minutes,
        token_code: curSchedule.token_code,
        token_type: curSchedule.token_type || 'static',
        token_interval: curSchedule.token_interval || 15,
        seconds_left: updateScheduleDynamicToken(curSchedule)?.seconds_left ?? null,
        start_time: curSchedule.start_time,
        class_target: curSchedule.class_target,
        is_active: curSchedule.is_active !== false,
      },
      questions: QUESTIONS.map((q) => ({
        id: q.id,
        stem: q.stem,
        options: q.options,
        weight: q.weight,
        cog: q.cog,
      })),
      answer_keys: answerKeys,
      school_profile: schoolProfile,
      schedules: SCHEDULES.map((s) => {
        const tInfo = updateScheduleDynamicToken(s);
        return {
          id: s.id,
          title: s.title,
          token_code: s.token_code,
          token_type: s.token_type || 'static',
          token_interval: s.token_interval || 15,
          seconds_left: tInfo ? tInfo.seconds_left : null,
          duration_minutes: s.duration_minutes,
          bank_name: s.bank_name,
          is_active: s.is_active !== false,
          start_time: s.start_time,
          class_target: s.class_target,
        };
      }),
      classes: Array.from(new Set(USERS.filter(u => u.role === 'student').map(u => u.class_name || 'Tanpa Kelas'))),
      class_counts: USERS.filter(u => u.role === 'student').reduce((acc, u) => {
        const c = u.class_name || 'Tanpa Kelas';
        acc[c] = (acc[c] || 0) + 1;
        return acc;
      }, {}),
      total_students: USERS.filter(u => u.role === 'student').length,
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
    const schId = parseInt(body.schedule_id, 10) || 1;
    const curSch = SCHEDULES.find((s) => s.id === schId) || SCHEDULES[0];

    if (target === 'all') {
      scheduleExtraMinutes[curSch.id] = (scheduleExtraMinutes[curSch.id] || 0) + minutes;
      return sendJSON(200, {
        status: 'success',
        message: `Waktu ujian ${curSch.title} untuk seluruh siswa berhasil ditambah +${minutes} menit! (${reason})`,
        extra_minutes: scheduleExtraMinutes[curSch.id],
        target: 'all',
      });
    } else {
      const targetUser = USERS.find((u) => u.username === username);
      const uid = targetUser ? targetUser.id : 1001;
      const key = `${curSch.id}_${uid}`;
      studentExtraMinutes[key] = (studentExtraMinutes[key] || 0) + minutes;

      return sendJSON(200, {
        status: 'success',
        message: `Waktu ujian untuk ${username} (${targetUser?.full_name || 'Siswa'}) pada ${curSch.title} berhasil ditambah +${minutes} menit! (${reason})`,
        extra_minutes: (scheduleExtraMinutes[curSch.id] || 0) + studentExtraMinutes[key],
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
    const schId = parseInt(body.schedule_id, 10) || 1;
    const curSch = SCHEDULES.find((s) => s.id === schId) || SCHEDULES[0];
    const sessionKey = `${curSch.id}_${uid}`;

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
      answers: studentAnswersStore[sessionKey] || studentAnswersStore[uid] || {},
    };
    activeExamStudents.delete(uid);

    return sendJSON(200, {
      status: 'success',
      message: `Ujian ${studentUsername} pada jadwal "${curSch.title}" telah dikunci permanen oleh proktor!`,
      submitted_at: formattedDate,
    });
  }

  // POST /api/v1/cbt/proctor/reset-session (Reset oleh Proktor / Guru)
  if (pathname === '/api/v1/cbt/proctor/reset-session' && req.method === 'POST') {
    const body = await parseBody(req);
    const studentUsername = body.username || 'siswa_1001';
    const resetType = body.reset_type || 'full';
    const schId = parseInt(body.schedule_id, 10) || 1;
    const curSch = SCHEDULES.find((s) => s.id === schId) || SCHEDULES[0];
    const targetUser = USERS.find((u) => u.username === studentUsername);
    const uid = targetUser ? targetUser.id : 1001;
    const sessionKey = `${curSch.id}_${uid}`;

    if (resetType === 'login_only') {
      if (studentSessions[sessionKey]) {
        studentSessions[sessionKey].status = 'in_progress';
        studentSessions[sessionKey].submitted_at = null;
      }
      activeExamStudents.delete(uid);
      return sendJSON(200, {
        status: 'success',
        message: `Reset Login berhasil! Siswa ${studentUsername} diizinkan login kembali pada "${curSch.title}" (jawaban tersimpan).`,
      });
    }

    delete studentSessions[sessionKey];
    delete studentAnswersStore[sessionKey];
    activeExamStudents.delete(uid);

    return sendJSON(200, {
      status: 'success',
      message: `Sesi ujian ${studentUsername} pada "${curSch.title}" berhasil direset penuh! Siswa dapat mengerjakan kembali dari awal.`,
    });
  }

  // POST /api/v1/cbt/proctor/bulk-reset (Reset Sesi Siswa Secara Massal / Bulk)
  if (pathname === '/api/v1/cbt/proctor/bulk-reset' && req.method === 'POST') {
    const body = await parseBody(req);
    const targetType = body.target_type || 'selected'; // 'selected', 'class', 'all'
    const resetType = body.reset_type || 'full'; // 'login_only' or 'full'
    const usernames = Array.isArray(body.usernames) ? body.usernames : [];
    const className = body.class_name;
    const statusFilter = body.status_filter || 'all'; // 'all', 'submitted', 'in_progress'
    const schId = parseInt(body.schedule_id, 10) || 1;
    const curSch = SCHEDULES.find((s) => s.id === schId) || SCHEDULES[0];

    let targetStudents = USERS.filter((u) => u.role === 'student');

    if (targetType === 'selected') {
      if (usernames.length === 0) {
        return sendJSON(400, { status: 'error', message: 'Daftar siswa yang dipilih masih kosong!' });
      }
      const uSet = new Set(usernames);
      targetStudents = targetStudents.filter((u) => uSet.has(u.username));
    } else if (targetType === 'class') {
      if (className && className !== 'all') {
        targetStudents = targetStudents.filter((u) => u.class_name === className);
      }
    }

    // Filter status jika dipilih
    if (statusFilter !== 'all') {
      targetStudents = targetStudents.filter((u) => {
        const sessionKey = `${curSch.id}_${u.id}`;
        const sess = studentSessions[sessionKey];
        const status = sess ? sess.status : 'not_started';
        return status === statusFilter;
      });
    }

    if (targetStudents.length === 0) {
      return sendJSON(400, {
        status: 'error',
        message: 'Tidak ada sesi siswa yang cocok dengan kriteria filter untuk direset.',
      });
    }

    let count = 0;
    for (const st of targetStudents) {
      const uid = st.id;
      const sessionKey = `${curSch.id}_${uid}`;

      if (resetType === 'login_only') {
        if (studentSessions[sessionKey]) {
          studentSessions[sessionKey].status = 'in_progress';
          studentSessions[sessionKey].submitted_at = null;
        } else {
          studentSessions[sessionKey] = {
            status: 'in_progress',
            started_at: new Date().toISOString(),
            answers: studentAnswersStore[sessionKey] || studentAnswersStore[uid] || {},
          };
        }
        activeExamStudents.delete(uid);
        count++;
      } else {
        delete studentSessions[sessionKey];
        delete studentAnswersStore[sessionKey];
        activeExamStudents.delete(uid);
        count++;
      }
    }

    const typeDesc = resetType === 'login_only' ? 'Reset Login (Jawaban aman)' : 'Reset Penuh (Ulang dari awal)';
    return sendJSON(200, {
      status: 'success',
      message: `Berhasil mereset ${count} sesi siswa pada "${curSch.title}" (${typeDesc})!`,
      reset_count: count,
      reset_type: resetType,
      schedule_title: curSch.title,
    });
  }

  // POST /api/v1/cbt/proctor/bulk-force-finish (Kunci Selesai Massal oleh Proktor)
  if (pathname === '/api/v1/cbt/proctor/bulk-force-finish' && req.method === 'POST') {
    const body = await parseBody(req);
    const usernames = Array.isArray(body.usernames) ? body.usernames : [];
    const schId = parseInt(body.schedule_id, 10) || 1;
    const curSch = SCHEDULES.find((s) => s.id === schId) || SCHEDULES[0];

    if (usernames.length === 0) {
      return sendJSON(400, { status: 'error', message: 'Daftar siswa belum ditentukan!' });
    }

    const now = new Date();
    const formattedDate = now.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }) + ' ' + now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' WIB';

    let count = 0;
    for (const u of usernames) {
      const targetUser = USERS.find((us) => us.username === u);
      if (targetUser) {
        const uid = targetUser.id;
        const sessionKey = `${curSch.id}_${uid}`;
        studentSessions[sessionKey] = {
          ...(studentSessions[sessionKey] || {}),
          status: 'submitted',
          submitted_at: formattedDate,
          answers: studentAnswersStore[sessionKey] || studentAnswersStore[uid] || {},
        };
        activeExamStudents.delete(uid);
        count++;
      }
    }

    return sendJSON(200, {
      status: 'success',
      message: `${count} sesi siswa pada "${curSch.title}" berhasil dikunci selesai oleh proktor!`,
      count: count,
      schedule_title: curSch.title,
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
