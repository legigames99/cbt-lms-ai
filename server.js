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

// Load .env jika tersedia untuk konfigurasi kredensial Gemini Server (Admin)
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
    envLines.forEach(l => {
      const match = l.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let val = (match[2] || '').trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
      }
    });
  }
} catch (e) {}

// Konfigurasi Global AI Server
const SERVER_CONFIG = {
  gemini_api_key: process.env.GEMINI_API_KEY || process.env.AI_API_KEY || '',
  default_model: process.env.AI_MODEL || 'gemini-3.5-flash',
};

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
// ==============================================================
// PERSISTENSI MASTER MATA PELAJARAN (subjects.json)
// ==============================================================
const SUBJECTS_FILE = path.join(__dirname, 'subjects.json');
let MASTER_SUBJECTS = [];

function saveSubjectsToFile() {
  try {
    fs.writeFileSync(SUBJECTS_FILE, JSON.stringify(MASTER_SUBJECTS, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save subjects.json:', e.message);
  }
}

function loadSubjectsFromFile() {
  try {
    if (fs.existsSync(SUBJECTS_FILE)) {
      MASTER_SUBJECTS = JSON.parse(fs.readFileSync(SUBJECTS_FILE, 'utf8'));
      if (Array.isArray(MASTER_SUBJECTS)) {
        console.log(`[Master Data] Memuat ${MASTER_SUBJECTS.length} mata pelajaran dari subjects.json`);
        return;
      }
    }
  } catch (e) {
    console.error('Failed to load subjects.json:', e.message);
  }
}
loadSubjectsFromFile();

// ==============================================================
// PERSISTENSI MASTER DATA KELAS & ROMBEL (classes.json)
// ==============================================================
const CLASSES_FILE = path.join(__dirname, 'classes.json');
let MASTER_CLASSES = [];

function saveClassesToFile() {
  try {
    fs.writeFileSync(CLASSES_FILE, JSON.stringify(MASTER_CLASSES, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save classes.json:', e.message);
  }
}

function loadClassesFromFile() {
  try {
    if (fs.existsSync(CLASSES_FILE)) {
      MASTER_CLASSES = JSON.parse(fs.readFileSync(CLASSES_FILE, 'utf8'));
      if (Array.isArray(MASTER_CLASSES)) {
        console.log(`[Master Data] Memuat ${MASTER_CLASSES.length} kelas dari classes.json`);
        return;
      }
    }
  } catch (e) {
    console.error('Failed to load classes.json:', e.message);
  }
}
loadClassesFromFile();

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

// ==============================================================
// SANITASI & NORMALISASI STRUKTUR ASESMEN (STANDAR TKA & AI GENERATOR)
// ==============================================================

function sanitizeQuestionText(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/pada\s+tingkat\s+kognitif\s*C?[1-6]?,?\s*/gi, '')
    .replace(/berdasarkan\s+prinsip\s+dasar\s+ilmu\s+pada\s+tingkat\s+kognitif\s*C?[1-6]?,?\s*/gi, 'Berdasarkan analisis prinsip ilmu tersebut, ')
    .replace(/berdasarkan\s+tingkat\s+kognitif\s*C?[1-6]?,?\s*/gi, '')
    .replace(/\(level\s+kognitif:?\s*C[1-6]\)/gi, '')
    .replace(/\[\s*tingkat\s+kognitif:?\s*C[1-6]\s*\]/gi, '')
    .replace(/\bLevel\s+kognitif\s+C[1-6]\b:?\s*/gi, '')
    .replace(/\bLevel\s+C[1-6]\b:?\s*/gi, '')
    .replace(/\btingkat\s+kognitif\s+C[1-6]\b/gi, 'analisis mendalam')
    .replace(/\bC[1-6]\s*-\s*(Mengingat|Memahami|Menerapkan|Menganalisis|Mengevaluasi|Mencipta)/gi, '$1')
    .replace(/(\s)\s+/g, '$1')
    .trim();
}

// Normalisasi & Perbaikan Struktur Opsi Asesmen (Mencegah bug character-spread undefinedundefined)
function normalizeQuestionOptions(rawOptions) {
  if (!rawOptions) return null;
  const defaultLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  let list = [];

  if (Array.isArray(rawOptions)) {
    list = rawOptions;
  } else if (typeof rawOptions === 'object') {
    list = Object.keys(rawOptions).map(k => {
      return { id: k.toUpperCase(), text: rawOptions[k] };
    });
  }

  if (list.length === 0) return null;

  return list.map((opt, idx) => {
    const fallbackId = defaultLetters[idx] || String.fromCharCode(65 + idx);

    // Kasus 1: opt adalah string murni (misal ["Mempercepat...", "Meningkatkan..."])
    if (typeof opt === 'string') {
      let text = opt.trim();
      let id = fallbackId;
      const match = text.match(/^([A-Ha-h])[\.\)\:\s\-]+([\s\S]*)$/);
      if (match) {
        id = match[1].toUpperCase();
        text = match[2].trim();
      }
      return { id, text: sanitizeQuestionText(text) };
    }

    // Kasus 2: opt adalah objek karakter yang rusak akibat spreading string ({ '0': 'M', '1': 'e', ... })
    if (opt && typeof opt === 'object') {
      if (opt.text === undefined && (opt['0'] !== undefined || opt[0] !== undefined)) {
        let str = '';
        let i = 0;
        while (opt[i] !== undefined || opt[String(i)] !== undefined) {
          str += (opt[i] !== undefined ? opt[i] : opt[String(i)]);
          i++;
        }
        let text = str.trim();
        let id = opt.id || fallbackId;
        const match = text.match(/^([A-Ha-h])[\.\)\:\s\-]+([\s\S]*)$/);
        if (match) {
          id = match[1].toUpperCase();
          text = match[2].trim();
        }
        return { id: String(id).toUpperCase(), text: sanitizeQuestionText(text) };
      }

      // Kasus 3: opt adalah objek normal { id, text }, { label, value }, dll.
      let id = opt.id || opt.key || opt.label || opt.option || fallbackId;
      let rawText = opt.text !== undefined ? opt.text : (opt.value || opt.content || opt.desc || opt.description || '');
      if (typeof rawText !== 'string') rawText = String(rawText || '');
      let text = rawText.trim();

      const match = text.match(/^([A-Ha-h])[\.\)\:\s\-]+([\s\S]*)$/);
      if (match && match[1].toUpperCase() === String(id).toUpperCase()) {
        text = match[2].trim();
      }

      return {
        id: String(id).toUpperCase(),
        text: sanitizeQuestionText(text)
      };
    }

    return { id: fallbackId, text: sanitizeQuestionText(String(opt || '')) };
  });
}

function normalizeStatements(rawStatements) {
  if (!rawStatements || !Array.isArray(rawStatements)) return null;
  return rawStatements.map((st, idx) => {
    if (typeof st === 'string') {
      return { id: idx, text: sanitizeQuestionText(st.trim()), key: 'B' };
    }
    if (st && typeof st === 'object') {
      let text = st.text !== undefined ? st.text : (st.statement || st.value || '');
      if (text === undefined && (st['0'] !== undefined || st[0] !== undefined)) {
        let str = '';
        let i = 0;
        while (st[i] !== undefined || st[String(i)] !== undefined) {
          str += (st[i] !== undefined ? st[i] : st[String(i)]);
          i++;
        }
        text = str;
      }
      let key = (st.key || 'B').toString().toUpperCase().trim();
      if (key.startsWith('B') || key === 'TRUE' || key === '1') key = 'B';
      else key = 'S';
      return {
        id: st.id !== undefined ? st.id : idx,
        text: sanitizeQuestionText(String(text || '').trim()),
        key
      };
    }
    return { id: idx, text: sanitizeQuestionText(String(st || '')), key: 'B' };
  });
}

function normalizePremises(rawPremises) {
  if (!rawPremises || !Array.isArray(rawPremises)) return null;
  return rawPremises.map((p, idx) => {
    if (typeof p === 'string') {
      return { id: idx, text: sanitizeQuestionText(p.trim()) };
    }
    if (p && typeof p === 'object') {
      let text = p.text !== undefined ? p.text : (p.premise || p.value || '');
      return {
        id: p.id !== undefined ? p.id : idx,
        text: sanitizeQuestionText(String(text || '').trim())
      };
    }
    return { id: idx, text: sanitizeQuestionText(String(p || '')) };
  });
}

function normalizeTargets(rawTargets) {
  if (!rawTargets || !Array.isArray(rawTargets)) return null;
  const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  return rawTargets.map((t, idx) => {
    const fallbackId = letters[idx] || String.fromCharCode(65 + idx);
    if (typeof t === 'string') {
      return { id: fallbackId, text: sanitizeQuestionText(t.trim()) };
    }
    if (t && typeof t === 'object') {
      let id = t.id || fallbackId;
      let text = t.text !== undefined ? t.text : (t.target || t.value || '');
      return {
        id: String(id).toUpperCase(),
        text: sanitizeQuestionText(String(text || '').trim())
      };
    }
    return { id: fallbackId, text: sanitizeQuestionText(String(t || '')) };
  });
}

function repairCorruptedQuestionBanks(banks) {
  let repairedCount = 0;
  if (!Array.isArray(banks)) return repairedCount;
  banks.forEach(b => {
    (b.questions || []).forEach(q => {
      if (q.type === 'mcq' || q.type === 'mcq_complex') {
        if (q.options && Array.isArray(q.options)) {
          let needsRepair = false;
          q.options.forEach(o => {
            if (o['0'] !== undefined || o.text === undefined || !o.id) needsRepair = true;
          });
          if (needsRepair) {
            q.options = normalizeQuestionOptions(q.options);
            repairedCount++;
          }
        }
      }
    });
  });
  return repairedCount;
}

// Master Questions & Bank Soal (Mendukung Standar TKA SMA/SMK, ANBK, AKM)
const QUESTION_BANKS_FILE = path.join(__dirname, 'question_banks.json');
let QUESTION_BANKS = [];

if (fs.existsSync(QUESTION_BANKS_FILE)) {
  try {
    const raw = fs.readFileSync(QUESTION_BANKS_FILE, 'utf8');
    QUESTION_BANKS = JSON.parse(raw);
    const repaired = repairCorruptedQuestionBanks(QUESTION_BANKS);
    if (repaired > 0) {
      console.log(`[Bank Soal] Berhasil memulihkan ${repaired} butir soal yang opsi jawabannya terkorupsi!`);
      saveQuestionBanksToFile();
    }
    console.log(`[Bank Soal] Berhasil memuat ${QUESTION_BANKS.length} bank soal dari question_banks.json`);
  } catch (err) {
    console.error('[Bank Soal] Gagal membaca question_banks.json, menggunakan fallback:', err.message);
  }
}

function saveQuestionBanksToFile() {
  try {
    fs.writeFileSync(QUESTION_BANKS_FILE, JSON.stringify(QUESTION_BANKS, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save question_banks.json:', e.message);
  }
}

// Helper: Mengambil butir soal yang sesuai untuk suatu jadwal ujian
function getQuestionsForSchedule(sch) {
  if (!sch) return (QUESTION_BANKS[0] && QUESTION_BANKS[0].questions) ? QUESTION_BANKS[0].questions : [];
  if (sch.bank_name) {
    const bName = sch.bank_name.toLowerCase();
    const found = QUESTION_BANKS.find(b => 
      bName.includes(b.title.toLowerCase()) || 
      bName.includes(b.subject.toLowerCase()) ||
      b.title.toLowerCase().includes(bName)
    );
    if (found && found.questions && found.questions.length > 0) return found.questions;
  }
  return (QUESTION_BANKS[0] && QUESTION_BANKS[0].questions) ? QUESTION_BANKS[0].questions : [];
}

// Master Questions untuk kompatibilitas bawaan
const QUESTIONS = (QUESTION_BANKS[0] && QUESTION_BANKS[0].questions) ? QUESTION_BANKS[0].questions : [
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
    answer: 'C',
    weight: 1.0,
  }
];

// ==============================================================
// AI ESSAY CORRECTION ENGINE (Asistensi Koreksi Esai Cerdas & Pedagogis)
// ==============================================================
function gradeEssayWithAI({ question_stem, rubric, ideal_answer, student_answer, keywords = [], max_score = 100 }) {
  const ans = (student_answer || '').trim();
  const maxScore = Number(max_score) || 100;

  if (!ans || ans.length < 5) {
    return {
      score: 0,
      max_score: maxScore,
      grade_letter: 'E',
      grade_percentage: 0,
      feedback: 'Lembar jawaban esai kosong atau terlalu singkat untuk dapat dianalisis AI.',
      analysis: {
        keywords_matched: [],
        keywords_missing: keywords || [],
        word_count: 0,
        strengths: ['Belum ada teks substansi jawaban yang dapat dievaluasi.'],
        suggestions: ['Tuliskan uraian argumen lengkap sesuai rubrik dan instruksi soal.']
      }
    };
  }

  const ansLower = ans.toLowerCase();
  const matchedKeywords = [];
  const missingKeywords = [];

  // 1. Ekstraksi dan evaluasi kata kunci konsep utama
  const effectiveKeywords = Array.isArray(keywords) && keywords.length > 0 
    ? keywords 
    : ['prinsip', 'proses', 'analisis', 'hukum', 'sistem', 'reaksi', 'metode'];

  for (const kw of effectiveKeywords) {
    const cleanKw = String(kw).trim().toLowerCase();
    if (!cleanKw) continue;
    if (ansLower.includes(cleanKw)) {
      matchedKeywords.push(kw);
    } else {
      missingKeywords.push(kw);
    }
  }

  // 2. Evaluasi Kedalaman & Kepadatan Argumen (Word Count)
  const words = ans.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  let lengthFactor = 1.0;
  if (wordCount < 10) lengthFactor = 0.35;
  else if (wordCount < 25) lengthFactor = 0.60;
  else if (wordCount < 45) lengthFactor = 0.85;
  else lengthFactor = 1.0;

  // 3. Evaluasi Indikator Penalaran & Koherensi Logika Ilmiah
  const reasoningTerms = [
    'karena', 'sehingga', 'berdasarkan', 'akibatnya', 'menghasilkan',
    'oleh karena itu', 'prinsip', 'proses', 'menyebabkan', 'fungsi',
    'artinya', 'yaitu', 'merupakan', 'hubungan', 'dapat disimpulkan', 'melalui'
  ];
  const reasoningHits = reasoningTerms.filter(t => ansLower.includes(t)).length;
  const reasoningScore = Math.min(1.0, 0.45 + (reasoningHits * 0.15));

  // 4. Hitung Rasio Kecocokan Konsep
  const keywordRatio = effectiveKeywords.length > 0 
    ? (matchedKeywords.length / effectiveKeywords.length)
    : 0.85;

  // 5. Pembobotan Skor Total (0 - 100)
  // Bobot: Pemenuhan Konsep Kunci (50%) + Kedalaman Uraian (30%) + Alur Penalaran (20%)
  const rawPercentage = (keywordRatio * 0.50) + (lengthFactor * 0.30) + (reasoningScore * 0.20);
  let finalScore = Math.round(rawPercentage * maxScore);
  finalScore = Math.max(15, Math.min(maxScore, finalScore));

  // 6. Penentuan Huruf Mutu (Grade)
  let gradeLetter = 'C';
  if (finalScore >= 85) gradeLetter = 'A';
  else if (finalScore >= 75) gradeLetter = 'B';
  else if (finalScore >= 60) gradeLetter = 'C';
  else if (finalScore >= 45) gradeLetter = 'D';
  else gradeLetter = 'E';

  // 7. Generasi Ulasan Kekuatan & Rekomendasi Pedagogis
  const strengths = [];
  if (matchedKeywords.length > 0) {
    strengths.push(`Tepat menyertakan konsep esensial: ${matchedKeywords.slice(0, 4).join(', ')}.`);
  }
  if (wordCount >= 35) {
    strengths.push('Uraian argumentasi memiliki kedalaman deskripsi dan penjelasan yang runtut.');
  }
  if (reasoningHits >= 2) {
    strengths.push('Alur pemikiran menunjukkan hubungan sebab-akibat ilmiah yang logis.');
  }
  if (strengths.length === 0) {
    strengths.push('Siswa mencoba menjawab esai dengan pemahaman awal yang baik.');
  }

  const suggestions = [];
  if (missingKeywords.length > 0) {
    suggestions.push(`Dapat diperkaya dengan mengulas konsep: ${missingKeywords.slice(0, 3).join(', ')}.`);
  }
  if (wordCount < 30) {
    suggestions.push('Disarankan memperdalam uraian dengan memberikan rincian mekanisme atau rumus pendukung.');
  }
  if (finalScore < 75) {
    suggestions.push('Pelajari kembali rubrik materi dan gunakan peristilahan ilmiah baku.');
  } else {
    suggestions.push('Pertahankan ketajaman analisis dan gaya penulisan ilmiah yang sudah sangat baik!');
  }

  const feedback = `Skor AI: ${finalScore}/${maxScore} (${gradeLetter}). ${strengths.join(' ')} ${suggestions.join(' ')}`;

  return {
    score: finalScore,
    max_score: maxScore,
    grade_letter: gradeLetter,
    grade_percentage: Math.round((finalScore / maxScore) * 100),
    feedback: feedback,
    analysis: {
      keywords_matched: matchedKeywords,
      keywords_missing: missingKeywords,
      word_count: wordCount,
      strengths: strengths,
      suggestions: suggestions
    }
  };
}

// ==============================================================
// AI QUESTION GENERATOR ENGINE (GEMINI FLASH SERIES & BYOK TKA)
// Bebas C2/C3/C4, Berdasarkan Materi/CP/TP, & Anti-Duplikasi
// ==============================================================

function safeParseQuestionsJSON(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;
  const BT3 = String.fromCharCode(96).repeat(3);
  let cleaned = rawText.split(BT3 + 'json').join('').split(BT3).join('').trim();

  // Ekstrak blok array [...] jika ada teks intro/outro dari AI
  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');
  let arraySlice = '';
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    arraySlice = cleaned.substring(firstBracket, lastBracket + 1);
  }

  // Percobaan 1: Parse arraySlice atau cleaned langsung
  const targets = [arraySlice, cleaned].filter(Boolean);
  for (const t of targets) {
    try {
      const parsed = JSON.parse(t);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      if (parsed.questions && Array.isArray(parsed.questions) && parsed.questions.length > 0) return parsed.questions;
      if (parsed.soal && Array.isArray(parsed.soal) && parsed.soal.length > 0) return parsed.soal;
      if (parsed.data && Array.isArray(parsed.data) && parsed.data.length > 0) return parsed.data;
    } catch (e1) {}
  }

  // Percobaan 2: Sanitasi kontrol karakter ilegal di dalam string JSON
  for (const t of targets) {
    try {
      const sanitized = t.replace(/[\u0000-\u0009\u000B\u000C\u000E-\u001F]/g, '');
      const parsed = JSON.parse(sanitized);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      if (parsed.questions && Array.isArray(parsed.questions)) return parsed.questions;
      if (parsed.soal && Array.isArray(parsed.soal)) return parsed.soal;
    } catch (e2) {}
  }

  // Percobaan 3: Repair jika output terpotong di akhir (truncated JSON)
  const baseForRepair = arraySlice || cleaned;
  const lastBrace = baseForRepair.lastIndexOf('}');
  if (lastBrace !== -1) {
    const firstBrace = baseForRepair.indexOf('{');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const trimmed = '[' + baseForRepair.substring(firstBrace, lastBrace + 1) + ']';
      try {
        const repaired = JSON.parse(trimmed);
        if (Array.isArray(repaired) && repaired.length > 0) {
          console.log(`[Gemini AI] JSON dipulihkan (repaired truncated): Berhasil menyelamatkan ${repaired.length} butir soal lengkap!`);
          return repaired;
        }
      } catch (err3) {}
    }
  }

  // Percobaan 4: Ekstraksi objek individu satu per satu dengan regex
  try {
    const itemMatches = cleaned.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g);
    if (itemMatches && itemMatches.length > 0) {
      const recovered = [];
      for (const itemStr of itemMatches) {
        try {
          const item = JSON.parse(itemStr);
          if (item && (item.stem || item.type || item.options)) {
            recovered.push(item);
          }
        } catch (itemErr) {}
      }
      if (recovered.length > 0) {
        console.log(`[Gemini AI] JSON dipulihkan parsial via regex item extractor: ${recovered.length} butir soal berhasil diselamatkan!`);
        return recovered;
      }
    }
  } catch (err4) {}

  return null;
}

function executeSingleGeminiRequest(endpointModel, apiKey, payloadJson, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const req = https.request("https://generativelanguage.googleapis.com/v1beta/models/" + endpointModel + ":generateContent?key=" + encodeURIComponent(apiKey), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payloadJson)
      },
      timeout: timeoutMs
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const parsed = JSON.parse(data);
            const rawText = parsed.candidates && parsed.candidates[0] && parsed.candidates[0].content && parsed.candidates[0].content.parts && parsed.candidates[0].content.parts[0] ? parsed.candidates[0].content.parts[0].text : '';
            const questions = safeParseQuestionsJSON(rawText);
            if (questions && Array.isArray(questions) && questions.length > 0) {
              return resolve(questions);
            }
            console.warn(`[Gemini AI] Parsing gagal pada output model ${endpointModel} (${rawText ? rawText.length : 0} bytes). Snippet: ${(rawText || '').substring(0, 120)}...`);
            return reject(new Error("Format output JSON tidak dapat diparsing"));
          }
          reject(new Error("Gemini API HTTP " + res.statusCode + ": " + data.substring(0, 160)));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Koneksi ke Gemini API (${endpointModel}) timeout (${Math.round(timeoutMs/1000)}s)`)); });
    req.write(payloadJson);
    req.end();
  });
}

async function callGoogleGeminiAPI({ apiKey, model, basis_type = 'materi', basis_text = '', topic = '', question_type = 'all', cog_level = 'mixed', count = 5, custom_prompt = '', existing_stems = [] }) {
  let basisInstruction = '';
  if (basis_type === 'cp') {
    basisInstruction = "BASIS ACUAN ASESMEN: CAPAIAN PEMBELAJARAN (CP)\n"
      + "Deskripsi CP yang diuji: \"" + (basis_text || topic) + "\"\n"
      + "Instruksi Khusus CP: Bongkar Capaian Pembelajaran ini ke dalam indikator esensial, kompetensi operasional, dan alur penalaran kritis.";
  } else if (basis_type === 'tp') {
    basisInstruction = "BASIS ACUAN ASESMEN: TUJUAN PEMBELAJARAN (TP)\n"
      + "Deskripsi TP yang diuji: \"" + (basis_text || topic) + "\"\n"
      + "Instruksi Khusus TP: Setiap butir soal menguji ketercapaian Tujuan Pembelajaran tersebut secara terukur, aplikatif, dan detail.";
  } else {
    basisInstruction = "BASIS ACUAN ASESMEN: MATERI POKOK / SUB-TOPIK\n"
      + "Materi Pokok: \"" + (basis_text || topic) + "\"\n"
      + "Instruksi Khusus Materi: Susun butir soal yang menguji pemahaman konsep, analisis fenomena, dan aplikasi teknis/saintifik materi secara mendalam.";
  }

  let antiDuplicationPrompt = '';
  if (existing_stems && Array.isArray(existing_stems) && existing_stems.length > 0) {
    antiDuplicationPrompt = "\nPERINGATAN KERAS ANTI-DUPLIKASI:\n"
      + "Bank soal ini SUDAH MEMILIKI " + existing_stems.length + " butir soal berikut:\n"
      + existing_stems.slice(-12).map((s, idx) => '  [Soal ' + (idx + 1) + '] \"' + s + '\"').join('\n')
      + "\n\nATURAN ANTI-DUPLIKASI: Dilarang keras membuat soal yang serupa atau menguji sudut pandang yang sama dengan soal-soal di atas! Buat stimulus dan skenario baru!\n";
  }

  const cogGuides = {
    'C1': 'TARGET TINGKAT KOGNITIF: C1 (Mengingat / Knowledge). Pertanyaan berfokus pada pengenalan istilah dasar, definisi fungsi utama, dan pengenalan konsep tanpa penalaran berbelit-belit.',
    'C2': 'TARGET TINGKAT KOGNITIF: C2 (Memahami / Comprehension). Pertanyaan berfokus pada pemahaman konsep, alur prinsip kerja dasar, dan perbandingan fungsi yang mudah dipahami siswa sekolah.',
    'C3': 'TARGET TINGKAT KOGNITIF: C3 (Menerapkan / Application). Pertanyaan berfokus pada penerapan prosedur praktikum laboratorium sekolah dan penggunaan perintah/sintaks dasar yang umum dipelajari siswa.',
    'C4': 'TARGET TINGKAT KOGNITIF: C4 (Menganalisis / Analysis). Pertanyaan berupa analisis skenario praktikum terarah dan troubleshooting wajar setingkat siswa sekolah.',
    'C5': 'TARGET TINGKAT KOGNITIF: C5 (Mengevaluasi / Evaluation). Pertanyaan mengevaluasi pilihan solusi terbaik dalam skenario praktikum terarah.',
    'C6': 'TARGET TINGKAT KOGNITIF: C6 (Mencipta / Creation). Pertanyaan merancang langkah-langkah solusi atau konfigurasi sederhana.',
    'mixed': 'TARGET TINGKAT KOGNITIF: Variasi bertingkat seimbang dan realistis (dominan C2 Memahami & C3 Menerapkan praktikum sekolah, diselingi C4 Analisis terarah yang sesuai daya nalar siswa).'
  };
  const cogInstruction = cogGuides[cog_level] || cogGuides['mixed'];

  let teacherCustomSection = '';
  if (custom_prompt && custom_prompt.trim()) {
    teacherCustomSection = "\n======================================================\n"
      + "INSTRUKSI KHUSUS & TARGET SISWA DARI GURU (PRIORITAS TERTINGGI):\n"
      + "\"" + custom_prompt.trim() + "\"\n"
      + "PEDOMAN KETAT MENGENAI INSTRUKSI GURU DI ATAS:\n"
      + "1. Instruksi guru di atas MEMILIKI WEWENANG TERTINGGI (OVERRIDE). Wajib dipatuhi sepenuhnya!\n"
      + "2. Jika guru menyebut jenjang sasaran (misal: 'anak SMK kelas XI', 'SMA kelas X', 'Fase E/F', 'tingkat pemula/dasar/sedang'), TINGKAT KESULITAN WAJIB DITURUNKAN dan DISESUAIKAN agar realistis bagi siswa seusia tersebut.\n"
      + "3. DILARANG KERAS membuat soal yang terlalu rumit, setingkat insinyur senior/enterprise (seperti sintaks deprecation YAML sistem rilis terbaru, internal kernel/LVM lanjut, BGP/OSPF rumit, dsb.), KECUALI secara eksplisit diminta oleh guru.\n"
      + "4. Fokuskan materi pada silabus pembelajaran standar dan praktikum laboratorium yang biasa dipelajari siswa di sekolah.\n"
      + "======================================================\n";
  }

  const promptText = "Anda adalah pakar penyusun asesmen standar TKA (Tes Kemampuan Akademik) SMA/SMK dan Asesmen Nasional Pusmendik Kemdikbudristek.\n"
    + teacherCustomSection + "\n"
    + basisInstruction + "\n"
    + "Target Jumlah Soal: " + count + " butir soal.\n"
    + "Format Soal yang diminta: " + (question_type === 'all' ? 'Variasi format campuran TKA (mcq, mcq_complex, true_false, matching, short_essay, long_essay)' : question_type) + ".\n"
    + cogInstruction + "\n"
    + antiDuplicationPrompt + "\n"
    + "STANDAR KUALITAS SOAL TKA (TES KEMAMPUAN AKADEMIK & ASESMEN SEKOLAH):\n"
    + "1. KONTEKSTUAL & REALISTIS SESUAI TINGKAT PESERTA DIDIK:\n"
    + "   Sajikan skenario atau stimulus kontekstual yang relevan dengan modul ajar, kurikulum sekolah, atau praktikum laboratorium komputer/sains.\n"
    + "   Bahasa soal harus komunikatif, jelas, baku, dan mudah dicerna oleh siswa sekolah.\n"
    + "2. STIMULUS JELAS & EDUKATIF:\n"
    + "   Setiap butir soal dilengkapi stimulus pengantar yang terarah (bisa berupa skenario praktikum, cuplikan berkas konfigurasi/perintah di tag <code>, tabel data, atau deskripsi kasus singkat).\n"
    + "   Pertanyaan menguji pemahaman konsep, alur implementasi, atau analisis masalah secara terukur sesuai target kognitif siswa.\n"
    + "3. ATURAN BEBAS LABEL KOGNITIF (SANGAT KETAT):\n"
    + "   DILARANG KERAS MENCANTUMKAN KODE/LABEL 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'LOTS', 'HOTS', ATAU KATA 'TINGKAT KOGNITIF' DI DALAM TEKS PERTANYAAN (STEM), STIMULUS, MAUPUN OPSI JAWABAN! Pertanyaan harus murni bernada akademis, profesional, dan alami bagi siswa SMA/SMK.\n"
    + "4. KUNCI JAWABAN & PEMBAHASAN ANALITIS LENGKAP:\n"
    + "   Sertakan pembahasan edukatif yang runtut dan jelas, menjelaskan alasan kunci jawaban benar dan mengapa distraktor lainnya keliru dengan bahasa yang mendidik bagi siswa.\n\n"
    + "Format Output WAJIB berupa JSON array murni tanpa pembungkus markdown [ ... ].\n"
    + "STRUKTUR DATA JSON SPESIFIK BERDASARKAN TIPE SOAL (DILARANG TERTUKAR / DILARANG KOSONG):\n\n"
    + "1. JIKA TYPE 'mcq' (Pilihan Ganda Tunggal 5 Opsi):\n"
    + "   {\"type\": \"mcq\", \"cog\": \"" + (cog_level === 'mixed' ? 'C3' : cog_level) + "\", \"weight\": 1.0, \"stem\": \"stimulus HTML dan pertanyaan...\", \"options\": [{\"id\": \"A\", \"text\": \"...\"}, {\"id\": \"B\", \"text\": \"...\"}, {\"id\": \"C\", \"text\": \"...\"}, {\"id\": \"D\", \"text\": \"...\"}, {\"id\": \"E\", \"text\": \"...\"}], \"answer\": \"A\", \"explanation\": \"pembahasan edukatif detail...\"}\n\n"
    + "2. JIKA TYPE 'mcq_complex' (Pilihan Ganda Kompleks - Multi Jawaban Benar):\n"
    + "   {\"type\": \"mcq_complex\", \"cog\": \"" + (cog_level === 'mixed' ? 'C3' : cog_level) + "\", \"weight\": 1.5, \"stem\": \"stimulus HTML dan pertanyaan (Pilih semua jawaban yang benar)...\", \"options\": [{\"id\": \"A\", \"text\": \"...\"}, {\"id\": \"B\", \"text\": \"...\"}, {\"id\": \"C\", \"text\": \"...\"}, {\"id\": \"D\", \"text\": \"...\"}, {\"id\": \"E\", \"text\": \"...\"}], \"answer\": [\"A\", \"C\"], \"explanation\": \"pembahasan...\"}\n\n"
    + "3. JIKA TYPE 'true_false' (Pernyataan Matriks Benar / Salah):\n"
    + "   Setiap butir WAJIB memiliki minimal 3 pernyataan analitis teknis di array 'statements' lengkap dengan key 'B' atau 'S'!\n"
    + "   {\"type\": \"true_false\", \"cog\": \"" + (cog_level === 'mixed' ? 'C3' : cog_level) + "\", \"weight\": 1.5, \"stem\": \"stimulus HTML dan instruksi evaluasi kebenaran...\", \"statements\": [{\"id\": 0, \"text\": \"Pernyataan evaluasi spesifik 1...\", \"key\": \"B\"}, {\"id\": 1, \"text\": \"Pernyataan evaluasi spesifik 2...\", \"key\": \"S\"}, {\"id\": 2, \"text\": \"Pernyataan evaluasi spesifik 3...\", \"key\": \"B\"}], \"answer\": {\"0\": \"B\", \"1\": \"S\", \"2\": \"B\"}, \"explanation\": \"pembahasan rinci setiap pernyataan...\"}\n\n"
    + "4. JIKA TYPE 'matching' (Menjodohkan Premis Kiri dengan Target Kanan):\n"
    + "   Setiap butir WAJIB memiliki minimal 3-4 pasang konsep/parameter di 'premises' dan 'targets', TIDAK BOLEH bernilai kosong atau teks placeholder!\n"
    + "   {\"type\": \"matching\", \"cog\": \"" + (cog_level === 'mixed' ? 'C3' : cog_level) + "\", \"weight\": 2.0, \"stem\": \"Cocokkan parameter/istilah di sebelah kiri dengan fungsi/deskripsi di sebelah kanan:\", \"premises\": [{\"id\": 0, \"text\": \"Parameter / Istilah Teknis 1\"}, {\"id\": 1, \"text\": \"Parameter / Istilah Teknis 2\"}, {\"id\": 2, \"text\": \"Parameter / Istilah Teknis 3\"}], \"targets\": [{\"id\": \"A\", \"text\": \"Deskripsi atau Fungsi Solusi A\"}, {\"id\": \"B\", \"text\": \"Deskripsi atau Fungsi Solusi B\"}, {\"id\": \"C\", \"text\": \"Deskripsi atau Fungsi Solusi C\"}], \"answer\": {\"0\": \"A\", \"1\": \"B\", \"2\": \"C\"}, \"explanation\": \"pembahasan relasi pasangan benar...\"}\n\n"
    + "5. JIKA TYPE 'short_essay' (Isian Singkat):\n"
    + "   {\"type\": \"short_essay\", \"cog\": \"" + (cog_level === 'mixed' ? 'C2' : cog_level) + "\", \"weight\": 1.0, \"stem\": \"stimulus dan pertanyaan isian terarah...\", \"answer_keys\": [\"kata kunci utama\", \"sinonim istilah 2\"], \"explanation\": \"pembahasan...\"}\n\n"
    + "6. JIKA TYPE 'long_essay' (Uraian / Esai Komprehensif AI):\n"
    + "   {\"type\": \"long_essay\", \"cog\": \"" + (cog_level === 'mixed' ? 'C4' : cog_level) + "\", \"weight\": 3.0, \"stem\": \"stimulus skenario studi kasus dan instruksi uraian...\", \"rubric\": \"Kriteria penilaian rubrik berbobot (35% identifikasi, 35% analisis teknis, 30% solusi)...\", \"ideal_answer\": \"Uraian jawaban model komprehensif dan runtut...\", \"keywords\": [\"istilah1\", \"istilah2\", \"istilah3\"], \"max_score\": 100, \"explanation\": \"pembahasan intisari esai...\"}\n";

  const payload = JSON.stringify({
    contents: [{ parts: [{ text: promptText }] }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json'
    }
  });

  // Susun daftar model kandidat untuk Multi-Model Failover Otomatis (Cepat & Handal)
  const candidateModels = [];
  if (model) candidateModels.push(model);
  if (model !== 'gemini-3.5-flash-lite') candidateModels.push('gemini-3.5-flash-lite');
  if (model !== 'gemini-3.5-flash') candidateModels.push('gemini-3.5-flash');
  candidateModels.push('gemini-3.6-flash');
  const uniqueCandidates = [...new Set(candidateModels)];

  let lastError = null;
  for (let i = 0; i < uniqueCandidates.length; i++) {
    const tryModel = uniqueCandidates[i];
    // Model pertama dibatasi 12s, sedangkan model cadangan (failover) dibatasi 10s agar respon tetap cepat dan pengguna tidak menunggu lama
    const timeoutMs = (i === 0) ? 12000 : 10000;
    try {
      console.log(`[Gemini AI] Menghubungi Google Gemini API (${tryModel}, timeout ${Math.round(timeoutMs/1000)}s) - Basis: ${basis_type.toUpperCase()}...`);
      const questions = await executeSingleGeminiRequest(tryModel, apiKey, payload, timeoutMs);
      if (questions && Array.isArray(questions) && questions.length > 0) {
        console.log(`[Gemini AI] SUKSES! Berhasil mengunduh ${questions.length} butir soal HOTS dari Google Gemini API (${tryModel}).`);
        return { questions, usedModel: tryModel };
      }
    } catch (err) {
      lastError = err;
      console.warn(`[Gemini AI] Model ${tryModel} gagal (${err.message}). Mencoba kandidat failover berikutnya...`);
    }
  }

  throw (lastError || new Error("Semua model Gemini mengalami kendala jaringan."));
}

function generatePedagogicalTKAQuestions({ topic, basis_type = 'materi', basis_text = '', question_type = 'all', cog_level = 'mixed', count = 5, custom_prompt = '', modelUsed = 'gemini-3.5-flash', existingCount = 0 }) {
  const result = [];
  const types = ['mcq', 'mcq_complex', 'true_false', 'matching', 'short_essay', 'long_essay'];
  const bloomLevels = ['C2', 'C3', 'C4', 'C4', 'C5', 'C6'];

  const coreLabel = (basis_text && basis_text.trim()) ? basis_text.trim() : (topic || 'Kajian Asesmen Pembelajaran');

  const scenarios = [
    {
      domain: `Prinsip Fundamental & Konseptual: ${coreLabel}`,
      context: `konsep dasar dan prosedur implementasi ${coreLabel}`,
      mcqQuestion: `Dalam mengimplementasikan dan memahami secara mendalam materi <strong>${coreLabel}</strong>, manakah pernyataan atau langkah analisis teknis/konseptual berikut yang paling tepat dan esensial?`,
      mcqOptions: [
        { id: 'A', text: `Memahami seluruh prinsip fundamental, tahapan konfigurasi/penerapan, serta melakukan verifikasi hasil implementasi secara sistematis.` },
        { id: 'B', text: `Mengabaikan proses verifikasi dan validasi fungsionalitas setelah implementasi selesai dilakukan.` },
        { id: 'C', text: `Mengasumsikan bahwa seluruh parameter default sudah optimal tanpa perlu penyesuaian kebutuhan spesifik.` },
        { id: 'D', text: `Menghilangkan dokumentasi dan logging penanganan kendala teknis saat proses berjalan.` },
        { id: 'E', text: `Membatasi analisis hanya pada aspek teoritis tanpa mempertimbangkan implikasi praktis di lingkungan kerja.` }
      ],
      mcqAnswer: 'A',
      mcqExpl: `Pada materi ${coreLabel}, pemahaman terhadap konsep fundamental yang diikuti pengujian dan verifikasi bertahap adalah kunci utama keberhasilan implementasi yang terstandar.`
    },
    {
      domain: `Analisis Pemecahan Masalah & Troubleshooting: ${coreLabel}`,
      context: `diagnosis kendala, penanganan galat (error handling), dan optimasi ${coreLabel}`,
      mcqQuestion: `Apabila ditemukan kendala operasional atau ketidaksesuaian output saat menjalankan proses terkait <strong>${coreLabel}</strong>, langkah diagnostik awal yang paling efektif dan terarah adalah...`,
      mcqOptions: [
        { id: 'A', text: `Melakukan penelusuran log sistem secara cermat, memeriksa keabsahan konfigurasi parameter, dan menguji konektivitas/fungsionalitas layanan.` },
        { id: 'B', text: `Melakukan restart sistem secara berulang tanpa menganalisis pesan galat yang tercatat.` },
        { id: 'C', text: `Menghapus seluruh konfigurasi yang ada dan menggantinya dengan template acak tanpa pengujian.` },
        { id: 'D', text: `Membiarkan pesan error berjalan karena dianggap tidak memengaruhi performa keseluruhan.` },
        { id: 'E', text: `Menonaktifkan seluruh sistem proteksi dan izin akses agar proses dapat berjalan tanpa hambatan.` }
      ],
      mcqAnswer: 'A',
      mcqExpl: `Pemeriksaan catatan log sistem dan analisis parameter merupakan metode baku troubleshooting pada ${coreLabel} untuk mengidentifikasi akar permasalahan (root cause).`
    },
    {
      domain: `Verifikasi Kinerja & Validasi Operasional: ${coreLabel}`,
      context: `pengujian fungsionalitas, efisiensi, dan keandalan sistem ${coreLabel}`,
      mcqQuestion: `Tahap pembuktian atau pengujian fungsionalitas pada <strong>${coreLabel}</strong> dinyatakan berhasil secara valid apabila memenuhi kriteria berikut, yaitu...`,
      mcqOptions: [
        { id: 'A', text: `Layanan/konsep memberikan respon sesuai parameter spesifikasi yang ditentukan dan terverifikasi secara valid pada sisi klien/pengguna.` },
        { id: 'B', text: `Layanan hanya aktif sementara dan berhenti ketika ada permintaan proses dari pengguna lain.` },
        { id: 'C', text: `Terjadi konflik alokasi sumber daya yang tidak dapat diselesaikan oleh sistem secara otomatis.` },
        { id: 'D', text: `Tidak ada data atau respons yang dihasilkan dalam rentang waktu toleransi standar.` },
        { id: 'E', text: `Pengujian hanya dilakukan pada satu skenario keberhasilan tanpa menguji skenario batas (boundary case).` }
      ],
      mcqAnswer: 'A',
      mcqExpl: `Keberhasilan verifikasi ${coreLabel} dinilai dari tercapainya spesifikasi fungsional dan keabsahan respons layanan kepada pengguna.`
    }
  ];

  for (let i = 0; i < count; i++) {
    let qType = question_type;
    if (qType === 'all') {
      qType = types[i % types.length];
    }
    const cog = (cog_level && cog_level !== 'mixed') ? cog_level : bloomLevels[(existingCount + i) % bloomLevels.length];
    const scenarioIdx = (existingCount + i) % scenarios.length;
    const sc = scenarios[scenarioIdx];

    let newQ = {
      type: qType,
      cog: cog,
      generated_by: modelUsed,
    };

    switch (qType) {
      case 'mcq':
        newQ.stem = "<p>" + sc.mcqQuestion + "</p>";
        newQ.options = sc.mcqOptions;
        newQ.answer = sc.mcqAnswer;
        newQ.weight = 1.0;
        newQ.explanation = sc.mcqExpl;
        break;

      case 'mcq_complex':
        newQ.stem = "<p>Terkait <strong>" + coreLabel + "</strong>, perhatikan pernyataan-pernyataan analitis berikut!<br><strong>Pilihlah SEMUA pernyataan yang BENAR!</strong> <em>(Jawaban benar dapat lebih dari satu)</em></p>";
        newQ.options = [
          { id: 'A', text: "Pemahaman struktur konfigurasi dan parameter kunci merupakan prasyarat mutlak keberhasilan implementasi." },
          { id: 'B', text: "Pengujian verifikasi pada sisi pengguna/klien membuktikan bahwa layanan telah aktif dan merespons secara akurat." },
          { id: 'C', text: "Pencatatan log transaksi dan penanganan galat mempermudah pemeliharaan jangka panjang." },
          { id: 'D', text: "Tidak diperlukan tahapan pengujian apabila konfigurasi telah diselesaikan tanpa pesan kesalahan sintaksis." },
          { id: 'E', text: "Pengaturan dapat diterapkan tanpa memperhatikan kompatibilitas arsitektur sistem operasi target." }
        ];
        newQ.answer = ['A', 'B', 'C'];
        newQ.weight = 1.5;
        newQ.explanation = "Pernyataan A, B, dan C benar secara pedagogis dan prosedural. Pernyataan D salah (pengujian wajib). Pernyataan E salah (kompatibilitas mutlak diperhatikan).";
        break;

      case 'true_false':
        newQ.stem = "<p>Berdasarkan kajian teknis mengenai <strong>" + coreLabel + "</strong>, tentukan nilai kebenaran <strong>Benar (B)</strong> atau <strong>Salah (S)</strong> untuk setiap pernyataan evaluasi parameter berikut:</p>";
        newQ.statements = [
          { id: 0, text: "Konfigurasi yang tepat harus diikuti dengan restart/reload layanan agar perubahan parameter diterapkan oleh sistem.", key: 'B' },
          { id: 1, text: "Pengujian pada sisi klien tidak diperlukan apabila status layanan pada server telah aktif (running).", key: 'S' },
          { id: 2, text: "Pemeriksaan log berkala merupakan prosedur standar untuk memastikan stabilitas dan mendeteksi anomali operasional.", key: 'B' }
        ];
        newQ.answer = { "0": "B", "1": "S", "2": "B" };
        newQ.weight = 1.5;
        newQ.explanation = "Pernyataan 1 Benar (reload/restart mutlak). Pernyataan 2 Salah (verifikasi klien mutlak). Pernyataan 3 Benar (analisis log esensial).";
        break;

      case 'matching':
        newQ.stem = "<p><strong>Pasangkanlah</strong> tahapan atau konsep teknis pada kolom sebelah kiri dengan deskripsi fungsi yang tepat pada kolom sebelah kanan terkait materi <strong>" + coreLabel + "</strong>!</p>";
        newQ.premises = [
          { id: 0, text: "Tahap Instalasi Paket" },
          { id: 1, text: "Tahap Konfigurasi Parameter" },
          { id: 2, text: "Tahap Pengujian & Verifikasi" }
        ];
        newQ.targets = [
          { id: 'A', text: "Pemasangan perangkat lunak/modul pendukung ke dalam sistem operasi target." },
          { id: 'B', text: "Penyesuaian berkas pengaturan (konfigurasi) agar layanan beroperasi sesuai kebutuhan jaringan/sistem." },
          { id: 'C', text: "Validasi fungsionalitas dan pembuktian penerimaan respon layanan pada sisi pengguna/klien." }
        ];
        newQ.answer = { "0": "A", "1": "B", "2": "C" };
        newQ.weight = 2.0;
        newQ.explanation = "Pasangan konsep-deskripsi mencerminkan urutan baku implementasi: Instalasi -> Konfigurasi -> Verifikasi/Pengujian.";
        break;

      case 'short_essay':
        newQ.stem = "<p>Sebutkan berkas konfigurasi utama atau perintah diagnostik yang digunakan dalam proses <strong>" + coreLabel + "</strong>!</p>";
        newQ.answer_keys = ["konfigurasi", "status", "systemctl", "log", "restart"];
        newQ.weight = 1.0;
        newQ.explanation = "Kata kunci diterima mencakup komponen utama konfigurasi, verifikasi status layanan, dan penelusuran log diagnostik.";
        break;

      case 'long_essay':
      default:
        newQ.stem = "<p>Uraikan secara komprehensif langkah-langkah metodologis serta analisis pemecahan masalah dalam pelaksanaan <strong>" + coreLabel + "</strong>! Jelaskan potensi kendala yang mungkin terjadi serta solusi teknis yang dapat diterapkan.</p>";
        newQ.rubric = "Penilaian didasarkan pada:\n1. Kejelasan alur prosedur teknis (35%)\n2. Ketepatan analisis konfigurasi dan perintah kerja (35%)\n3. Kemampuan identifikasi kendala dan formulasi solusi (30%)";
        newQ.ideal_answer = "Pelaksanaan " + coreLabel + " dimulai dari penyiapan lingkungan kerja, instalasi modul terkait, penyuntingan berkas konfigurasi dengan parameter yang presisi, pengaktifan layanan, hingga verifikasi menyeluruh pada sisi klien. Apabila terjadi kendala, teknisi harus memeriksa berkas log sistem untuk melokalisir sumber masalah sebelum melakukan perbaikan terarah.";
        newQ.max_score = 100;
        newQ.keywords = ["instalasi", "konfigurasi", "verifikasi", "log", "analisis"];
        newQ.weight = 3.0;
        newQ.explanation = "Asesmen esai menuntut pemahaman alur kerja utuh, ketelitian parameter, dan penalaran problem-solving.";
        break;
    }

    result.push(newQ);
  }

  return result;
}

async function generateQuestionsWithGeminiAI({
  topic = 'Materi Pembelajaran',
  basis_type = 'materi',
  basis_text = '',
  question_type = 'all',
  cog_level = 'mixed',
  count = 5,
  model = 'gemini-3.5-flash',
  effectiveKey = '',
  custom_prompt = '',
  existing_stems = [],
  existingCount = 0
}) {
  let questions = null;
  let sourceUsed = 'pedagogical_engine';

  if (effectiveKey && effectiveKey.trim().length > 10) {
    try {
      const apiResult = await callGoogleGeminiAPI({
        apiKey: effectiveKey.trim(),
        model,
        basis_type,
        basis_text,
        topic,
        question_type,
        cog_level,
        count,
        custom_prompt,
        existing_stems
      });
      if (apiResult && apiResult.questions && Array.isArray(apiResult.questions) && apiResult.questions.length > 0) {
        questions = apiResult.questions;
        sourceUsed = "google_gemini_api (" + apiResult.usedModel + ")";
      }
    } catch (err) {
      console.warn('[Gemini AI] Panggilan Google Gemini API gagal di seluruh model kandidat:', err.message);
    }
  }

  if (!questions || !Array.isArray(questions) || questions.length === 0) {
    questions = generatePedagogicalTKAQuestions({
      topic,
      basis_type,
      basis_text,
      question_type,
      cog_level,
      count,
      custom_prompt,
      modelUsed: model,
      existingCount
    });
    sourceUsed = effectiveKey ? ("pedagogical_engine (fallback " + model + ")") : ("pedagogical_engine (" + model + ")");
  }

  // Sanitasi & normalisasi semua butir soal dari label kognitif dan struktur opsi/stimulus
  questions = questions.map(q => {
    q.stem = sanitizeQuestionText(q.stem);
    q.explanation = sanitizeQuestionText(q.explanation);
    if (q.options) {
      q.options = normalizeQuestionOptions(q.options);
    }
    if (q.statements) {
      q.statements = normalizeStatements(q.statements);
    }
    if (q.premises) {
      q.premises = normalizePremises(q.premises);
    }
    if (q.targets) {
      q.targets = normalizeTargets(q.targets);
    }
    return q;
  });

  return { questions, sourceUsed };
}

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

// Normalisasi & Validasi Target Kelas Ujian (Bisa Semua Kelas, 1 Kelas, atau Banyak Kelas Hingga 36 Kelas / Tak Terbatas)
function normalizeClassTarget(target) {
  if (!target) return 'Semua Kelas';
  if (Array.isArray(target)) {
    const cleaned = target.map(c => String(c).trim()).filter(Boolean);
    if (cleaned.length === 0 || cleaned.includes('Semua Kelas') || cleaned.includes('all')) {
      return 'Semua Kelas';
    }
    return cleaned;
  }
  const str = String(target).trim();
  if (!str || str.toLowerCase() === 'semua kelas' || str.toLowerCase() === 'all') {
    return 'Semua Kelas';
  }
  if (str.includes(',')) {
    return str.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [str];
}

function formatClassTargetDisplay(target) {
  const norm = normalizeClassTarget(target);
  if (norm === 'Semua Kelas') return 'Semua Kelas';
  if (Array.isArray(norm)) {
    return norm.join(', ');
  }
  return String(norm);
}

function isClassEligible(scheduleClassTarget, studentClassName) {
  if (!studentClassName) return true;
  const norm = normalizeClassTarget(scheduleClassTarget);
  if (norm === 'Semua Kelas') return true;
  const sClass = studentClassName.trim().toLowerCase();
  return norm.some(c => c.trim().toLowerCase() === sClass);
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
  if (sch.token_type === 'none') {
    return {
      token_code: 'TANPA TOKEN',
      token_type: 'none',
      token_interval: 0,
      seconds_left: null,
    };
  }
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
            class_target: formatClassTargetDisplay(s.class_target),
            token_type: ['none', 'static', 'dynamic'].includes(s.token_type) ? s.token_type : (s.token_type || 'static'),
            token_code: s.token_type === 'none' ? 'TANPA TOKEN' : (s.token_code || 'TOKEN'),
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

// ==============================================================
// BERITA ACARA & ABSENSI UJIAN TERINTEGRASI (STANDAR SEKOLAH INDONESIA)
// ==============================================================
const EXAM_ATTENDANCE_FILE = path.join(__dirname, 'exam_attendance.json');
let EXAM_ATTENDANCE = {};

function loadExamAttendanceFromFile() {
  try {
    if (fs.existsSync(EXAM_ATTENDANCE_FILE)) {
      const raw = fs.readFileSync(EXAM_ATTENDANCE_FILE, 'utf8');
      EXAM_ATTENDANCE = JSON.parse(raw);
      if (typeof EXAM_ATTENDANCE !== 'object' || EXAM_ATTENDANCE === null) {
        EXAM_ATTENDANCE = {};
      }
    }
  } catch (err) {
    console.error('[Attendance] Gagal membaca exam_attendance.json:', err.message);
    EXAM_ATTENDANCE = {};
  }
}

function saveExamAttendanceToFile() {
  try {
    fs.writeFileSync(EXAM_ATTENDANCE_FILE, JSON.stringify(EXAM_ATTENDANCE, null, 2), 'utf8');
  } catch (err) {
    console.error('[Attendance] Gagal menyimpan exam_attendance.json:', err.message);
  }
}

loadExamAttendanceFromFile();

function getIndonesianDateString(date = new Date()) {
  const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const dayName = days[date.getDay()];
  const day = date.getDate();
  const monthName = months[date.getMonth()];
  const year = date.getFullYear();
  return `${dayName}, ${day} ${monthName} ${year}`;
}

function getStudentsForSchedule(sch, targetClass = 'all') {
  const allStudents = USERS.filter(u => u.role === 'student');
  const norm = normalizeClassTarget(sch.class_target);

  let filtered = allStudents;
  if (Array.isArray(norm)) {
    filtered = filtered.filter(st => norm.includes(st.class_name));
  }

  const availableClasses = Array.from(new Set(filtered.map(st => st.class_name).filter(Boolean))).sort();

  if (targetClass && targetClass !== 'all' && targetClass !== 'Semua Kelas') {
    filtered = filtered.filter(st => st.class_name === targetClass);
  }

  filtered.sort((a, b) => {
    if (a.class_name && b.class_name && a.class_name !== b.class_name) return a.class_name.localeCompare(b.class_name);
    if (a.exam_no && b.exam_no) return a.exam_no.localeCompare(b.exam_no);
    return a.full_name.localeCompare(b.full_name);
  });

  return { students: filtered, classes: availableClasses };
}


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
    const schQuestions = getQuestionsForSchedule(sch);

    const payload = JSON.stringify({
      schedule_id: sch.id,
      title: sch.title,
      duration_minutes: sch.duration_minutes,
      shuffle_questions: sch.shuffle_questions,
      shuffle_options: sch.shuffle_options,
      questions: schQuestions,
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

// ==============================================================
// PENILAIAN OTOMATIS BERBAGAI TIPE SOAL (TKA SMA/SMK, ANBK, AKM)
// ==============================================================
function evaluateStudentAnswers(questions, userAnswers) {
  let earnedWeight = 0;
  let totalWeight = 0;
  let mostlyCorrectCount = 0;

  for (const q of questions) {
    const qWeight = Number(q.weight) || 1.0;
    totalWeight += qWeight;
    const ansObj = userAnswers ? userAnswers[q.id] : null;
    const studentVal = ansObj ? ansObj.a : undefined;
    let ratio = 0;
    let isCorrect = false;

    if (studentVal !== undefined && studentVal !== null && studentVal !== '') {
      switch (q.type) {
        case 'mcq': {
          isCorrect = (String(studentVal).trim().toUpperCase() === String(q.answer || '').trim().toUpperCase());
          ratio = isCorrect ? 1.0 : 0.0;
          break;
        }
        case 'mcq_complex': {
          const chosen = Array.isArray(studentVal) ? studentVal : [studentVal];
          const correctKeys = Array.isArray(q.answer) ? q.answer : [q.answer];
          const overlap = chosen.filter(c => correctKeys.includes(c)).length;
          const wrong = chosen.filter(c => !correctKeys.includes(c)).length;
          ratio = Math.max(0, (overlap / (correctKeys.length || 1)) - (wrong * 0.25));
          isCorrect = (ratio >= 0.85);
          break;
        }
        case 'true_false': {
          const statements = q.statements || [];
          const stAnswers = (typeof studentVal === 'object') ? studentVal : {};
          if (statements.length > 0) {
            let matches = 0;
            statements.forEach((st, idx) => {
              const studentChoice = stAnswers[st.id] !== undefined ? stAnswers[st.id] : (stAnswers[idx] !== undefined ? stAnswers[idx] : stAnswers[String(idx)]);
              if (studentChoice && String(studentChoice).toUpperCase() === String(st.key).toUpperCase()) {
                matches++;
              }
            });
            ratio = matches / statements.length;
            isCorrect = (ratio >= 0.7);
          }
          break;
        }
        case 'matching': {
          const premises = q.premises || [];
          const correctPairs = q.answer || {};
          const studentPairs = (typeof studentVal === 'object') ? studentVal : {};
          if (premises.length > 0) {
            let matches = 0;
            premises.forEach((p, idx) => {
              const sTarget = studentPairs[p.id] !== undefined ? studentPairs[p.id] : (studentPairs[idx] !== undefined ? studentPairs[idx] : studentPairs[String(idx)]);
              const cTarget = correctPairs[p.id] !== undefined ? correctPairs[p.id] : (correctPairs[idx] !== undefined ? correctPairs[idx] : correctPairs[String(idx)]);
              if (sTarget && cTarget && String(sTarget).toUpperCase() === String(cTarget).toUpperCase()) {
                matches++;
              }
            });
            ratio = matches / premises.length;
            isCorrect = (ratio >= 0.7);
          }
          break;
        }
        case 'short_essay': {
          const sText = String(studentVal || '').replace(/\s+/g, ' ').replace(/[.;,]+$/, '').trim().toLowerCase();
          const validKeys = (q.answer_keys || []).map(k => String(k).replace(/\s+/g, ' ').replace(/[.;,]+$/, '').trim().toLowerCase());
          isCorrect = validKeys.includes(sText);
          ratio = isCorrect ? 1.0 : 0.0;
          break;
        }
        case 'long_essay': {
          let essayScore = ansObj.ai_score;
          if (essayScore === undefined && String(studentVal).trim().length > 0) {
            const graded = gradeEssayWithAI({
              question_stem: q.stem,
              rubric: q.rubric,
              ideal_answer: q.ideal_answer,
              student_answer: studentVal,
              keywords: q.keywords,
              max_score: q.max_score || 100
            });
            essayScore = graded.score;
            ansObj.ai_score = essayScore;
            ansObj.ai_feedback = graded.feedback;
            ansObj.ai_analysis = graded.analysis;
          }
          ratio = Math.max(0, Math.min(1.0, (essayScore || 0) / (q.max_score || 100)));
          isCorrect = (ratio >= 0.75);
          break;
        }
        default: {
          isCorrect = (String(studentVal).trim() === String(q.answer || '').trim());
          ratio = isCorrect ? 1.0 : 0.0;
          break;
        }
      }
    }

    if (isCorrect || ratio >= 0.7) {
      mostlyCorrectCount++;
    }
    earnedWeight += (ratio * qWeight);
  }

  const finalScore = totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * 100) : 0;
  return {
    score: Math.min(100, Math.max(0, finalScore)),
    correct_count: mostlyCorrectCount,
    wrong_count: Math.max(0, questions.length - mostlyCorrectCount),
  };
}

// In-Memory Session & Answer Store (Multi-Jadwal: {schedule_id}_{student_id})
const studentAnswersStore = {
  // Jadwal 1 (UAS Fisika Peminatan XII - Bank Soal Termodinamika & Kalor TKA)
  '1_1001': {
    1: { a: 'C', d: 0 },
    2: { a: 'B', d: 0 },
    3: { a: ['A', 'B', 'D'], d: 0 },
    4: { a: { '0': 'B', '1': 'S', '2': 'B' }, d: 0 },
    5: { a: { '0': 'B', '1': 'C', '2': 'A', '3': 'D' }, d: 0 },
    6: { a: 'Hukum Kedua Termodinamika', d: 0 },
    7: {
      a: 'Mesin pendingin bekerja berdasarkan Hukum Kedua Termodinamika, di mana kalor secara alami tidak dapat mengalir secara spontan dari benda dingin ke benda panas. Untuk membalik arah aliran ini, dibutuhkan kerja atau usaha dari luar (W) yang disuplai oleh kompresor listrik. Siklus pendingin diawali dari zat pendingin (refrigerant) bersuhu rendah menyerap kalor di evaporator, kemudian dimampatkan oleh kompresor sehingga tekanan dan suhunya naik, lalu melepaskan kalor di kondensor ke lingkungan luar yang lebih hangat. Kinerja mesin pendingin diukur dengan Koefisien Performansi (COP).',
      d: 0,
      ai_score: 95,
      ai_feedback: 'Skor AI: 95/100 (A). Tepat menyertakan konsep esensial: hukum kedua termodinamika, kompresor, evaporator, kondensor. Uraian argumentasi memiliki kedalaman deskripsi dan penjelasan yang runtut. Alur pemikiran menunjukkan hubungan sebab-akibat ilmiah yang logis.',
      ai_analysis: {
        keywords_matched: ['hukum kedua termodinamika', 'kompresor', 'evaporator', 'kondensor', 'refrigerant', 'koefisien performansi', 'cop', 'kalor'],
        keywords_missing: [],
        word_count: 78,
        strengths: ['Siswa menguraikan seluruh siklus refrigerasi secara tepat.', 'Mengkaitkan peran usaha luar kompresor dengan batasan Hukum II Termodinamika.'],
        suggestions: ['Pertahankan struktur penulisan ilmiah yang sangat baik!']
      }
    }
  },
  '1_1002': {
    1: { a: 'C', d: 0 },
    2: { a: 'B', d: 0 },
    3: { a: ['A', 'B'], d: 0 },
    4: { a: { '0': 'B', '1': 'B', '2': 'B' }, d: 0 },
    5: { a: { '0': 'B', '1': 'C', '2': 'A', '3': 'C' }, d: 0 },
    6: { a: 'Hukum II', d: 0 },
    7: {
      a: 'Kulkas bekerja memindahkan panas dari dalam lemari es keluar. Kalor diserap oleh freon pendingin lalu kompresor memompanya keluar ke kondensor di belakang kulkas sehingga ruangan terasa hangat.',
      d: 0,
      ai_score: 72,
      ai_feedback: 'Skor AI: 72/100 (C). Tepat menyertakan konsep esensial: kompresor, kondensor, kalor. Disarankan memperdalam uraian dengan memberikan rincian mekanisme atau rumus pendukung COP.',
      ai_analysis: {
        keywords_matched: ['kompresor', 'kondensor', 'kalor'],
        keywords_missing: ['hukum kedua termodinamika', 'evaporator', 'koefisien performansi'],
        word_count: 27,
        strengths: ['Memahami alur dasar penyerapan dan pelepasan panas kulkas.'],
        suggestions: ['Ulas konsep Hukum Kedua Termodinamika bahwa proses ini membutuhkan usaha luar W, serta sebutkan fungsi evaporator.']
      }
    }
  },
  // Jadwal 2 (Penilaian Akhir Matematika Wajib XII)
  '2_1001': { 1: { a: 'B', d: 0 }, 2: { a: ['A', 'C', 'D'], d: 0 }, 3: { a: { '0': 'B', '1': 'S', '2': 'B' }, d: 0 }, 4: { a: '10', d: 0 } },
  '2_1002': { 1: { a: 'B', d: 0 }, 2: { a: ['A', 'C', 'D'], d: 0 }, 3: { a: { '0': 'B', '1': 'S', '2': 'B' }, d: 0 }, 4: { a: '10', d: 0 } },
  '2_1003': { 1: { a: 'A', d: 1 }, 2: { a: ['A', 'B'], d: 0 } },
  // Jadwal 3 (Asesmen Bahasa Indonesia XII)
  '3_1001': { 1: { a: 'A', d: 0 }, 2: { a: { '0': 'B', '1': 'S', '2': 'B' }, d: 0 } },
  '3_1003': { 1: { a: 'A', d: 0 }, 2: { a: { '0': 'B', '1': 'S', '2': 'B' }, d: 0 } },
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


// ==============================================================
// MODUL EXPORT & IMPORT BUTIR SOAL KE MICROSOFT WORD (.DOCX / .DOC)
// Pure Node.js Zero-Dependency OpenXML & HTML-Word Engine
// ==============================================================

function crc32Word(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (-(crc & 1) & 0xedb88320);
    }
  }
  return ~crc >>> 0;
}

function createZipArchive(files) {
  const zlib = require('zlib');
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const rawData = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8');
    const crc = crc32Word(rawData);
    const compressed = zlib.deflateRawSync(rawData);
    const useCompressed = compressed.length < rawData.length;
    const method = useCompressed ? 8 : 0;
    const body = useCompressed ? compressed : rawData;

    const lh = Buffer.alloc(30 + nameBuf.length);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(rawData.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    nameBuf.copy(lh, 30);
    localHeaders.push(lh, body);

    const ch = Buffer.alloc(46 + nameBuf.length);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(rawData.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    nameBuf.copy(ch, 46);
    centralHeaders.push(ch);

    offset += lh.length + body.length;
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const ch of centralHeaders) cdSize += ch.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}

function readZipArchive(buf) {
  const zlib = require('zlib');
  const files = {};
  let offset = 0;
  while (offset < buf.length - 30) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;
    const method = buf.readUInt16LE(offset + 8);
    const compSize = buf.readUInt32LE(offset + 18);
    const uncompSize = buf.readUInt32LE(offset + 22);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const name = buf.toString('utf8', offset + 30, offset + 30 + nameLen);
    const dataOffset = offset + 30 + nameLen + extraLen;
    const compData = buf.subarray(dataOffset, dataOffset + compSize);
    let data;
    try {
      if (method === 8) {
        data = zlib.inflateRawSync(compData);
      } else {
        data = compData;
      }
      files[name] = data;
    } catch (e) {}
    offset = dataOffset + compSize;
  }
  return files;
}

function extractTextFromWordBuffer(buf) {
  if (!buf || buf.length === 0) return '';
  // Check if it is a ZIP (.docx)
  if (buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50) {
    const files = readZipArchive(buf);
    const docXmlBuf = files['word/document.xml'];
    if (!docXmlBuf) throw new Error('Berkas .docx tidak memiliki word/document.xml');
    const docXml = docXmlBuf.toString('utf8');
    
    const paragraphs = [];
    const pMatches = docXml.match(/<w:p[\s>](.*?)<\/w:p>/gs) || [];
    for (const pXml of pMatches) {
      let pText = '';
      const tMatches = pXml.match(/<w:t[\s>](.*?)<\/w:t>/gs) || [];
      for (const tXml of tMatches) {
        const cleanT = tXml.replace(/<[^>]+>/g, '');
        pText += cleanT;
      }
      if (pText.trim()) {
        paragraphs.push(pText.trim());
      }
    }
    return paragraphs.join('\n');
  } else {
    // Might be HTML or plain text .doc
    return buf.toString('utf8').replace(/<[^>]+>/g, '\n');
  }
}

function xmlEscape(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function parseQuestionsFromWordText(rawText) {
  if (!rawText || !rawText.trim()) return [];

  const lines = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);
  const questions = [];
  let currentQ = null;

  function finalizeCurrentQ() {
    if (!currentQ) return;
    const hasOptions = currentQ.options && currentQ.options.length > 0;
    const hasKeys = currentQ.answer_keys && currentQ.answer_keys.length > 0;
    const hasStatements = currentQ.statements && currentQ.statements.length > 0;
    const hasPremises = currentQ.premises && currentQ.premises.length > 0;
    const isLongEssay = currentQ.type === 'long_essay';

    if (currentQ.stem && (hasOptions || hasKeys || currentQ.answer || hasStatements || hasPremises || isLongEssay)) {
      if (!currentQ.type) {
        if (hasPremises) {
          currentQ.type = 'matching';
        } else if (hasStatements) {
          currentQ.type = 'true_false';
        } else if (hasOptions) {
          if (Array.isArray(currentQ.answer) && currentQ.answer.length > 1) {
            currentQ.type = 'mcq_complex';
          } else {
            currentQ.type = 'mcq';
          }
        } else if (hasKeys) {
          currentQ.type = 'short_essay';
        } else {
          currentQ.type = 'short_essay';
          if (currentQ.answer) currentQ.answer_keys = [currentQ.answer];
        }
      }

      if (currentQ.type === 'mcq' && !currentQ.answer && hasOptions) {
        currentQ.answer = currentQ.options[0].id;
      }
      if (currentQ.type === 'true_false') {
        const ansObj = {};
        currentQ.statements.forEach((st, idx) => {
          ansObj[String(idx)] = st.key || 'B';
        });
        currentQ.answer = currentQ.answer || ansObj;
      }
      if (currentQ.type === 'matching') {
        const ansObj = {};
        currentQ.premises.forEach((p, idx) => {
          const tgt = currentQ.targets[idx];
          ansObj[String(idx)] = tgt ? tgt.id : String.fromCharCode(65 + idx);
        });
        currentQ.answer = currentQ.answer || ansObj;
      }
      if (currentQ.type === 'short_essay' && (!currentQ.answer_keys || currentQ.answer_keys.length === 0)) {
        currentQ.answer_keys = [currentQ.answer || 'kunci jawaban'];
      }
      if (currentQ.type === 'long_essay') {
        if (!currentQ.ideal_answer && currentQ.answer) currentQ.ideal_answer = currentQ.answer;
        if (!currentQ.rubric) currentQ.rubric = 'Kriteria rubrik penilaian analitis berbobot.';
        if (!currentQ.max_score) currentQ.max_score = 100;
      }
      if (!currentQ.weight) {
        currentQ.weight = (currentQ.type === 'long_essay' ? 3.0 : (currentQ.type === 'matching' ? 2.0 : (currentQ.type === 'mcq_complex' || currentQ.type === 'true_false' ? 1.5 : 1.0)));
      }
      if (!currentQ.cog) currentQ.cog = 'C2';

      questions.push(currentQ);
    }
    currentQ = null;
  }

  const qNumberRegex = /^(?:(?:\[SOAL\]|Soal)\s*)?(?:No\.?\s*)?(\d+)[\.\)]\s*(.*)$/i;
  const optRegex = /^([A-Ea-e])[\.\)]\s*(.*)$/;
  const keyRegex = /^(?:KUNCI\s*JAWABAN\s*BENAR|KUNCI\s*JAWABAN|KUNCI|JAWABAN|ANSWER|KEY)\s*[:=]\s*(.*)$/i;
  const explRegex = /^(?:PEMBAHASAN|PENJELASAN|EXPLANATION|ALASAN)\s*[:=]\s*(.*)$/i;
  const typeRegex = /^(?:TIPE|TYPE|JENIS|FORMAT)\s*[:=]\s*(.*)$/i;
  const cogRegex = /^(?:KOGNITIF|LEVEL|TINGKAT|COG)\s*[:=]\s*(.*)$/i;
  const weightRegex = /^(?:BOBOT|WEIGHT|SKOR)\s*[:=]\s*(.*)$/i;
  const rubricRegex = /^(?:RUBRIK|RUBRIC|KRITERIA)\s*[:=]\s*(.*)$/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const qMatch = line.match(qNumberRegex);
    if (qMatch) {
      finalizeCurrentQ();
      currentQ = {
        stem: qMatch[2] ? qMatch[2].trim() : '',
        options: [],
        answer: null,
        answer_keys: [],
        statements: [],
        premises: [],
        targets: [],
        explanation: '',
        weight: 1.0,
        cog: 'C2',
        type: null
      };
      continue;
    }

    if (!currentQ) {
      if (line.toLowerCase().startsWith('[soal]')) {
        currentQ = {
          stem: '',
          options: [],
          answer: null,
          answer_keys: [],
          statements: [],
          premises: [],
          targets: [],
          explanation: '',
          weight: 1.0,
          cog: 'C2',
          type: null
        };
      }
      continue;
    }

    const tMatch = line.match(typeRegex);
    if (tMatch) {
      const t = tMatch[1].toLowerCase().trim();
      if (t.includes('kompleks') || t.includes('complex')) currentQ.type = 'mcq_complex';
      else if (t.includes('ganda') || t.includes('pg') || t.includes('mcq')) currentQ.type = 'mcq';
      else if (t.includes('isian') || t.includes('short')) currentQ.type = 'short_essay';
      else if (t.includes('uraian') || t.includes('esai') || t.includes('essay')) currentQ.type = 'long_essay';
      else if (t.includes('benar') || t.includes('salah') || t.includes('true') || t.includes('bs')) currentQ.type = 'true_false';
      else if (t.includes('jodoh') || t.includes('matching')) currentQ.type = 'matching';
      continue;
    }

    const kMatch = line.match(keyRegex);
    if (kMatch) {
      let val = kMatch[1].trim();

      if (/\|\s*(?:pembahasan|penjelasan|explanation|alasan)\s*:/i.test(val)) {
        const pParts = val.split(/\|\s*(?:pembahasan|penjelasan|explanation|alasan)\s*:/i);
        val = pParts[0].trim();
        if (pParts[1] && !currentQ.explanation) {
          currentQ.explanation = pParts[1].trim();
        }
      }

      if (currentQ.type === 'true_false' || (/^[BSbs\s\-\,\;]+$/.test(val) && val.length >= 3)) {
        const bsLetters = val.match(/[BSbs]/g);
        if (bsLetters && bsLetters.length > 0) {
          currentQ.type = 'true_false';
          const ansMap = {};
          bsLetters.forEach((letter, bIdx) => {
            ansMap[String(bIdx)] = letter.toUpperCase();
            if (currentQ.statements[bIdx]) {
              currentQ.statements[bIdx].key = letter.toUpperCase();
            }
          });
          currentQ.answer = ansMap;
          continue;
        }
      }

      if (currentQ.type === 'matching' || (val.includes('-') && /\d+\s*[-:=]\s*[A-Za-z]/.test(val))) {
        currentQ.type = 'matching';
        const pairMatches = [...val.matchAll(/(\d+)\s*[-:=]\s*([A-Za-z])/g)];
        if (pairMatches.length > 0) {
          const ansMap = {};
          pairMatches.forEach(pm => {
            const premisIdx = parseInt(pm[1], 10) - 1;
            ansMap[String(premisIdx)] = pm[2].toUpperCase();
          });
          currentQ.answer = ansMap;
          continue;
        }
      }

      if (val.includes(',') || val.includes('/') || val.includes(';')) {
        const parts = val.split(/[,/;]/).map(s => s.trim().toUpperCase()).filter(Boolean);
        if (parts.length > 1 && parts.every(p => /^[A-E]$/.test(p))) {
          currentQ.answer = parts;
          currentQ.type = 'mcq_complex';
        } else {
          currentQ.answer_keys = val.split(/[,/;]/).map(s => s.trim()).filter(Boolean);
          if (!currentQ.type) currentQ.type = 'short_essay';
        }
      } else if (/^[A-Ea-e]$/.test(val)) {
        currentQ.answer = val.toUpperCase();
        if (!currentQ.type) currentQ.type = 'mcq';
      } else {
        currentQ.answer = val;
        currentQ.answer_keys = [val];
        if (currentQ.type === 'long_essay') {
          currentQ.ideal_answer = val;
        } else if (!currentQ.type) {
          currentQ.type = 'short_essay';
        }
      }
      continue;
    }

    const eMatch = line.match(explRegex);
    if (eMatch) {
      currentQ.explanation = eMatch[1].trim();
      continue;
    }

    const cMatch = line.match(cogRegex);
    if (cMatch) {
      const cogVal = cMatch[1].toUpperCase().trim();
      if (['C1', 'C2', 'C3', 'C4', 'C5', 'C6'].includes(cogVal)) {
        currentQ.cog = cogVal;
      }
      continue;
    }

    const wMatch = line.match(weightRegex);
    if (wMatch) {
      const wVal = parseFloat(wMatch[1].replace(',', '.'));
      if (!isNaN(wVal) && wVal > 0) currentQ.weight = wVal;
      continue;
    }

    const rMatch = line.match(rubricRegex);
    if (rMatch) {
      currentQ.rubric = rMatch[1].trim();
      currentQ.type = 'long_essay';
      continue;
    }

    // Matching format: "PREMIS 1: xxx ---> TARGET A: yyy" or "xxx ---> yyy"
    if (line.includes('--->') || line.includes('-->') || /PREMIS\s*\d*[:\.\-]/i.test(line)) {
      currentQ.type = 'matching';
      const parts = line.split(/(?:--->|---|-->|➔|->)/);
      if (parts.length >= 2) {
        const left = parts[0].replace(/^(?:PREMIS\s*\d*[:\.\-]?|\d+[\.\)])\s*/i, '').trim();
        let right = parts[1].replace(/^(?:\[\s*[A-Za-z0-9\.\s]*\s*\])?\s*(?:TARGET\s*[A-Za-z0-9]?[:\.\-]?|[A-Ea-e][\.\)])\s*/i, '').trim();
        const idNum = currentQ.premises.length;
        const targetId = String.fromCharCode(65 + idNum);
        currentQ.premises.push({ id: idNum, text: left });
        currentQ.targets.push({ id: targetId, text: right });
        continue;
      }
    }

    // True/False format: "[B] pernyataan" or "[S] pernyataan" or "[ ] [ B / S ] pernyataan"
    const tfBracketMatch = line.match(/^\[([BSbs])\]\s*(?:(?:Pernyataan|\d+)[\.\:]?\s*)?(.*)$/i);
    if (tfBracketMatch) {
      currentQ.type = 'true_false';
      currentQ.statements.push({
        id: currentQ.statements.length,
        key: tfBracketMatch[1].toUpperCase(),
        text: tfBracketMatch[2].trim()
      });
      continue;
    }

    const tfEmptyMatch = line.match(/^\[\s*\]\s*\[\s*[BSbs]\s*(?:\/|\s)\s*[BSbs]\s*\]\s*(?:(?:Pernyataan|\d+)[\.\:]?\s*)?(.*)$/i);
    if (tfEmptyMatch) {
      currentQ.type = 'true_false';
      currentQ.statements.push({
        id: currentQ.statements.length,
        key: 'B',
        text: tfEmptyMatch[1].trim()
      });
      continue;
    }

    if (currentQ.type === 'true_false' && /^(?:\d+[\.\)]\s*|Pernyataan\s*\d*[:\.\-]?\s*)(.*)$/i.test(line)) {
      const pMatch = line.match(/^(?:\d+[\.\)]\s*|Pernyataan\s*\d*[:\.\-]?\s*)(.*)$/i);
      currentQ.statements.push({
        id: currentQ.statements.length,
        key: 'B',
        text: pMatch[1].trim()
      });
      continue;
    }

    const optMatch = line.match(optRegex);
    if (optMatch) {
      currentQ.options.push({
        id: optMatch[1].toUpperCase(),
        text: optMatch[2].trim()
      });
      continue;
    }

    if (currentQ.options.length === 0 && !currentQ.answer && currentQ.answer_keys.length === 0 && currentQ.statements.length === 0 && currentQ.premises.length === 0) {
      currentQ.stem += (currentQ.stem ? '<br>' : '') + line;
    } else if (currentQ.explanation) {
      currentQ.explanation += ' ' + line;
    }
  }

  finalizeCurrentQ();
  return questions;
}

const SAMPLE_TEMPLATE_QUESTIONS = [
  {
    stem: "Layanan jaringan apa yang bertugas memberikan konfigurasi alamat IP, subnet mask, dan default gateway secara otomatis kepada komputer klien di laboratorium sekolah?",
    type: "mcq",
    cog: "C2",
    weight: 1.0,
    options: [
      { id: "A", text: "DNS (Domain Name System)" },
      { id: "B", text: "DHCP (Dynamic Host Configuration Protocol)" },
      { id: "C", text: "FTP (File Transfer Protocol)" },
      { id: "D", text: "SSH (Secure Shell)" },
      { id: "E", text: "NTP (Network Time Protocol)" }
    ],
    answer: "B",
    explanation: "DHCP (Dynamic Host Configuration Protocol) berfungsi mengalokasikan alamat IP, subnet mask, DNS, dan gateway kepada komputer klien secara dinamis."
  },
  {
    stem: "Manakah dari protokol jaringan berikut yang menggunakan enkripsi kriptografi untuk mengamankan komunikasi data dari sniffing? (Pilih semua jawaban yang benar)",
    type: "mcq_complex",
    cog: "C3",
    weight: 1.5,
    options: [
      { id: "A", text: "HTTPS (Port 443 - Hypertext Transfer Protocol Secure)" },
      { id: "B", text: "HTTP (Port 80 - Standar Plaintext)" },
      { id: "C", text: "SSH (Port 22 - Secure Shell)" },
      { id: "D", text: "Telnet (Port 23 - Plaintext Remote Login)" },
      { id: "E", text: "SFTP (Port 22 - SSH File Transfer Protocol)" }
    ],
    answer: ["A", "C", "E"],
    explanation: "HTTPS, SSH, dan SFTP menggunakan protokol kriptografi (SSL/TLS dan SSH) untuk mengamankan pertukaran data dari penyadapan (sniffing)."
  },
  {
    stem: "Tentukan status kebenaran dari setiap pernyataan teknis mengenai media transmisi dan perangkat keras jaringan komputer berikut!",
    type: "true_false",
    cog: "C3",
    weight: 1.5,
    statements: [
      { id: 0, text: "Kabel UTP Kategori 6 (Cat6) mampu mendukung kecepatan transfer data hingga 10 Gbps pada jarak maksimal 55 meter.", key: "B" },
      { id: 1, text: "Topologi Star menggunakan satu kabel coaxial utama sebagai backbone tunggal bagi seluruh komputer klien.", key: "S" },
      { id: 2, text: "Switch jaringan bekerja pada Data Link Layer (Layer 2 OSI) dan menggunakan tabel MAC Address untuk meneruskan frame ke port tujuan.", key: "B" },
      { id: 3, text: "Repeater memeriksa header alamat IP pada paket data sebelum meneruskannya ke segmen jaringan lain.", key: "S" }
    ],
    answer: { "0": "B", "1": "S", "2": "B", "3": "S" },
    explanation: "Pernyataan 1 Benar (spesifikasi Cat6). Pernyataan 2 Salah (backbone tunggal adalah topologi Bus). Pernyataan 3 Benar (Switch bekerja di Layer 2 OSI). Pernyataan 4 Salah (Repeater bekerja di Layer 1 Physical dan hanya memperkuat sinyal fisik tanpa membaca IP)."
  },
  {
    stem: "Jodohkan istilah protokol jaringan komputer di sebelah kiri dengan nomor port default yang sesuai di sebelah kanan:",
    type: "matching",
    cog: "C3",
    weight: 2.0,
    premises: [
      { id: 0, text: "HTTP (Hypertext Transfer Protocol - Web Standar)" },
      { id: 1, text: "HTTPS (HTTP Secure - Web Terenkripsi)" },
      { id: 2, text: "SSH (Secure Shell - Remote Console Terenkripsi)" },
      { id: 3, text: "DNS (Domain Name System - Resolusi Domain)" }
    ],
    targets: [
      { id: "A", text: "Port 80" },
      { id: "B", text: "Port 443" },
      { id: "C", text: "Port 22" },
      { id: "D", text: "Port 53" }
    ],
    answer: { "0": "A", "1": "B", "2": "C", "3": "D" },
    explanation: "HTTP Port 80, HTTPS Port 443, SSH Port 22, dan DNS Port 53."
  },
  {
    stem: "Sebutkan perintah terminal lengkap di Linux Ubuntu 24.04 LTS untuk memperbarui indeks daftar repositori paket sistem menggunakan manajer paket apt!",
    type: "short_essay",
    cog: "C2",
    weight: 1.0,
    answer_keys: ["sudo apt update", "apt update", "sudo apt-get update"],
    explanation: "Perintah standar untuk sinkronisasi indeks repositori Debian/Ubuntu adalah 'sudo apt update'."
  },
  {
    stem: "Sebuah laboratorium sekolah mengalami kendala jaringan di mana komputer klien tidak dapat mengakses internet meskipun kabel LAN terhubung dan lampu port switch menyala hijau normal. Jelaskan langkah-langkah pemecahan masalah (troubleshooting) sistematis yang harus Anda lakukan mulai dari physical layer hingga application layer!",
    type: "long_essay",
    cog: "C4",
    weight: 3.0,
    rubric: "35% Pemeriksaan konfigurasi IP & Gateway, 35% Pengujian Ping Gateway & IP Publik, 30% Solusi Resolusi DNS & Routing.",
    ideal_answer: "1. Periksa konfigurasi IP melalui terminal (ip a / ipconfig) untuk memastikan klien mendapatkan alamat IP dan default gateway dari DHCP server. 2. Lakukan ping ke default gateway lokal untuk verifikasi koneksi switch & router. 3. Lakukan ping ke IP publik (misal 8.8.8.8) untuk memastikan routing dan koneksi internet router berjalan. 4. Uji resolusi domain menggunakan nslookup untuk memastikan DNS berfungsi.",
    max_score: 100,
    keywords: ["IP address", "default gateway", "ping", "DNS", "nslookup", "routing"],
    explanation: "Troubleshooting dilakukan berurutan sesuai OSI layer: verifikasi konfigurasi IP (Layer 3), gateway & routing (Layer 3), dan resolusi DNS (Layer 7)."
  }
];

function generateDocxDocument({ title, school, subject, teacher, targetClass, questions, includeKeys = true, includeExplanation = true, includeHeader = true }) {
  let bodyXml = '';

  if (includeHeader) {
    bodyXml += `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="28"/><w:color w:val="1e1b4b"/></w:rPr><w:t>${xmlEscape(school || 'SMK NEGERI 5 BANDUNG')}</w:t></w:r></w:p>`;
    bodyXml += `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="24"/></w:rPr><w:t>${xmlEscape(title || 'NASKAH ASESMEN PEMBELAJARAN')}</w:t></w:r></w:p>`;
    bodyXml += `<w:p><w:pPr><w:jc w:val="center"/><w:pBdr><w:bottom w:val="single" w:sz="14" w:space="8" w:color="4f46e5"/></w:pBdr></w:pPr><w:r><w:rPr><w:i/><w:sz w:val="20"/><w:color w:val="4b5563"/></w:rPr><w:t>Mata Pelajaran: ${xmlEscape(subject || 'Informatika')} | Kelas: ${xmlEscape(targetClass || 'Semua Kelas')} | Pengampu: ${xmlEscape(teacher || 'Guru Pengampu')}</w:t></w:r></w:p>`;
    bodyXml += `<w:p><w:r><w:t></w:t></w:r></w:p>`;
  } else {
    bodyXml += `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="24"/></w:rPr><w:t>${xmlEscape(title || 'NASKAH ASESMEN PEMBELAJARAN')}</w:t></w:r></w:p>`;
    bodyXml += `<w:p><w:r><w:t></w:t></w:r></w:p>`;
  }

  questions.forEach((q, idx) => {
    const qNum = idx + 1;
    const cleanStem = (q.stem || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    
    bodyXml += `<w:p><w:pPr><w:spacing w:before="240" w:after="80"/></w:pPr>`;
    bodyXml += `<w:r><w:rPr><w:b/></w:rPr><w:t>${qNum}. </w:t></w:r>`;
    bodyXml += `<w:r><w:t>${xmlEscape(cleanStem)}</w:t></w:r>`;
    bodyXml += `</w:p>`;

    let typeLabel = '';
    if (q.type === 'mcq') typeLabel = 'Pilihan Ganda Tunggal';
    else if (q.type === 'mcq_complex') typeLabel = 'Pilihan Ganda Kompleks';
    else if (q.type === 'true_false') typeLabel = 'Pernyataan Benar / Salah';
    else if (q.type === 'matching') typeLabel = 'Menjodohkan';
    else if (q.type === 'short_essay') typeLabel = 'Isian Singkat';
    else if (q.type === 'long_essay') typeLabel = 'Uraian / Esai AI';

    if (typeLabel) {
      bodyXml += `<w:p><w:pPr><w:ind w:left="480"/><w:spacing w:after="60"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="18"/><w:color w:val="4338ca"/></w:rPr><w:t>TIPE: ${typeLabel}</w:t></w:r></w:p>`;
    }

    if (q.type === 'mcq' || q.type === 'mcq_complex') {
      const opts = q.options || [];
      opts.forEach(opt => {
        const cleanOpt = (opt.text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        bodyXml += `<w:p><w:pPr><w:ind w:left="480"/><w:spacing w:after="40"/></w:pPr>`;
        bodyXml += `<w:r><w:rPr><w:b/></w:rPr><w:t>${opt.id}. </w:t></w:r>`;
        bodyXml += `<w:r><w:t>${xmlEscape(cleanOpt)}</w:t></w:r>`;
        bodyXml += `</w:p>`;
      });
    } else if (q.type === 'true_false') {
      (q.statements || []).forEach((st, sIdx) => {
        bodyXml += `<w:p><w:pPr><w:ind w:left="480"/><w:spacing w:after="40"/></w:pPr>`;
        if (includeKeys && st.key) {
          bodyXml += `<w:r><w:rPr><w:b/><w:color w:val="047857"/></w:rPr><w:t>[${xmlEscape(st.key)}] </w:t></w:r>`;
        } else {
          bodyXml += `<w:r><w:t>[   ] [ B / S ] </w:t></w:r>`;
        }
        bodyXml += `<w:r><w:t>${sIdx + 1}. ${xmlEscape(st.text)}</w:t></w:r>`;
        bodyXml += `</w:p>`;
      });
    } else if (q.type === 'matching') {
      (q.premises || []).forEach((p, pIdx) => {
        const target = (q.targets || [])[pIdx];
        bodyXml += `<w:p><w:pPr><w:ind w:left="480"/><w:spacing w:after="40"/></w:pPr>`;
        if (includeKeys && target) {
          bodyXml += `<w:r><w:rPr><w:b/></w:rPr><w:t>PREMIS ${pIdx + 1}: ${xmlEscape(p.text)}   --->   TARGET ${target.id}: ${xmlEscape(target.text)}</w:t></w:r>`;
        } else {
          bodyXml += `<w:r><w:t>${pIdx + 1}. ${xmlEscape(p.text)}   --->   [ ... ] ${target ? `${target.id}. ${xmlEscape(target.text)}` : ''}</w:t></w:r>`;
        }
        bodyXml += `</w:p>`;
      });
    } else if (q.type === 'short_essay') {
      bodyXml += `<w:p><w:pPr><w:ind w:left="480"/><w:spacing w:after="60"/></w:pPr><w:r><w:rPr><w:i/><w:color w:val="6b7280"/></w:rPr><w:t>Jawaban Singkat: _____________________________________________</w:t></w:r></w:p>`;
    } else if (q.type === 'long_essay') {
      if (q.rubric) {
        bodyXml += `<w:p><w:pPr><w:ind w:left="480"/><w:spacing w:after="40"/></w:pPr><w:r><w:rPr><w:i/><w:color w:val="4b5563"/></w:rPr><w:t>RUBRIK: ${xmlEscape(q.rubric)}</w:t></w:r></w:p>`;
      }
      bodyXml += `<w:p><w:pPr><w:ind w:left="480"/><w:spacing w:after="60"/></w:pPr><w:r><w:rPr><w:i/><w:color w:val="6b7280"/></w:rPr><w:t>Lembar Uraian / Jawaban: [ ............................................................................................................ ]</w:t></w:r></w:p>`;
    }

    if (includeKeys) {
      let keyText = '';
      if (q.type === 'mcq') keyText = q.answer || '-';
      else if (q.type === 'mcq_complex') keyText = Array.isArray(q.answer) ? q.answer.join(', ') : q.answer;
      else if (q.type === 'true_false') keyText = (q.statements || []).map(s => s.key).join('-');
      else if (q.type === 'matching') {
        if (typeof q.answer === 'object' && q.answer !== null) {
          keyText = Object.entries(q.answer).map(([k, v]) => `${Number(k) + 1}-${v}`).join(', ');
        } else {
          keyText = (q.premises || []).map((_, idx) => `${idx + 1}-${String.fromCharCode(65 + idx)}`).join(', ');
        }
      }
      else if (q.type === 'short_essay') keyText = (q.answer_keys || []).join(' / ');
      else if (q.type === 'long_essay') keyText = q.ideal_answer || (q.keywords ? `Kata Kunci: ${(q.keywords || []).join(', ')}` : 'Jawaban Esai Komprehensif');

      bodyXml += `<w:p><w:pPr><w:ind w:left="480"/><w:pBdr><w:left w:val="single" w:sz="14" w:space="8" w:color="10b981"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="ecfdf5"/><w:spacing w:before="60" w:after="100"/></w:pPr>`;
      bodyXml += `<w:r><w:rPr><w:b/><w:color w:val="065f46"/></w:rPr><w:t>KUNCI JAWABAN: ${xmlEscape(keyText)}</w:t></w:r>`;
      if (includeExplanation && q.explanation) {
        bodyXml += `<w:r><w:t> | Pembahasan: ${xmlEscape(q.explanation.replace(/<[^>]+>/g, ' '))}</w:t></w:r>`;
      }
      bodyXml += `</w:p>`;
    }
  });

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${bodyXml}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  return createZipArchive([
    { name: '[Content_Types].xml', data: contentTypesXml },
    { name: '_rels/.rels', data: relsXml },
    { name: 'word/document.xml', data: docXml }
  ]);
}

function generateDocxTemplate() {
  return generateDocxDocument({
    title: "TEMPLATE RESMI UNGGAH BUTIR SOAL CBT",
    school: "SMK NEGERI 5 BANDUNG",
    subject: "Administrasi Sistem Jaringan / Umum",
    teacher: "Tim Asesmen Guru",
    targetClass: "Semua Kelas",
    questions: SAMPLE_TEMPLATE_QUESTIONS,
    includeKeys: true,
    includeExplanation: true,
    includeHeader: true
  });
}

function generateWordHtmlDocument({ title, school, subject, teacher, targetClass, questions, includeKeys = true, includeExplanation = true, includeHeader = true }) {
  const esc = (s) => (s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let qHtml = '';

  questions.forEach((q, idx) => {
    const qNum = idx + 1;
    qHtml += `<div style="margin-bottom: 16px; page-break-inside: avoid;">`;
    qHtml += `<p style="margin: 0 0 6px 0; font-weight: bold;">${qNum}. ${q.stem || ''}</p>`;

    let typeLabel = '';
    if (q.type === 'mcq') typeLabel = 'Pilihan Ganda Tunggal';
    else if (q.type === 'mcq_complex') typeLabel = 'Pilihan Ganda Kompleks';
    else if (q.type === 'true_false') typeLabel = 'Pernyataan Benar / Salah';
    else if (q.type === 'matching') typeLabel = 'Menjodohkan';
    else if (q.type === 'short_essay') typeLabel = 'Isian Singkat';
    else if (q.type === 'long_essay') typeLabel = 'Uraian / Esai AI';

    if (typeLabel) {
      qHtml += `<p style="margin: 0 0 6px 24px; font-size: 9.5pt; color: #4338ca; font-weight: bold;">TIPE: ${typeLabel}</p>`;
    }

    if (q.type === 'mcq' || q.type === 'mcq_complex') {
      (q.options || []).forEach(opt => {
        qHtml += `<p style="margin: 0 0 4px 24px;"><strong>${opt.id}.</strong> ${opt.text || ''}</p>`;
      });
    } else if (q.type === 'true_false') {
      qHtml += `<table border="1" cellpadding="4" cellspacing="0" style="border-collapse: collapse; margin-left: 24px; margin-bottom: 6px; font-size: 10pt;">`;
      qHtml += `<tr style="background:#f3f4f6;"><th>No</th><th>Pernyataan</th>${includeKeys ? '<th>Kunci</th>' : '<th>Benar</th><th>Salah</th>'}</tr>`;
      (q.statements || []).forEach((st, sIdx) => {
        if (includeKeys) {
          qHtml += `<tr><td align="center">${sIdx + 1}</td><td>${st.text}</td><td align="center" style="font-weight:bold;color:${st.key === 'B' ? '#059669' : '#dc2626'};">${st.key || 'B'}</td></tr>`;
        } else {
          qHtml += `<tr><td align="center">${sIdx + 1}</td><td>${st.text}</td><td align="center">[ &nbsp; ]</td><td align="center">[ &nbsp; ]</td></tr>`;
        }
      });
      qHtml += `</table>`;
    } else if (q.type === 'matching') {
      qHtml += `<table border="1" cellpadding="4" cellspacing="0" style="border-collapse: collapse; margin-left: 24px; margin-bottom: 6px; font-size: 10pt;">`;
      qHtml += `<tr style="background:#f3f4f6;"><th>Premis / Konsep</th><th>Jodohkan dengan</th><th>Pilihan Target</th></tr>`;
      (q.premises || []).forEach((p, pIdx) => {
        const target = (q.targets || [])[pIdx];
        const arrow = (includeKeys && target) ? `➔ <strong>${target.id}</strong>` : '➔ [ &nbsp;&nbsp;&nbsp; ]';
        qHtml += `<tr><td>${p.text}</td><td align="center">${arrow}</td><td>${target ? `<strong>${target.id}.</strong> ${target.text}` : ''}</td></tr>`;
      });
      qHtml += `</table>`;
    } else if (q.type === 'short_essay') {
      qHtml += `<p style="margin: 0 0 4px 24px; color: #4b5563;"><em>Jawaban Singkat: _____________________________________________</em></p>`;
    } else if (q.type === 'long_essay') {
      if (q.rubric) {
        qHtml += `<p style="margin: 0 0 4px 24px; font-size: 9pt; color: #4b5563;"><em>RUBRIK: ${q.rubric}</em></p>`;
      }
      qHtml += `<div style="margin: 4px 0 6px 24px; border: 1px dashed #9ca3af; height: 100px; padding: 6px; font-size: 9pt; color: #6b7280;"><em>Lembar Uraian / Jawaban Siswa...</em></div>`;
    }

    if (includeKeys) {
      let keyVal = '';
      if (q.type === 'mcq') keyVal = q.answer || '-';
      else if (q.type === 'mcq_complex') keyVal = Array.isArray(q.answer) ? q.answer.join(', ') : q.answer;
      else if (q.type === 'true_false') keyVal = (q.statements || []).map(s => s.key).join('-');
      else if (q.type === 'matching') {
        if (typeof q.answer === 'object' && q.answer !== null) {
          keyVal = Object.entries(q.answer).map(([k, v]) => `${Number(k) + 1}-${v}`).join(', ');
        } else {
          keyVal = (q.premises || []).map((_, idx) => `${idx + 1}-${String.fromCharCode(65 + idx)}`).join(', ');
        }
      }
      else if (q.type === 'short_essay') keyVal = (q.answer_keys || []).join(' / ');
      else if (q.type === 'long_essay') keyVal = q.ideal_answer || (q.keywords ? `Kata Kunci: ${(q.keywords || []).join(', ')}` : 'Jawaban Esai Komprehensif');

      qHtml += `<div style="margin: 6px 0 0 24px; padding: 6px 10px; background: #ecfdf5; border-left: 4px solid #10b981; font-size: 9.5pt; color: #065f46;">`;
      qHtml += `<strong>KUNCI JAWABAN:</strong> ${keyVal}`;
      if (includeExplanation && q.explanation) {
        qHtml += ` &bull; <em>Pembahasan: ${q.explanation.replace(/<[^>]+>/g, ' ')}</em>`;
      }
      qHtml += `</div>`;
    }
    qHtml += `</div>`;
  });

  let modeDesc = 'Naskah Ujian Siswa (Siap Cetak)';
  if (includeKeys) {
    modeDesc = includeExplanation ? '<span style="color:#059669;font-weight:bold;">Master Guru (Kunci & Pembahasan)</span>' : '<span style="color:#059669;font-weight:bold;">Master Guru (Kunci Saja / Ringkas)</span>';
  }

  let headerHtml = '';
  if (includeHeader) {
    headerHtml = `
    <table class="kop" cellpadding="0" cellspacing="0">
      <tr>
        <td style="text-align: center; padding-bottom: 8px;">
          <h2 style="margin: 0; font-size: 16pt; text-transform: uppercase;">${esc(school || 'SMK NEGERI 5 BANDUNG')}</h2>
          <h3 style="margin: 2px 0; font-size: 13pt;">${esc(title)}</h3>
          <p style="margin: 0; font-size: 9.5pt; color: #4b5563;">NASKAH ASESMEN PEMBELAJARAN STANDAR TKA / CBT & LMS AI</p>
        </td>
      </tr>
    </table>
    <table class="meta" cellpadding="2" cellspacing="0">
      <tr>
        <td width="20%"><strong>Mata Pelajaran</strong></td><td width="30%">: ${esc(subject)}</td>
        <td width="20%"><strong>Kelas / Sasaran</strong></td><td width="30%">: ${esc(targetClass || 'Semua Kelas')}</td>
      </tr>
      <tr>
        <td><strong>Guru Pengampu</strong></td><td>: ${esc(teacher || 'Guru')}</td>
        <td><strong>Mode Dokumen</strong></td><td>: ${modeDesc}</td>
      </tr>
    </table>
    <hr style="border: 0; border-top: 1px solid #d1d5db; margin-bottom: 16px;"/>`;
  } else {
    headerHtml = `
    <div style="text-align: center; margin-bottom: 20px; border-bottom: 2px solid #374151; padding-bottom: 8px;">
      <h3 style="margin: 0; font-size: 14pt;">${esc(title || 'NASKAH ASESMEN')}</h3>
      <p style="margin: 4px 0 0 0; font-size: 10pt; color: #4b5563;">${modeDesc}</p>
    </div>`;
  }

  return `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
  <head>
    <meta charset='utf-8'>
    <title>${esc(title)}</title>
    <!--[if gte mso 9]>
    <xml>
      <w:WordDocument>
        <w:View>Print</w:View>
        <w:Zoom>100</w:Zoom>
      </w:WordDocument>
    </xml>
    <![endif]-->
    <style>
      @page { size: 21.0cm 29.7cm; margin: 2.0cm; mso-header-margin: 36pt; mso-footer-margin: 36pt; }
      body { font-family: 'Calibri', 'Arial', sans-serif; font-size: 11pt; line-height: 1.35; color: #111827; }
      table.kop { width: 100%; border-bottom: 3px double #000; margin-bottom: 15px; }
      table.meta { width: 100%; margin-bottom: 15px; font-size: 10pt; }
    </style>
  </head>
  <body>
    ${headerHtml}
    ${qHtml}
  </body>
  </html>`;
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
  if (pathname === '/kelola-soal' || pathname === '/bank-soal/kelola') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(path.join(WEB_DIR, 'kelola-soal.html')).pipe(res);
  }
  if (pathname === '/editor-soal' || pathname === '/soal/editor') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(path.join(WEB_DIR, 'editor-soal.html')).pipe(res);
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

  // POST /api/v1/cbt/upload-image (Unggah Gambar Soal / Stimulus / Opsi)
  if (pathname === '/api/v1/cbt/upload-image' && req.method === 'POST') {
    const body = await parseBody(req);
    if (!body.image_data) {
      return sendJSON(400, { status: 'error', message: 'Data gambar tidak ditemukan.' });
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
      const prefix = (body.prefix || 'soal').replace(/[^a-zA-Z0-9_-]/g, '');
      const filename = `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${safeExt}`;
      const filePath = path.join(STATIC_UPLOADS_DIR, filename);
      fs.writeFileSync(filePath, buffer);

      const fileUrl = `/static/uploads/${filename}`;
      return sendJSON(200, {
        status: 'success',
        message: 'Gambar berhasil diunggah!',
        file_url: fileUrl,
        filename: filename
      });
    } catch (err) {
      return sendJSON(500, { status: 'error', message: 'Gagal memproses unggahan gambar: ' + err.message });
    }
  }

// ==============================================================
  // ENDPOINTS: MASTER MATA PELAJARAN (MAPEL)
  // ==============================================================
  // GET /api/v1/cbt/subjects
  if (pathname === '/api/v1/cbt/subjects' && req.method === 'GET') {
    const enriched = MASTER_SUBJECTS.map(s => {
      const bankCount = QUESTION_BANKS.filter(b => (b.subject || '').toLowerCase().includes(s.name.toLowerCase()) || (b.subject || '').toLowerCase() === s.name.toLowerCase()).length;
      return {
        ...s,
        banks_count: bankCount
      };
    });
    return sendJSON(200, {
      status: 'success',
      data: enriched,
      total: enriched.length
    });
  }

  // POST /api/v1/cbt/subjects (Tambah Mapel Baru)
  if (pathname === '/api/v1/cbt/subjects' && req.method === 'POST') {
    const body = await parseBody(req);
    const name = (body.name || '').trim();
    if (!name) {
      return sendJSON(400, { status: 'error', message: 'Nama mata pelajaran wajib diisi!' });
    }
    const nextId = MASTER_SUBJECTS.length > 0 ? Math.max(...MASTER_SUBJECTS.map(s => s.id || 0)) + 1 : 1;
    const newSubject = {
      id: nextId,
      code: (body.code || name.substring(0, 4).toUpperCase()).trim(),
      name: name,
      level: (body.level || 'SMA/SMK').trim(),
      group: (body.group || 'Umum').trim()
    };
    MASTER_SUBJECTS.push(newSubject);
    saveSubjectsToFile();
    return sendJSON(200, {
      status: 'success',
      message: `Mata pelajaran "${newSubject.name}" berhasil ditambahkan!`,
      data: newSubject
    });
  }

  // POST /api/v1/cbt/subjects/delete atau DELETE /api/v1/cbt/subjects/:id
  if ((pathname === '/api/v1/cbt/subjects/delete' && req.method === 'POST') || (pathname.startsWith('/api/v1/cbt/subjects/') && req.method === 'DELETE')) {
    let subId = null;
    if (req.method === 'DELETE') {
      subId = parseInt(pathname.split('/').pop(), 10);
    } else {
      const body = await parseBody(req);
      subId = parseInt(body.id, 10);
    }
    const idx = MASTER_SUBJECTS.findIndex(s => s.id === subId);
    if (idx !== -1) {
      const removed = MASTER_SUBJECTS.splice(idx, 1)[0];
      saveSubjectsToFile();
      return sendJSON(200, { status: 'success', message: `Mata pelajaran "${removed.name}" berhasil dihapus.` });
    }
    return sendJSON(404, { status: 'error', message: 'Mata pelajaran tidak ditemukan' });
  }

  // ==============================================================
  // ENDPOINTS: MASTER DATA KELAS & ROMBEL
  // ==============================================================
  // GET /api/v1/cbt/classes
  if (pathname === '/api/v1/cbt/classes' && req.method === 'GET') {
    const enriched = MASTER_CLASSES.map(c => {
      const studentsInClass = USERS.filter(u => u.role === 'student' && (u.class_name || '').trim().toLowerCase() === c.name.trim().toLowerCase());
      return {
        ...c,
        student_count: studentsInClass.length
      };
    });
    return sendJSON(200, {
      status: 'success',
      data: enriched,
      total: enriched.length
    });
  }

  // POST /api/v1/cbt/classes (Tambah Kelas Baru)
  if (pathname === '/api/v1/cbt/classes' && req.method === 'POST') {
    const body = await parseBody(req);
    const name = (body.name || '').trim();
    if (!name) {
      return sendJSON(400, { status: 'error', message: 'Nama kelas wajib diisi!' });
    }
    const existing = MASTER_CLASSES.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      return sendJSON(400, { status: 'error', message: `Kelas "${name}" sudah ada dalam master data!` });
    }
    const nextId = MASTER_CLASSES.length > 0 ? Math.max(...MASTER_CLASSES.map(c => c.id || 0)) + 1 : 1;
    const newClass = {
      id: nextId,
      name: name,
      level: (body.level || (name.startsWith('XII') ? 'XII' : (name.startsWith('XI') ? 'XI' : 'X'))).trim(),
      major: (body.major || 'Umum').trim(),
      homeroom: (body.homeroom || '-').trim(),
      room: (body.room || 'Ruang Teori').trim()
    };
    MASTER_CLASSES.push(newClass);
    saveClassesToFile();
    return sendJSON(200, {
      status: 'success',
      message: `Kelas "${newClass.name}" berhasil ditambahkan!`,
      data: newClass
    });
  }

  // POST /api/v1/cbt/classes/delete atau DELETE /api/v1/cbt/classes/:id
  if ((pathname === '/api/v1/cbt/classes/delete' && req.method === 'POST') || (pathname.startsWith('/api/v1/cbt/classes/') && req.method === 'DELETE')) {
    let clsId = null;
    let clsName = null;
    if (req.method === 'DELETE') {
      const param = pathname.split('/').pop();
      clsId = parseInt(param, 10);
      if (isNaN(clsId)) clsName = decodeURIComponent(param);
    } else {
      const body = await parseBody(req);
      clsId = parseInt(body.id, 10);
      clsName = body.name;
    }
    const idx = MASTER_CLASSES.findIndex(c => (clsId && c.id === clsId) || (clsName && c.name.toLowerCase() === clsName.toLowerCase()));
    if (idx !== -1) {
      const removed = MASTER_CLASSES.splice(idx, 1)[0];
      saveClassesToFile();
      return sendJSON(200, { status: 'success', message: `Kelas "${removed.name}" berhasil dihapus.` });
    }
    return sendJSON(404, { status: 'error', message: 'Kelas tidak ditemukan' });
  }

  // GET /api/v1/cbt/classes/:name/students (Daftar Siswa dalam Kelas Tertentu)
  if (pathname.startsWith('/api/v1/cbt/classes/') && pathname.endsWith('/students') && req.method === 'GET') {
    const parts = pathname.split('/');
    const className = decodeURIComponent(parts[parts.length - 2]).trim();
    const students = USERS.filter(u => u.role === 'student' && (u.class_name || '').trim().toLowerCase() === className.toLowerCase());
    return sendJSON(200, {
      status: 'success',
      class_name: className,
      data: students,
      total: students.length
    });
  }

  // GET /api/v1/master/classes (Daftar Seluruh Kelas Tersedia di Sekolah Termasuk Preset Hingga 36 Kelas)
  if (pathname === '/api/v1/master/classes' && req.method === 'GET') {
    const studentClasses = USERS.filter(u => u.role === 'student' && u.class_name).map(u => u.class_name.trim());
    const masterClassNames = MASTER_CLASSES.map(c => c.name.trim());
    const scheduleClasses = [];
    SCHEDULES.forEach(s => {
      const norm = normalizeClassTarget(s.class_target);
      if (Array.isArray(norm)) scheduleClasses.push(...norm);
    });

    // Preset 36 kelas standar (X-1 s/d X-12, XI-1 s/d XI-12, XII-1 s/d XII-12)
    const presetClasses = [];
    ['X', 'XI', 'XII'].forEach(lvl => {
      for (let i = 1; i <= 12; i++) {
        presetClasses.push(`${lvl}-${i}`);
      }
    });

    const combinedSet = new Set([...masterClassNames, ...studentClasses, ...scheduleClasses, ...presetClasses].filter(Boolean));
    const sortedClasses = Array.from(combinedSet).sort((a, b) => a.localeCompare(b, 'id', { numeric: true }));

    return sendJSON(200, {
      status: 'success',
      classes: sortedClasses,
      total: sortedClasses.length,
      from_students: Array.from(new Set(studentClasses)),
    });
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

// POST /api/v1/master/classes/bulk-import (Import Massal Kelas via Excel)
  if (pathname === '/api/v1/master/classes/bulk-import' && req.method === 'POST') {
    const body = await parseBody(req);
    const list = body.classes || [];
    const overwrite = body.overwrite !== false;

    if (!Array.isArray(list) || list.length === 0) {
      return sendJSON(400, { status: 'error', message: 'Data kelas dari file Excel kosong atau tidak valid!' });
    }

    let addedCount = 0;
    let updatedCount = 0;
    let maxId = Math.max(...MASTER_CLASSES.map(c => c.id || 0), 0);

    for (const item of list) {
      const name = (item.name || item.class_name || item.kelas || '').toString().trim();
      if (!name) continue;

      const level = (item.level || item.tingkat || (name.startsWith('XII') ? 'XII' : (name.startsWith('XI') ? 'XI' : 'X'))).toString().trim();
      const major = (item.major || item.jurusan || item.program || 'Umum').toString().trim();
      const homeroom = (item.homeroom || item.wali_kelas || item.wali || '-').toString().trim();
      const room = (item.room || item.ruang || item.lab || 'Ruang Teori').toString().trim();

      const existingIdx = MASTER_CLASSES.findIndex(c => c.name.toLowerCase() === name.toLowerCase());
      if (existingIdx !== -1) {
        if (overwrite) {
          MASTER_CLASSES[existingIdx] = {
            ...MASTER_CLASSES[existingIdx],
            level,
            major,
            homeroom,
            room
          };
          updatedCount++;
        }
      } else {
        maxId++;
        MASTER_CLASSES.push({
          id: maxId,
          name,
          level,
          major,
          homeroom,
          room
        });
        addedCount++;
      }
    }

    saveClassesToFile();

    return sendJSON(200, {
      status: 'success',
      message: `Berhasil mengimpor kelas: ${addedCount} rombel baru ditambahkan, ${updatedCount} rombel diperbarui.`,
      data: { added: addedCount, updated: updatedCount, total: MASTER_CLASSES.length }
    });
  }

  // POST /api/v1/master/subjects/bulk-import (Import Massal Mata Pelajaran via Excel)
  if (pathname === '/api/v1/master/subjects/bulk-import' && req.method === 'POST') {
    const body = await parseBody(req);
    const list = body.subjects || [];
    const overwrite = body.overwrite !== false;

    if (!Array.isArray(list) || list.length === 0) {
      return sendJSON(400, { status: 'error', message: 'Data mata pelajaran dari file Excel kosong atau tidak valid!' });
    }

    let addedCount = 0;
    let updatedCount = 0;
    let maxId = Math.max(...MASTER_SUBJECTS.map(s => s.id || 0), 0);

    for (const item of list) {
      const name = (item.name || item.mapel || item.mata_pelajaran || '').toString().trim();
      if (!name) continue;

      const code = (item.code || item.kode || name.substring(0, 4).toUpperCase()).toString().trim();
      const level = (item.level || item.jenjang || 'SMA/SMK').toString().trim();
      const group = (item.group || item.kelompok || 'Umum').toString().trim();

      const existingIdx = MASTER_SUBJECTS.findIndex(s => s.name.toLowerCase() === name.toLowerCase() || s.code.toLowerCase() === code.toLowerCase());
      if (existingIdx !== -1) {
        if (overwrite) {
          MASTER_SUBJECTS[existingIdx] = {
            ...MASTER_SUBJECTS[existingIdx],
            name,
            code,
            level,
            group
          };
          updatedCount++;
        }
      } else {
        maxId++;
        MASTER_SUBJECTS.push({
          id: maxId,
          code,
          name,
          level,
          group
        });
        addedCount++;
      }
    }

    saveSubjectsToFile();

    return sendJSON(200, {
      status: 'success',
      message: `Berhasil mengimpor mata pelajaran: ${addedCount} mapel baru ditambahkan, ${updatedCount} mapel diperbarui.`,
      data: { added: addedCount, updated: updatedCount, total: MASTER_SUBJECTS.length }
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
        class_target: formatClassTargetDisplay(s.class_target),
        token_code: s.token_type === 'none' ? 'TANPA TOKEN' : s.token_code,
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

  
  // GET /api/v1/cbt/schedules/:id/attendance (Ambil Data Berita Acara & Absensi Ujian Terintegrasi)
  if (pathname.startsWith('/api/v1/cbt/schedules/') && pathname.endsWith('/attendance') && req.method === 'GET') {
    const parts = pathname.split('/');
    const schId = parseInt(parts[5], 10);
    const sch = SCHEDULES.find(s => s.id === schId);
    if (!sch) {
      return sendJSON(404, { status: 'error', message: 'Jadwal ujian tidak ditemukan' });
    }

    const classQuery = (parsedUrl.searchParams.get('class') || 'all').trim();
    const { classes: availableClasses } = getStudentsForSchedule(sch, 'all');
    const { students: targetStudents } = getStudentsForSchedule(sch, classQuery);

    const schAttendance = EXAM_ATTENDANCE[schId] || { students: {}, classes_meta: {}, default_meta: {} };
    const savedMeta = (schAttendance.classes_meta && schAttendance.classes_meta[classQuery]) || schAttendance.default_meta || {};
    const studentStatuses = schAttendance.students || {};

    const populatedStudents = targetStudents.map(st => {
      const rec = studentStatuses[st.id] || { status: 'hadir', reason: '', note: '' };
      return {
        id: st.id,
        username: st.username,
        full_name: st.full_name,
        class_name: st.class_name,
        exam_no: st.exam_no || `26-${st.class_name ? st.class_name.replace(/[^A-Za-z0-9]/g, '') : '01'}-${st.id}`,
        nisn: st.nisn || `0078${st.id}`,
        nis: st.nis || `2324${st.id}`,
        gender: st.gender || 'Laki-laki',
        room: st.room || 'Ruang Lab Komputer 01',
        session: st.session || 'Sesi 1 (07:30 - 09:30)',
        status: rec.status || 'hadir',
        reason: rec.reason || '',
        note: rec.note || ''
      };
    });

    const total = populatedStudents.length;
    const present = populatedStudents.filter(s => s.status === 'hadir').length;
    const absent = populatedStudents.filter(s => s.status === 'tidak_hadir').length;
    const absent_students = populatedStudents.filter(s => s.status === 'tidak_hadir');

    return sendJSON(200, {
      status: 'success',
      data: {
        schedule: sch,
        classes: availableClasses,
        selected_class: classQuery,
        school_profile: schoolProfile,
        attendance: {
          exam_date: savedMeta.exam_date || getIndonesianDateString(),
          start_time: savedMeta.start_time || sch.start_time || '07:30 WIB',
          end_time: savedMeta.end_time || '09:00 WIB',
          room: savedMeta.room || (populatedStudents[0]?.room || 'Ruang Lab Komputer 01'),
          session: savedMeta.session || (populatedStudents[0]?.session || 'Sesi 1'),
          proctor_1_name: savedMeta.proctor_1_name || 'Dra. Hj. Siti Aminah, M.Pd.',
          proctor_1_nip: savedMeta.proctor_1_nip || '19680512 199403 2 004',
          proctor_2_name: savedMeta.proctor_2_name || 'Rahmat Hidayat, S.Pd.',
          proctor_2_nip: savedMeta.proctor_2_nip || '19820719 200801 1 009',
          headmaster_name: savedMeta.headmaster_name || schoolProfile.headmaster_name || 'Drs. H. Ahmad Fauzi, M.Pd.',
          headmaster_nip: savedMeta.headmaster_nip || schoolProfile.headmaster_nip || '19710815 199802 1 003',
          notes: savedMeta.notes || 'Pelaksanaan ujian berlangsung tertib, aman, dan lancar.'
        },
        students: populatedStudents,
        summary: {
          total,
          present,
          absent,
          absent_students
        }
      }
    });
  }

  // POST /api/v1/cbt/schedules/:id/attendance (Simpan Status Kehadiran Siswa & Berita Acara)
  if (pathname.startsWith('/api/v1/cbt/schedules/') && pathname.endsWith('/attendance') && req.method === 'POST') {
    const parts = pathname.split('/');
    const schId = parseInt(parts[5], 10);
    const sch = SCHEDULES.find(s => s.id === schId);
    if (!sch) {
      return sendJSON(404, { status: 'error', message: 'Jadwal ujian tidak ditemukan' });
    }

    const body = await parseBody(req);
    const classTarget = (body.class_name || 'all').trim();

    if (!EXAM_ATTENDANCE[schId]) {
      EXAM_ATTENDANCE[schId] = { students: {}, classes_meta: {}, default_meta: {} };
    }

    if (body.students && typeof body.students === 'object') {
      for (const [stId, val] of Object.entries(body.students)) {
        EXAM_ATTENDANCE[schId].students[stId] = {
          status: val.status === 'tidak_hadir' ? 'tidak_hadir' : 'hadir',
          reason: String(val.reason || '').trim(),
          note: String(val.note || '').trim()
        };
      }
    }

    const metaObj = {
      exam_date: body.exam_date || getIndonesianDateString(),
      start_time: body.start_time || '07:30 WIB',
      end_time: body.end_time || '09:00 WIB',
      room: body.room || 'Ruang Lab Komputer 01',
      session: body.session || 'Sesi 1',
      proctor_1_name: body.proctor_1_name || '',
      proctor_1_nip: body.proctor_1_nip || '',
      proctor_2_name: body.proctor_2_name || '',
      proctor_2_nip: body.proctor_2_nip || '',
      notes: body.notes || 'Pelaksanaan ujian berlangsung tertib, aman, dan lancar.',
      updated_at: Date.now()
    };

    if (!EXAM_ATTENDANCE[schId].classes_meta) EXAM_ATTENDANCE[schId].classes_meta = {};
    EXAM_ATTENDANCE[schId].classes_meta[classTarget] = metaObj;
    EXAM_ATTENDANCE[schId].default_meta = { ...metaObj };

    saveExamAttendanceToFile();

    return sendJSON(200, {
      status: 'success',
      message: `Data Berita Acara & Absensi jadwal "${sch.title}" (${classTarget === 'all' ? 'Semua Kelas' : classTarget}) berhasil disimpan!`,
      data: {
        schedule_id: schId,
        class_name: classTarget,
        updated_at: metaObj.updated_at
      }
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
    const tokenType = ['none', 'dynamic'].includes(body.token_type) ? body.token_type : 'static';
    const tokenInterval = [5, 10, 15].includes(parseInt(body.token_interval, 10)) ? parseInt(body.token_interval, 10) : 15;
    let tokenCode = (body.token_code || '').trim().toUpperCase();
    if (tokenType === 'none') {
      tokenCode = 'TANPA TOKEN';
    } else if (!tokenCode) {
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
      class_target: formatClassTargetDisplay(body.class_target),
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
    if (body.class_target !== undefined) {
      sch.class_target = formatClassTargetDisplay(body.class_target);
    }
    if (body.token_type !== undefined) {
      const prevType = sch.token_type;
      sch.token_type = ['none', 'dynamic'].includes(body.token_type) ? body.token_type : 'static';
      if (sch.token_type === 'none') {
        sch.token_code = 'TANPA TOKEN';
      } else if (prevType !== 'dynamic' && sch.token_type === 'dynamic') {
        sch.token_updated_at = Date.now();
        if (!body.token_code || body.token_code === 'TANPA TOKEN') sch.token_code = generateRandomToken(6);
      } else if (body.token_code && body.token_code !== 'TANPA TOKEN') {
        sch.token_code = body.token_code.trim().toUpperCase();
      }
    }
    if (body.token_interval !== undefined) {
      sch.token_interval = [5, 10, 15].includes(parseInt(body.token_interval, 10)) ? parseInt(body.token_interval, 10) : 15;
    }
    if (body.token_code && sch.token_type !== 'none') sch.token_code = body.token_code.trim().toUpperCase();
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
    const studentObj = USERS.find(u => u.id === uid);
    const studentClass = studentObj ? studentObj.class_name : (user ? user.class_name : '');
    const schIdParam = parsedUrl.searchParams.get('schedule_id');

    let curSch = null;
    if (schIdParam) {
      curSch = SCHEDULES.find(s => s.id === parseInt(schIdParam, 10));
    } else {
      // Prioritaskan jadwal aktif yang cocok dengan target kelas siswa
      curSch = SCHEDULES.find(s => s.is_active !== false && isClassEligible(s.class_target, studentClass));
      if (!curSch) {
        curSch = SCHEDULES.find(s => s.is_active !== false) || SCHEDULES[0];
      }
    }

    if (!curSch) {
      return sendJSON(404, { status: 'error', message: 'Belum ada jadwal ujian aktif di server' });
    }

    // Validasi apakah kelas siswa berhak mengakses jadwal ini
    if (!isClassEligible(curSch.class_target, studentClass)) {
      const targetStr = formatClassTargetDisplay(curSch.class_target);
      return sendJSON(403, {
        status: 'error',
        code: 'CLASS_MISMATCH',
        message: `Jadwal ujian "${curSch.title}" khusus diperuntukkan bagi kelas: ${targetStr}. Siswa kelas ${studentClass || 'Anda'} tidak memiliki hak akses ke ujian ini.`,
        class_target: targetStr,
        student_class: studentClass,
      });
    }

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
        class_target: formatClassTargetDisplay(curSch.class_target),
        token_type: curSch.token_type || 'static',
        has_token: curSch.token_type !== 'none',
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
    const studentObj = USERS.find(u => u.id === uid);
    const studentClass = studentObj ? studentObj.class_name : (user ? user.class_name : '');
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

    // Cek apakah siswa berhak berdasarkan kelas target
    if (!isClassEligible(curSch.class_target, studentClass)) {
      const targetStr = formatClassTargetDisplay(curSch.class_target);
      return sendJSON(403, {
        status: 'error',
        code: 'CLASS_MISMATCH',
        message: `Jadwal ujian "${curSch.title}" khusus untuk kelas: ${targetStr}. Siswa kelas ${studentClass || 'Anda'} tidak diizinkan memulai ujian ini.`,
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

    if (curSch.token_type !== 'none') {
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

  // GET /api/v1/cbt/proctor/live-sessions (Monitoring Real-time Live Proktor & Nilai Multi-Tipe Soal TKA)
  if (pathname === '/api/v1/cbt/proctor/live-sessions' && req.method === 'GET') {
    const classFilter = parsedUrl.searchParams.get('class');
    const scheduleId = parseInt(parsedUrl.searchParams.get('schedule_id'), 10) || SCHEDULES[0]?.id || 1;
    const curSchedule = SCHEDULES.find((s) => s.id === scheduleId) || SCHEDULES[0];
    const schQuestions = getQuestionsForSchedule(curSchedule);

    // Kunci jawaban ringkas untuk kompatibilitas
    const answerKeys = {};
    schQuestions.forEach(q => {
      if (q.type === 'mcq') answerKeys[q.id] = q.answer;
      else if (q.type === 'mcq_complex') answerKeys[q.id] = Array.isArray(q.answer) ? q.answer.join(', ') : q.answer;
      else if (q.type === 'true_false') answerKeys[q.id] = (q.statements || []).map(s => `${s.key}`).join('-');
      else if (q.type === 'matching') answerKeys[q.id] = 'Matching Pairs';
      else if (q.type === 'short_essay') answerKeys[q.id] = (q.answer_keys || []).join(' / ');
      else if (q.type === 'long_essay') answerKeys[q.id] = 'Rubrik AI Esai';
      else answerKeys[q.id] = q.answer || '-';
    });

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
      const answeredCount = answeredKeys.filter((k) => userAnswers[k] && userAnswers[k].a !== undefined && userAnswers[k].a !== '').length;
      const isDoubt = answeredKeys.some((k) => userAnswers[k] && userAnswers[k].d === 1);

      // Evaluasi nilai komprehensif mendukung seluruh tipe soal TKA (PG, Kompleks, B/S, Jodoh, Isian, Esai AI)
      const evalResult = evaluateStudentAnswers(schQuestions, userAnswers);
      const score = evalResult.score;
      const correctCount = evalResult.correct_count;
      const wrongCount = evalResult.wrong_count;

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
        total_questions: schQuestions.length,
        is_doubt: isDoubt,
        tab_violations: sess.tab_violations || 0,
        ip_address: sess.ip_address || `192.168.1.${100 + (st.id % 100)}`,
        score: score,
        correct_count: correctCount,
        wrong_count: wrongCount,
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
      questions: schQuestions.map((q) => ({
        id: q.id,
        type: q.type || 'mcq',
        stem: q.stem,
        options: q.options || [],
        statements: q.statements || [],
        premises: q.premises || [],
        targets: q.targets || [],
        answer: q.answer || null,
        answer_keys: q.answer_keys || [],
        rubric: q.rubric || '',
        ideal_answer: q.ideal_answer || '',
        max_score: q.max_score || 100,
        keywords: q.keywords || [],
        weight: q.weight || 1.0,
        cog: q.cog || 'C2',
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

  // GET /api/v1/cbt/ai/config (Status API Server, Daftar Model Gemini Flash, dan Format Soal)
  if ((pathname === '/api/v1/cbt/ai/config' || pathname === '/api/v1/ai/config') && req.method === 'GET') {
    const srvKey = SERVER_CONFIG.gemini_api_key || process.env.GEMINI_API_KEY || process.env.AI_API_KEY || '';
    const masked = srvKey ? `${srvKey.substring(0, 7)}...${srvKey.substring(srvKey.length - 4)}` : null;

    return sendJSON(200, {
      status: 'success',
      data: {
        has_server_key: Boolean(srvKey),
        server_key_masked: masked,
        server_key_raw: srvKey,
        default_model: SERVER_CONFIG.default_model || 'gemini-3.5-flash',
        supported_models: [
          { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite (Super Cepat & Efisien)' },
          { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash (Keseimbangan Terbaik - Standar)', recommended: true },
          { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash (Penalaran TKA Ditingkatkan)' },
          { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash (Hybrid Reasoning & Multimodal)' },
          { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash (Deep Cognitive & HOTS SMA/SMK)' },
          { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
          { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
          { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' }
        ],
        supported_types: [
          { id: 'all', name: 'Campuran Semua Format TKA (Rekomendasi ANBK)' },
          { id: 'mcq', name: 'Pilihan Ganda Tunggal (PG Biasa 5 Opsi)' },
          { id: 'mcq_complex', name: 'Pilihan Ganda Kompleks (Multi-Jawaban)' },
          { id: 'true_false', name: 'Pernyataan Benar / Salah (Matriks B/S)' },
          { id: 'matching', name: 'Menjodohkan (Matching Pairs)' },
          { id: 'short_essay', name: 'Isian Singkat' },
          { id: 'long_essay', name: 'Uraian / Esai Panjang AI' }
        ]
      }
    });
  }

  // POST /api/v1/cbt/ai/config (Simpan Pengaturan API Key Server & Model Default Gemini)
  if (pathname === '/api/v1/cbt/ai/config' && req.method === 'POST') {
    const body = await parseBody(req);
    const { gemini_api_key, default_model } = body;

    if (gemini_api_key !== undefined) {
      SERVER_CONFIG.gemini_api_key = String(gemini_api_key).trim();
      process.env.GEMINI_API_KEY = SERVER_CONFIG.gemini_api_key;
      process.env.AI_API_KEY = SERVER_CONFIG.gemini_api_key;
    }
    if (default_model !== undefined) {
      SERVER_CONFIG.default_model = String(default_model).trim();
      process.env.AI_MODEL = SERVER_CONFIG.default_model;
    }

    // Simpan ke file .env agar persisten setelah restart
    try {
      const envPath = path.join(__dirname, '.env');
      let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
      if (envContent.includes('AI_API_KEY=')) {
        envContent = envContent.replace(/AI_API_KEY=.*(\n?\n|$)/, `AI_API_KEY=${SERVER_CONFIG.gemini_api_key}\n`);
      } else {
        envContent += `\nAI_API_KEY=${SERVER_CONFIG.gemini_api_key}\n`;
      }
      if (envContent.includes('AI_MODEL=')) {
        envContent = envContent.replace(/AI_MODEL=.*(\n?\n|$)/, `AI_MODEL=${SERVER_CONFIG.default_model}\n`);
      } else {
        envContent += `\nAI_MODEL=${SERVER_CONFIG.default_model}\n`;
      }
      fs.writeFileSync(envPath, envContent, 'utf8');
      console.log(`[AI Config] Berhasil memperbarui konfigurasi AI di .env (Model: ${SERVER_CONFIG.default_model})`);
    } catch (e) {
      console.warn('Gagal menyimpan ke .env:', e.message);
    }

    const srvKey = SERVER_CONFIG.gemini_api_key;
    const masked = srvKey ? `${srvKey.substring(0, 7)}...${srvKey.substring(srvKey.length - 4)}` : null;

    return sendJSON(200, {
      status: 'success',
      message: 'Pengaturan Kunci API Server & Model Default Gemini berhasil disimpan!',
      data: {
        has_server_key: Boolean(srvKey),
        server_key_masked: masked,
        default_model: SERVER_CONFIG.default_model
      }
    });
  }

  // POST /api/v1/cbt/ai/test-key (Uji Coba Konektivitas API Key Gemini)
  if (pathname === '/api/v1/cbt/ai/test-key' && req.method === 'POST') {
    const body = await parseBody(req);
    const testKey = (body.api_key || SERVER_CONFIG.gemini_api_key || '').trim();
    const testModel = (body.model || SERVER_CONFIG.default_model || 'gemini-3.5-flash').trim();

    if (!testKey) {
      return sendJSON(400, {
        status: 'error',
        message: 'Kunci API kosong. Masukkan API Key Google Gemini untuk diuji.'
      });
    }

    try {
      const https = require('https');
      let endpointModel = 'gemini-1.5-flash';
      if (testModel.includes('flash-lite')) endpointModel = 'gemini-1.5-flash-8b';
      else if (testModel.includes('pro')) endpointModel = 'gemini-1.5-pro';

      const payload = JSON.stringify({
        contents: [{ parts: [{ text: 'Balas dengan satu kata: OK' }] }],
        generationConfig: { maxOutputTokens: 10 }
      });

      const startTime = Date.now();
      await new Promise((resolve, reject) => {
        const reqApi = https.request(`https://generativelanguage.googleapis.com/v1beta/models/${endpointModel}:generateContent?key=${encodeURIComponent(testKey)}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          },
          timeout: 10000
        }, resApi => {
          let buf = '';
          resApi.on('data', c => buf += c);
          resApi.on('end', () => {
            if (resApi.statusCode >= 200 && resApi.statusCode < 300) {
              resolve({ ok: true, code: resApi.statusCode });
            } else {
              reject(new Error(`HTTP ${resApi.statusCode}: ${buf.substring(0, 150)}`));
            }
          });
        });
        reqApi.on('error', reject);
        reqApi.on('timeout', () => { reqApi.destroy(); reject(new Error('Timeout ke Google Gemini API')); });
        reqApi.write(payload);
        reqApi.end();
      });

      const latencyMs = Date.now() - startTime;
      return sendJSON(200, {
        status: 'success',
        message: `Koneksi Google Gemini API (${testModel}) Berhasil Terverifikasi! Latensi: ${latencyMs} ms.`,
        data: { active: true, model: testModel, latency_ms: latencyMs }
      });
    } catch (err) {
      return sendJSON(200, {
        status: 'warning',
        message: `Koneksi API langsung memberikan catatan: ${err.message}. Kunci tetap tersimpan, dan sistem memiliki Pedagogical Engine bawaan sebagai pengaman otomatis jika terjadi kendala kuota/koneksi saat generate.`,
        data: { active: false, error: err.message }
      });
    }
  }

  // POST /api/v1/cbt/ai/generate-questions (Eksekusi Pembuatan Butir Soal Nyata via Gemini Flash / BYOK / Server)
  if ((pathname === '/api/v1/cbt/ai/generate-questions' || pathname === '/api/v1/ai/generate-questions') && req.method === 'POST') {
    const body = await parseBody(req);
    const bankId = parseInt(body.bank_id, 10) || 1;
    const bank = QUESTION_BANKS.find(b => b.id === bankId) || QUESTION_BANKS[0];

    if (!bank) {
      return sendJSON(404, { status: 'error', message: 'Bank soal tujuan tidak ditemukan' });
    }

    const existingQuestions = bank.questions || [];
    const existingStems = existingQuestions.map(q => {
      const clean = (q.stem || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      return clean.length > 5 ? clean.substring(0, 160) : '';
    }).filter(Boolean);

    const basisType = body.basis_type || 'materi';
    const basisText = (body.basis_text || body.topic || bank.title || bank.subject || '').trim();
    const topic = (body.topic || basisText || bank.title || bank.subject || 'Konsep dan Aplikasi Pembelajaran').trim();
    const questionType = body.question_type || 'all';
    const cogLevel = body.cog_level || 'mixed';
    const count = Math.min(20, Math.max(1, parseInt(body.count || body.question_count, 10) || 5));
    const model = body.model || 'gemini-3.5-flash';
    const apiSource = body.api_source || 'server';
    const customPrompt = (body.custom_prompt || body.prompt_extra || '').trim();

    // Tentukan kunci API yang digunakan (BYOK vs Server Key)
    let effectiveKey = '';
    if (apiSource === 'byok' && body.api_key && body.api_key.trim()) {
      effectiveKey = body.api_key.trim();
    } else {
      effectiveKey = SERVER_CONFIG.gemini_api_key || process.env.GEMINI_API_KEY || process.env.AI_API_KEY || '';
    }

    console.log(`[AI Generator] Memproses ${count} soal (${questionType}) pada bank "${bank.title}" [Basis: ${basisType.toUpperCase()}] dengan model ${model} (Sumber: ${apiSource}, Eksisting: ${existingQuestions.length})...`);

    const { questions: rawGenerated, sourceUsed } = await generateQuestionsWithGeminiAI({
      topic,
      basis_type: basisType,
      basis_text: basisText,
      question_type: questionType,
      cog_level: cogLevel,
      count,
      model,
      effectiveKey,
      custom_prompt: customPrompt,
      existing_stems: existingStems,
      existingCount: existingQuestions.length
    });

    let startId = existingQuestions.length > 0 ? Math.max(...existingQuestions.map(q => q.id || 0)) + 1 : 1;

    const formattedQuestions = rawGenerated.map((q, idx) => {
      const qId = startId + idx;
      const baseQ = {
        id: qId,
        type: q.type || 'mcq',
        cog: q.cog || 'C2',
        stem: q.stem || `<p>Pertanyaan nomor ${qId} mengenai <strong>${topic}</strong></p>`,
        weight: Number(q.weight) || (q.type === 'long_essay' ? 3.0 : (q.type === 'matching' ? 2.0 : (q.type === 'mcq_complex' || q.type === 'true_false' ? 1.5 : 1.0))),
        explanation: q.explanation || `Pembahasan butir soal #${qId} terkait ${topic}.`,
        generated_by: model,
        source_engine: sourceUsed
      };

      if (baseQ.type === 'mcq') {
        baseQ.options = normalizeQuestionOptions(q.options) || [
          { id: 'A', text: 'Opsi jawaban A' },
          { id: 'B', text: 'Opsi jawaban B' },
          { id: 'C', text: 'Opsi jawaban C' },
          { id: 'D', text: 'Opsi jawaban D' },
          { id: 'E', text: 'Opsi jawaban E' }
        ];
        baseQ.answer = q.answer || 'A';
      } else if (baseQ.type === 'mcq_complex') {
        baseQ.options = normalizeQuestionOptions(q.options) || [
          { id: 'A', text: 'Opsi pernyataan A' },
          { id: 'B', text: 'Opsi pernyataan B' },
          { id: 'C', text: 'Opsi pernyataan C' },
          { id: 'D', text: 'Opsi pernyataan D' },
          { id: 'E', text: 'Opsi pernyataan E' }
        ];
        baseQ.answer = Array.isArray(q.answer) ? q.answer : ['A', 'C'];
      } else if (baseQ.type === 'true_false') {
        let statements = [];
        let ansMap = {};

        if (Array.isArray(q.statements) && q.statements.length > 0) {
          statements = q.statements.map((s, idx) => {
            const sid = s.id !== undefined ? s.id : idx;
            let key = (s.key || (typeof q.answer === 'object' && q.answer && q.answer[sid]) || 'B').toString().toUpperCase().trim();
            if (key.startsWith('B') || key === 'TRUE' || key === '1') key = 'B';
            else key = 'S';
            return {
              id: sid,
              text: s.text || (typeof s === 'string' ? s : `Pernyataan evaluasi analisis ${idx + 1}`),
              key: key
            };
          });
        } else if (Array.isArray(q.options) && q.options.length > 0) {
          // AI memberikan pernyataan di array options
          statements = q.options.map((opt, idx) => ({
            id: idx,
            text: opt.text || (typeof opt === 'string' ? opt : `Pernyataan evaluasi ${idx + 1}`),
            key: (opt.key || 'B').toString().toUpperCase().startsWith('B') ? 'B' : 'S'
          }));
        } else if (typeof q.answer === 'string' && q.answer.includes(',')) {
          // AI memberikan answer string "Benar, Benar, Salah"
          const tokens = q.answer.split(',').map(t => t.trim());
          statements = tokens.map((tok, idx) => ({
            id: idx,
            text: `Pernyataan analisis teknis ke-${idx + 1} terkait materi ${topic}`,
            key: tok.toUpperCase().startsWith('B') ? 'B' : 'S'
          }));
        }

        if (statements.length === 0) {
          statements = [
            { id: 0, text: `Konfigurasi dan implementasi parameter operasional ${topic} wajib diverifikasi fungsionalitasnya.`, key: 'B' },
            { id: 1, text: `Layanan ${topic} dapat diimplementasikan tanpa penyesuaian dependensi arsitektur jaringan lokal.`, key: 'S' },
            { id: 2, text: `Pemeriksaan catatan log berkala merupakan prosedur penting dalam menjaga keandalan sistem ${topic}.`, key: 'B' }
          ];
        }

        statements.forEach(s => {
          ansMap[s.id] = s.key;
        });

        baseQ.statements = statements;
        baseQ.answer = ansMap;
      } else if (baseQ.type === 'matching') {
        let premises = [];
        let targets = [];
        let ansMap = {};

        // 1. Ekstraksi premises
        if (Array.isArray(q.premises) && q.premises.length > 0) {
          premises = q.premises.map((p, idx) => ({
            id: p.id !== undefined ? p.id : idx,
            text: p.text || (typeof p === 'string' ? p : `Parameter ${idx + 1}`)
          }));
        } else if (Array.isArray(q.pairs) && q.pairs.length > 0) {
          premises = q.pairs.map((pr, idx) => ({
            id: idx,
            text: pr.left || pr.premise || pr.question || `Parameter ${idx + 1}`
          }));
        } else if (typeof q.answer === 'object' && q.answer !== null && !Array.isArray(q.answer)) {
          // AI memberikan mapping key: value di answer, e.g. { "option routers": "A", "max-lease-time": "B" }
          const keys = Object.keys(q.answer);
          if (keys.length > 0 && isNaN(Number(keys[0]))) {
            premises = keys.map((k, idx) => ({ id: idx, text: k }));
          }
        }

        // 2. Ekstraksi targets
        if (Array.isArray(q.targets) && q.targets.length > 0) {
          targets = q.targets.map((t, idx) => ({
            id: t.id || String.fromCharCode(65 + idx),
            text: t.text || (typeof t === 'string' ? t : `Pilihan fungsi ${String.fromCharCode(65 + idx)}`)
          }));
        } else if (Array.isArray(q.options) && q.options.length > 0) {
          targets = q.options.map((opt, idx) => ({
            id: opt.id || String.fromCharCode(65 + idx),
            text: opt.text || (typeof opt === 'string' ? opt : `Pilihan fungsi ${String.fromCharCode(65 + idx)}`)
          }));
        } else if (Array.isArray(q.pairs) && q.pairs.length > 0) {
          targets = q.pairs.map((pr, idx) => ({
            id: String.fromCharCode(65 + idx),
            text: pr.right || pr.target || pr.answer || `Pilihan fungsi ${String.fromCharCode(65 + idx)}`
          }));
        }

        // 3. Normalisasi answer mapping
        if (premises.length > 0) {
          if (typeof q.answer === 'object' && q.answer !== null && !Array.isArray(q.answer)) {
            premises.forEach((p, idx) => {
              if (q.answer[p.id] !== undefined) {
                ansMap[p.id] = q.answer[p.id];
              } else if (q.answer[p.text] !== undefined) {
                ansMap[p.id] = q.answer[p.text];
              } else {
                ansMap[p.id] = String.fromCharCode(65 + (idx % Math.max(1, targets.length)));
              }
            });
          } else {
            premises.forEach((p, idx) => {
              ansMap[p.id] = String.fromCharCode(65 + (idx % Math.max(1, targets.length)));
            });
          }
        }

        if (premises.length === 0) {
          premises = [
            { id: 0, text: `Parameter Konfigurasi Utama 1 (${topic})` },
            { id: 1, text: `Parameter Konfigurasi Utama 2 (${topic})` },
            { id: 2, text: `Parameter Konfigurasi Utama 3 (${topic})` }
          ];
        }
        if (targets.length === 0) {
          targets = [
            { id: 'A', text: `Fungsi operasional dan kontrol parameter 1 pada ${topic}` },
            { id: 'B', text: `Fungsi integrasi dan verifikasi layanan 2 pada ${topic}` },
            { id: 'C', text: `Fungsi proteksi dan pencatatan riwayat 3 pada ${topic}` }
          ];
          premises.forEach((p, idx) => {
            if (!ansMap[p.id]) ansMap[p.id] = String.fromCharCode(65 + idx);
          });
        }

        baseQ.premises = premises;
        baseQ.targets = targets;
        baseQ.answer = ansMap;
      } else if (baseQ.type === 'short_essay') {
        let keys = [];
        if (Array.isArray(q.answer_keys) && q.answer_keys.length > 0) {
          keys = q.answer_keys;
        } else if (typeof q.answer === 'string' && q.answer.trim()) {
          keys = [q.answer.trim()];
        } else if (q.ideal_answer) {
          keys = [String(q.ideal_answer).split(/[\s,.;]+/)[0]];
        }
        baseQ.answer_keys = keys.length > 0 ? keys : [topic.toLowerCase(), 'konfigurasi'];
      } else if (baseQ.type === 'long_essay') {
        baseQ.rubric = q.rubric || `Rubrik penilaian komprehensif konsep ${topic}. Aspek dinilai: ketepatan konsep (35%), alur analisis (35%), penyelesaian masalah (30%).`;
        baseQ.ideal_answer = q.ideal_answer || q.explanation || `Uraian jawaban ideal mengenai prinsip dan implementasi ${topic}.`;
        baseQ.max_score = Number(q.max_score) || 100;
        baseQ.keywords = Array.isArray(q.keywords) && q.keywords.length > 0 ? q.keywords : [String(topic).toLowerCase(), 'analisis', 'solusi'];
      }

      return baseQ;
    });

    bank.questions = existingQuestions.concat(formattedQuestions);
    saveQuestionBanksToFile();
    compileAndEncryptPackage();

    return sendJSON(200, {
      status: 'success',
      message: `Berhasil menghasilkan ${formattedQuestions.length} butir soal (${questionType}) untuk "${bank.title}" menggunakan ${model}!`,
      data: {
        bank_id: bank.id,
        bank_title: bank.title,
        generated_count: formattedQuestions.length,
        total_questions_in_bank: bank.questions.length,
        model_used: model,
        api_source_used: apiSource,
        source_engine: sourceUsed,
        questions: formattedQuestions
      }
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

  // ==============================================================
  // API BANK SOAL & ASESMEN TKA SMA/SMK (PG, Kompleks, B/S, Jodoh, Isian, Esai AI)
  // ==============================================================

  // GET /api/v1/cbt/question-banks/template-word (Unduh Template Word .docx / .doc)
  if ((pathname === '/api/v1/cbt/question-banks/template-word' || pathname === '/api/v1/cbt/questions/template-word') && req.method === 'GET') {
    const format = parsedUrl.searchParams.get('format') || 'docx';
    if (format === 'doc') {
      const htmlDoc = generateWordHtmlDocument({
        title: "TEMPLATE RESMI UPLOAD BUTIR SOAL CBT",
        school: schoolProfile.school_name || "SMK NEGERI 5 BANDUNG",
        subject: "Administrasi Sistem Jaringan / Umum",
        teacher: "Tim Asesmen Guru",
        targetClass: "Semua Kelas",
        questions: [
          {
            stem: "Layanan jaringan apa yang bertugas memberikan konfigurasi alamat IP secara otomatis kepada komputer klien?",
            type: "mcq",
            options: [
              { id: "A", text: "DNS (Domain Name System)" },
              { id: "B", text: "DHCP (Dynamic Host Configuration Protocol)" },
              { id: "C", text: "FTP (File Transfer Protocol)" },
              { id: "D", text: "SSH (Secure Shell)" },
              { id: "E", text: "NTP (Network Time Protocol)" }
            ],
            answer: "B",
            explanation: "DHCP berfungsi mengalokasikan alamat IP secara otomatis."
          },
          {
            stem: "Sebutkan perintah terminal lengkap di Ubuntu untuk menginstal paket web server Apache menggunakan apt!",
            type: "short_essay",
            answer_keys: ["sudo apt install apache2", "apt install apache2", "sudo apt-get install apache2"],
            explanation: "Perintah standar adalah 'sudo apt install apache2'."
          }
        ],
        includeKeys: true
      });
      res.writeHead(200, {
        'Content-Type': 'application/msword; charset=utf-8',
        'Content-Disposition': 'attachment; filename="Template_Upload_Soal_CBT.doc"',
        'Content-Length': Buffer.byteLength(htmlDoc, 'utf8')
      });
      return res.end(htmlDoc);
    }

    const docxBuf = generateDocxTemplate();
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': 'attachment; filename="Template_Upload_Soal_CBT.docx"',
      'Content-Length': docxBuf.length
    });
    return res.end(docxBuf);
  }

  // GET /api/v1/cbt/question-banks/:id/export-word (Export Bank Soal ke Word .docx / .doc)
  if (pathname.startsWith('/api/v1/cbt/question-banks/') && pathname.endsWith('/export-word') && req.method === 'GET') {
    const parts = pathname.split('/');
    const bankId = parseInt(parts[5], 10);
    const bank = QUESTION_BANKS.find(b => Number(b.id) === Number(bankId));
    if (!bank) {
      return sendJSON(404, { status: 'error', message: 'Bank soal tidak ditemukan' });
    }

    const mode = parsedUrl.searchParams.get('mode') || 'teacher'; // 'teacher' | 'teacher_compact' | 'student'
    const format = parsedUrl.searchParams.get('format') || 'docx'; // 'docx' vs 'doc'
    
    let includeKeys = (mode !== 'student');
    if (parsedUrl.searchParams.has('include_keys')) {
      includeKeys = parsedUrl.searchParams.get('include_keys') === '1' || parsedUrl.searchParams.get('include_keys') === 'true';
    }

    let includeExplanation = (mode === 'teacher');
    if (parsedUrl.searchParams.has('include_expl')) {
      includeExplanation = parsedUrl.searchParams.get('include_expl') === '1' || parsedUrl.searchParams.get('include_expl') === 'true';
    }

    let includeHeader = true;
    if (parsedUrl.searchParams.has('include_header')) {
      includeHeader = parsedUrl.searchParams.get('include_header') === '1' || parsedUrl.searchParams.get('include_header') === 'true';
    }

    const safeTitle = (bank.title || 'Bank_Soal').replace(/[^a-zA-Z0-9_-]/g, '_');
    let labelMode = 'Guru_Lengkap';
    if (!includeKeys) {
      labelMode = 'Siswa';
    } else if (!includeExplanation) {
      labelMode = 'Guru_Kunci_Saja';
    }

    if (format === 'doc') {
      const htmlDoc = generateWordHtmlDocument({
        title: bank.title,
        school: schoolProfile.school_name || "SMK NEGERI 5 BANDUNG",
        subject: bank.subject,
        teacher: bank.teacher,
        targetClass: bank.target_class,
        questions: bank.questions || [],
        includeKeys,
        includeExplanation,
        includeHeader
      });
      res.writeHead(200, {
        'Content-Type': 'application/msword; charset=utf-8',
        'Content-Disposition': `attachment; filename="Bank_Soal_${bank.id}_${safeTitle}_${labelMode}.doc"`,
        'Content-Length': Buffer.byteLength(htmlDoc, 'utf8')
      });
      return res.end(htmlDoc);
    }

    const docxBuf = generateDocxDocument({
      title: bank.title,
      school: schoolProfile.school_name || "SMK NEGERI 5 BANDUNG",
      subject: bank.subject,
      teacher: bank.teacher,
      targetClass: bank.target_class,
      questions: bank.questions || [],
      includeKeys,
      includeExplanation,
      includeHeader
    });

    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="Bank_Soal_${bank.id}_${safeTitle}_${labelMode}.docx"`,
      'Content-Length': docxBuf.length
    });
    return res.end(docxBuf);
  }

  // POST /api/v1/cbt/question-banks/import-word (Upload & Parse Naskah Word .docx / .doc)
  if ((pathname === '/api/v1/cbt/question-banks/import-word' || pathname === '/api/v1/cbt/questions/import-word') && req.method === 'POST') {
    const body = await parseBody(req);
    const bankId = parseInt(body.bank_id, 10) || 1;
    const bank = QUESTION_BANKS.find(b => Number(b.id) === Number(bankId)) || QUESTION_BANKS[0];

    let extractedText = '';
    if (body.file_base64) {
      try {
        const cleanBase64 = body.file_base64.replace(/^data:.*?;base64,/, '');
        const fileBuf = Buffer.from(cleanBase64, 'base64');
        extractedText = extractTextFromWordBuffer(fileBuf);
      } catch (err) {
        return sendJSON(400, { status: 'error', message: 'Gagal membaca berkas Word: ' + err.message });
      }
    } else if (body.raw_text) {
      extractedText = body.raw_text;
    } else {
      return sendJSON(400, { status: 'error', message: 'Tidak ada data berkas Word (.docx/.doc) atau teks yang diunggah.' });
    }

    const parsedQuestions = parseQuestionsFromWordText(extractedText);
    if (!parsedQuestions || parsedQuestions.length === 0) {
      return sendJSON(422, {
        status: 'warning',
        message: 'Tidak ditemukan format butir soal yang valid dalam dokumen. Pastikan penulisan soal bernomor (1., 2.), memiliki pilihan (A., B., C.), dan baris KUNCI: ...',
        extracted_text_preview: extractedText.substring(0, 300)
      });
    }

    const summary = {
      total: parsedQuestions.length,
      mcq: parsedQuestions.filter(q => q.type === 'mcq').length,
      mcq_complex: parsedQuestions.filter(q => q.type === 'mcq_complex').length,
      true_false: parsedQuestions.filter(q => q.type === 'true_false').length,
      matching: parsedQuestions.filter(q => q.type === 'matching').length,
      short_essay: parsedQuestions.filter(q => q.type === 'short_essay').length,
      long_essay: parsedQuestions.filter(q => q.type === 'long_essay').length,
    };

    return sendJSON(200, {
      status: 'success',
      message: `Berhasil mengidentifikasi ${parsedQuestions.length} butir soal dari dokumen Word!`,
      bank_id: bank.id,
      bank_title: bank.title,
      total: parsedQuestions.length,
      summary,
      questions: parsedQuestions
    });
  }

  // POST /api/v1/cbt/question-banks/:id/save-imported-questions (Simpan Butir Soal Terkonfirmasi ke Bank)
  if (pathname.startsWith('/api/v1/cbt/question-banks/') && pathname.endsWith('/save-imported-questions') && req.method === 'POST') {
    const parts = pathname.split('/');
    const bankId = parseInt(parts[5], 10);
    const bank = QUESTION_BANKS.find(b => Number(b.id) === Number(bankId));
    if (!bank) {
      return sendJSON(404, { status: 'error', message: 'Bank soal tujuan tidak ditemukan' });
    }

    const body = await parseBody(req);
    const newQuestions = body.questions || [];
    if (!Array.isArray(newQuestions) || newQuestions.length === 0) {
      return sendJSON(400, { status: 'error', message: 'Daftar butir soal yang akan disimpan kosong' });
    }

    const existingQuestions = bank.questions || [];
    let startId = existingQuestions.length > 0 ? Math.max(...existingQuestions.map(q => q.id || 0)) + 1 : 1;

    const formatted = newQuestions.map((q, idx) => ({
      id: startId + idx,
      type: q.type || 'mcq',
      cog: q.cog || 'C2',
      stem: sanitizeQuestionText(q.stem || 'Pertanyaan butir soal'),
      options: normalizeQuestionOptions(q.options),
      answer: q.answer || (q.options && q.options[0] ? q.options[0].id : null),
      answer_keys: Array.isArray(q.answer_keys) ? q.answer_keys : [q.answer_keys || ''],
      statements: normalizeStatements(q.statements),
      premises: normalizePremises(q.premises),
      targets: normalizeTargets(q.targets),
      rubric: q.rubric || '',
      ideal_answer: q.ideal_answer || '',
      max_score: Number(q.max_score) || 100,
      keywords: q.keywords || [],
      weight: Number(q.weight) || (q.type === 'long_essay' ? 3.0 : (q.type === 'matching' ? 2.0 : (q.type === 'mcq_complex' || q.type === 'true_false' ? 1.5 : 1.0))),
      explanation: sanitizeQuestionText(q.explanation || 'Pembahasan kunci jawaban terverifikasi.'),
      generated_by: 'import_word_docx',
      source_engine: 'word_document_parser'
    }));

    bank.questions = [...existingQuestions, ...formatted];
    saveQuestionBanksToFile();
    compileAndEncryptPackage();

    return sendJSON(200, {
      status: 'success',
      message: `Berhasil menambahkan ${formatted.length} butir soal dari berkas Word ke Bank Soal "${bank.title}"!`,
      added_count: formatted.length,
      total_questions: bank.questions.length
    });
  }

  // GET /api/v1/cbt/question-banks (Daftar Semua Bank Soal)
  if (pathname === '/api/v1/cbt/question-banks' && req.method === 'GET') {
    const data = QUESTION_BANKS.map(b => {
      const qTypes = [...new Set((b.questions || []).map(q => q.type || 'mcq'))];
      return {
        id: b.id,
        subject: b.subject,
        title: b.title,
        teacher: b.teacher,
        target_class: b.target_class,
        description: b.description,
        question_count: (b.questions || []).length,
        question_types: qTypes,
      };
    });
    return sendJSON(200, { status: 'success', data });
  }

  // GET /api/v1/cbt/question-banks/:id (Detail Bank Soal Beserta Butir Soal Lengkap)
  if (pathname.startsWith('/api/v1/cbt/question-banks/') && req.method === 'GET') {
    const parts = pathname.split('/');
    const lastPart = parts[parts.length - 1];
    const bankId = parseInt(lastPart === 'questions' ? parts[parts.length - 2] : lastPart, 10);
    const bank = QUESTION_BANKS.find(b => Number(b.id) === Number(bankId));
    if (!bank) {
      return sendJSON(404, { status: 'error', message: 'Bank soal tidak ditemukan' });
    }
    return sendJSON(200, { status: 'success', data: bank });
  }

  // POST /api/v1/cbt/question-banks/create (Buat Bank Soal Baru)
  if (pathname === '/api/v1/cbt/question-banks/create' && req.method === 'POST') {
    const body = await parseBody(req);
    const nextId = QUESTION_BANKS.length > 0 ? Math.max(...QUESTION_BANKS.map(b => b.id || 0)) + 1 : 1;
    const newBank = {
      id: nextId,
      subject: (body.subject || 'Mata Pelajaran').trim(),
      title: (body.title || `Bank Soal Baru #${nextId}`).trim(),
      teacher: (body.teacher || 'Guru Pengampu').trim(),
      target_class: (body.target_class || 'Semua Kelas').trim(),
      description: (body.description || '').trim(),
      questions: body.questions || []
    };
    QUESTION_BANKS.push(newBank);
    saveQuestionBanksToFile();
    return sendJSON(200, {
      status: 'success',
      message: `Bank soal "${newBank.title}" berhasil dibuat!`,
      data: newBank
    });
  }

  // POST /api/v1/cbt/question-banks/:id/update (Edit Informasi Bank Soal & Guru Pengampu)
  if (pathname.startsWith('/api/v1/cbt/question-banks/') && (pathname.endsWith('/update') || pathname.endsWith('/edit')) && req.method === 'POST') {
    const parts = pathname.split('/');
    const bankId = parseInt(parts[5], 10);
    const bank = QUESTION_BANKS.find(b => Number(b.id) === Number(bankId));
    if (!bank) {
      return sendJSON(404, { status: 'error', message: 'Bank soal tidak ditemukan' });
    }

    const body = await parseBody(req);
    if (body.title !== undefined) bank.title = String(body.title).trim();
    if (body.teacher !== undefined) bank.teacher = String(body.teacher).trim();
    if (body.subject !== undefined) bank.subject = String(body.subject).trim();
    if (body.target_class !== undefined) bank.target_class = String(body.target_class).trim();
    if (body.description !== undefined) bank.description = String(body.description).trim();

    saveQuestionBanksToFile();
    compileAndEncryptPackage();

    return sendJSON(200, {
      status: 'success',
      message: `Informasi bank soal #${bank.id} (${bank.title}) dan guru pengampu berhasil diperbarui!`,
      data: bank
    });
  }

  // POST /api/v1/cbt/question-banks/:id/add-question (Tambah Butir Soal Baru)
  if (pathname.startsWith('/api/v1/cbt/question-banks/') && pathname.endsWith('/add-question') && req.method === 'POST') {
    const parts = pathname.split('/');
    const bankId = parseInt(parts[5], 10);
    const bank = QUESTION_BANKS.find(b => Number(b.id) === Number(bankId));
    if (!bank) {
      return sendJSON(404, { status: 'error', message: 'Bank soal tidak ditemukan' });
    }
    const body = await parseBody(req);
    const questions = bank.questions || [];
    const nextQId = questions.length > 0 ? Math.max(...questions.map(q => q.id || 0)) + 1 : 1;

    const newQuestion = {
      id: nextQId,
      type: body.type || 'mcq',
      cog: body.cog || 'C2',
      stem: body.stem || 'Teks pertanyaan butir soal',
      weight: Number(body.weight) || 1.0,
      explanation: body.explanation || '',
    };

    if (newQuestion.type === 'mcq') {
      newQuestion.options = body.options || [];
      newQuestion.answer = body.answer || 'A';
    } else if (newQuestion.type === 'mcq_complex') {
      newQuestion.options = body.options || [];
      newQuestion.answer = Array.isArray(body.answer) ? body.answer : [body.answer || 'A'];
    } else if (newQuestion.type === 'true_false') {
      newQuestion.statements = body.statements || [];
      newQuestion.answer = body.answer || {};
    } else if (newQuestion.type === 'matching') {
      newQuestion.premises = body.premises || [];
      newQuestion.targets = body.targets || [];
      newQuestion.answer = body.answer || {};
    } else if (newQuestion.type === 'short_essay') {
      newQuestion.answer_keys = Array.isArray(body.answer_keys) ? body.answer_keys : [body.answer_keys || ''];
    } else if (newQuestion.type === 'long_essay') {
      newQuestion.rubric = body.rubric || '';
      newQuestion.ideal_answer = body.ideal_answer || '';
      newQuestion.max_score = Number(body.max_score) || 100;
      newQuestion.keywords = Array.isArray(body.keywords) ? body.keywords : (typeof body.keywords === 'string' ? body.keywords.split(',').map(s => s.trim()).filter(Boolean) : []);
    }

    questions.push(newQuestion);
    bank.questions = questions;
    saveQuestionBanksToFile();
    compileAndEncryptPackage();

    return sendJSON(200, {
      status: 'success',
      message: `Butir soal No. ${newQuestion.id} (${newQuestion.type}) berhasil ditambahkan ke "${bank.title}"!`,
      data: newQuestion
    });
  }

  // POST /api/v1/cbt/question-banks/:id/update-question/:qid (Edit / Update Butir Soal)
  if (pathname.startsWith('/api/v1/cbt/question-banks/') && pathname.includes('/update-question/') && req.method === 'POST') {
    const parts = pathname.split('/');
    const bankId = parseInt(parts[5], 10);
    const qId = parseInt(parts[7], 10);
    const bank = QUESTION_BANKS.find(b => Number(b.id) === Number(bankId));
    if (bank && bank.questions) {
      const qIndex = bank.questions.findIndex(q => Number(q.id) === Number(qId));
      if (qIndex !== -1) {
        const body = await parseBody(req);
        const existingQ = bank.questions[qIndex];
        const updatedQuestion = {
          ...existingQ,
          type: body.type || existingQ.type,
          cog: body.cog || existingQ.cog || 'C2',
          stem: body.stem || existingQ.stem,
          weight: Number(body.weight) !== undefined && !isNaN(Number(body.weight)) ? Number(body.weight) : (existingQ.weight || 1.0),
          explanation: body.explanation !== undefined ? body.explanation : existingQ.explanation,
        };
        if (updatedQuestion.type === 'mcq') {
          updatedQuestion.options = body.options || existingQ.options || [];
          updatedQuestion.answer = body.answer || existingQ.answer || 'A';
        } else if (updatedQuestion.type === 'mcq_complex') {
          updatedQuestion.options = body.options || existingQ.options || [];
          updatedQuestion.answer = Array.isArray(body.answer) ? body.answer : [body.answer || 'A'];
        } else if (updatedQuestion.type === 'true_false') {
          updatedQuestion.statements = body.statements || existingQ.statements || [];
          updatedQuestion.answer = body.answer || existingQ.answer || {};
        } else if (updatedQuestion.type === 'matching') {
          updatedQuestion.premises = body.premises || existingQ.premises || [];
          updatedQuestion.targets = body.targets || existingQ.targets || [];
          updatedQuestion.answer = body.answer || existingQ.answer || {};
        } else if (updatedQuestion.type === 'short_essay') {
          updatedQuestion.answer_keys = Array.isArray(body.answer_keys) ? body.answer_keys : [body.answer_keys || ''];
        } else if (updatedQuestion.type === 'long_essay') {
          updatedQuestion.rubric = body.rubric !== undefined ? body.rubric : existingQ.rubric;
          updatedQuestion.ideal_answer = body.ideal_answer !== undefined ? body.ideal_answer : existingQ.ideal_answer;
          updatedQuestion.max_score = Number(body.max_score) || existingQ.max_score || 100;
          updatedQuestion.keywords = Array.isArray(body.keywords) ? body.keywords : (typeof body.keywords === 'string' ? body.keywords.split(',').map(s => s.trim()).filter(Boolean) : existingQ.keywords || []);
        }
        bank.questions[qIndex] = updatedQuestion;
        saveQuestionBanksToFile();
        compileAndEncryptPackage();
        return sendJSON(200, { status: 'success', message: `Butir soal #${qId} berhasil diperbarui!`, data: updatedQuestion });
      }
    }
    return sendJSON(404, { status: 'error', message: 'Bank soal atau butir soal tidak ditemukan' });
  }

  // POST /api/v1/cbt/question-banks/:id/delete-question/:qid (Hapus Butir Soal)
  if (pathname.startsWith('/api/v1/cbt/question-banks/') && pathname.includes('/delete-question/') && req.method === 'POST') {
    const parts = pathname.split('/');
    const bankId = parseInt(parts[5], 10);
    const qId = parseInt(parts[7], 10);
    const bank = QUESTION_BANKS.find(b => Number(b.id) === Number(bankId));
    if (bank && bank.questions) {
      bank.questions = bank.questions.filter(q => Number(q.id) !== Number(qId));
      saveQuestionBanksToFile();
      compileAndEncryptPackage();
      return sendJSON(200, { status: 'success', message: `Butir soal #${qId} berhasil dihapus dari bank soal!` });
    }
    return sendJSON(404, { status: 'error', message: 'Bank soal atau butir soal tidak ditemukan' });
  }

  // POST /api/v1/cbt/question-banks/:id/restore-question (Undo / Pulihkan Butir Soal yang Dihapus)
  if (pathname.startsWith('/api/v1/cbt/question-banks/') && pathname.endsWith('/restore-question') && req.method === 'POST') {
    const parts = pathname.split('/');
    const bankId = parseInt(parts[5], 10);
    const body = await parseBody(req);
    const bank = QUESTION_BANKS.find(b => Number(b.id) === Number(bankId));
    if (bank && body.question) {
      if (!bank.questions) bank.questions = [];
      const insertIndex = (body.index !== undefined && body.index >= 0 && body.index <= bank.questions.length)
        ? body.index
        : bank.questions.length;
      bank.questions.splice(insertIndex, 0, body.question);
      saveQuestionBanksToFile();
      compileAndEncryptPackage();
      return sendJSON(200, { status: 'success', message: `Butir soal #${body.question.id} berhasil dipulihkan!` });
    }
    return sendJSON(400, { status: 'error', message: 'Gagal memulihkan butir soal' });
  }
// POST /api/v1/cbt/question-banks/:id/bulk-delete-questions (Hapus Sebagian Butir Soal Terpilih)
  if (pathname.startsWith('/api/v1/cbt/question-banks/') && pathname.endsWith('/bulk-delete-questions') && req.method === 'POST') {
    const parts = pathname.split('/');
    const bankId = parseInt(parts[5], 10);
    const body = await parseBody(req);
    const ids = Array.isArray(body.question_ids) ? body.question_ids.map(Number) : [];

    const bank = QUESTION_BANKS.find(b => b.id === bankId);
    if (!bank) {
      return sendJSON(404, { status: 'error', message: 'Bank soal tidak ditemukan' });
    }

    if (ids.length === 0) {
      return sendJSON(400, { status: 'error', message: 'Tidak ada butir soal yang dipilih untuk dihapus' });
    }

    const beforeCount = (bank.questions || []).length;
    const deleteSet = new Set(ids);
    bank.questions = (bank.questions || []).filter(q => !deleteSet.has(Number(q.id)));
    const deletedCount = beforeCount - bank.questions.length;

    saveQuestionBanksToFile();
    compileAndEncryptPackage();

    return sendJSON(200, {
      status: 'success',
      message: `Berhasil menghapus ${deletedCount} butir soal terpilih dari bank soal!`,
      data: { deletedCount, remainingCount: bank.questions.length }
    });
  }

  // POST /api/v1/cbt/question-banks/:id/clear-all-questions (Hapus SEMUA Butir Soal Sekaligus / Kosongkan Bank)
  if (pathname.startsWith('/api/v1/cbt/question-banks/') && pathname.endsWith('/clear-all-questions') && req.method === 'POST') {
    const parts = pathname.split('/');
    const bankId = parseInt(parts[5], 10);
    const bank = QUESTION_BANKS.find(b => b.id === bankId);
    if (!bank) {
      return sendJSON(404, { status: 'error', message: 'Bank soal tidak ditemukan' });
    }

    const totalDeleted = (bank.questions || []).length;
    bank.questions = [];

    saveQuestionBanksToFile();
    compileAndEncryptPackage();

    return sendJSON(200, {
      status: 'success',
      message: `Seluruh butir soal (${totalDeleted} butir) berhasil dikosongkan dari bank soal "${bank.title}"!`,
      data: { totalDeleted, remainingCount: 0 }
    });
  }

  // POST /api/v1/cbt/ai/grade-essay (Penilaian Esai Berbasis AI)
  if (pathname === '/api/v1/cbt/ai/grade-essay' && req.method === 'POST') {
    const body = await parseBody(req);
    const { question_stem, rubric, ideal_answer, student_answer, keywords, max_score, schedule_id, student_id, question_id } = body;

    const evalResult = gradeEssayWithAI({
      question_stem,
      rubric,
      ideal_answer,
      student_answer,
      keywords,
      max_score: max_score || 100
    });

    // Simpan ke session store jika schedule_id, student_id, question_id diberikan
    if (schedule_id && student_id && question_id) {
      const sessionKey = `${schedule_id}_${student_id}`;
      if (!studentAnswersStore[sessionKey]) studentAnswersStore[sessionKey] = {};
      if (!studentAnswersStore[sessionKey][question_id]) {
        studentAnswersStore[sessionKey][question_id] = { a: student_answer, d: 0 };
      }
      studentAnswersStore[sessionKey][question_id].ai_score = evalResult.score;
      studentAnswersStore[sessionKey][question_id].ai_feedback = evalResult.feedback;
      studentAnswersStore[sessionKey][question_id].ai_analysis = evalResult.analysis;
      if (studentSessions[sessionKey]) {
        studentSessions[sessionKey].answers = studentAnswersStore[sessionKey];
      }
    }

    return sendJSON(200, {
      status: 'success',
      message: 'Penilaian esai berbasis AI berhasil diproses!',
      data: evalResult
    });
  }

  // POST /api/v1/cbt/ai/batch-grade-essays (Koreksi Massal Seluruh Jawaban Esai via AI)
  if (pathname === '/api/v1/cbt/ai/batch-grade-essays' && req.method === 'POST') {
    const body = await parseBody(req);
    const schId = parseInt(body.schedule_id, 10) || 1;
    const curSch = SCHEDULES.find(s => s.id === schId) || SCHEDULES[0];
    const schQuestions = getQuestionsForSchedule(curSch);
    const essayQuestions = schQuestions.filter(q => q.type === 'long_essay');

    let gradedCount = 0;
    const students = USERS.filter(u => u.role === 'student');

    for (const st of students) {
      const sessionKey = `${curSch.id}_${st.id}`;
      const userAnswers = studentAnswersStore[sessionKey];
      if (!userAnswers) continue;

      for (const eq of essayQuestions) {
        const studentAns = userAnswers[eq.id];
        if (studentAns && studentAns.a && String(studentAns.a).trim().length > 0) {
          const evalResult = gradeEssayWithAI({
            question_stem: eq.stem,
            rubric: eq.rubric,
            ideal_answer: eq.ideal_answer,
            student_answer: studentAns.a,
            keywords: eq.keywords,
            max_score: eq.max_score || 100
          });
          studentAns.ai_score = evalResult.score;
          studentAns.ai_feedback = evalResult.feedback;
          studentAns.ai_analysis = evalResult.analysis;
          gradedCount++;
        }
      }
      if (studentSessions[sessionKey]) {
        studentSessions[sessionKey].answers = userAnswers;
      }
    }

    return sendJSON(200, {
      status: 'success',
      message: `Berhasil mengoreksi ${gradedCount} lembar jawaban esai dengan asistensi AI!`,
      graded_count: gradedCount
    });
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
