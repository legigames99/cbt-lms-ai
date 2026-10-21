/**
 * ExamEngine: Local-First Client Engine for CBT
 * - Enkripsi/Dekripsi Web Crypto API (AES-256-GCM)
 * - Seeded Fisher-Yates Shuffle
 * - Local-First IndexedDB Cache
 * - Client-Side Debounce & Random Jitter Sync
 * - Anti-Cheat Visibility Tracking
 */

export class ExamEngine {
  constructor(scheduleId, studentId, token) {
    this.scheduleId = scheduleId;
    this.studentId = studentId;
    this.token = token;
    this.dbName = `cbt_exam_${scheduleId}`;
    this.db = null;
    this.questions = [];
    this.answers = {}; // { [questionId]: { a: "B", d: 0, ts: 1730000000 } }
    this.dirtyQuestions = new Set();
    this.violationCount = 0;
    this.syncIntervalId = null;
  }

  // 1. Inisialisasi IndexedDB Lokal
  async initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('packages')) {
          db.createObjectStore('packages', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('answers')) {
          db.createObjectStore('answers', { keyPath: 'question_id' });
        }
      };
      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };
      request.onerror = (event) => reject(event.target.error);
    });
  }

  // 2. Dekripsi Paket Soal menggunakan Web Crypto API di memori browser
  async decryptPackage(encryptedPackage, keyHex) {
    // Convert hex string key to Uint8Array
    const keyBytes = new Uint8Array(keyHex.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));
    const nonceBytes = new Uint8Array(encryptedPackage.nonce.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));
    const cipherBytes = new Uint8Array(encryptedPackage.ciphertext.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));

    const cryptoKey = await window.crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );

    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonceBytes },
      cryptoKey,
      cipherBytes
    );

    const decodedText = new TextDecoder().decode(decryptedBuffer);
    const parsedData = JSON.parse(decodedText);

    // Pengacakan Deterministik (Seeded Shuffle)
    const rawQuestions = Array.isArray(parsedData.questions) ? parsedData.questions : [];

    if (parsedData.shuffle_questions) {
      this.questions = this.seededShuffle(rawQuestions, `${this.scheduleId}_${this.studentId}_q`);
    } else {
      this.questions = [...rawQuestions];
    }

    if (parsedData.shuffle_options) {
      this.questions.forEach((q, idx) => {
        if (q && Array.isArray(q.options)) {
          q.options = this.seededShuffle(q.options, `${this.scheduleId}_${this.studentId}_opt_${idx}`);
        }
      });
    }

    return this.questions;
  }

  // 3. Algoritma Fisher-Yates Deterministik Berbasis PRNG Mulberry32
  seededShuffle(array, seedStr) {
    if (!Array.isArray(array) || array.length <= 1) return array || [];
    const arr = [...array].filter(Boolean);

    // Hash seedStr ke integer 32-bit unsigned
    let h = 0;
    for (let i = 0; i < seedStr.length; i++) {
      h = Math.imul(31, h) + seedStr.charCodeAt(i) | 0;
    }

    // Mulberry32 Generator (menghasilkan angka 0 <= r < 1 dengan jaminan selalu positif)
    let a = h >>> 0;
    const nextRandom = () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(nextRandom() * (i + 1));
      if (j >= 0 && j < arr.length) {
        const temp = arr[i];
        arr[i] = arr[j];
        arr[j] = temp;
      }
    }
    return arr.filter(Boolean);
  }

  // 4. Simpan Jawaban Siswa (Instan ke IndexedDB + Tandai Dirty untuk Jitter Sync)
  async saveAnswer(questionId, answerLetter, isDoubt = 0) {
    const payload = {
      a: answerLetter,
      d: isDoubt,
      ts: Math.floor(Date.now() / 1000),
    };
    this.answers[questionId] = payload;
    this.dirtyQuestions.add(questionId);

    // Simpan ke IndexedDB
    if (this.db) {
      const tx = this.db.transaction('answers', 'readwrite');
      tx.objectStore('answers').put({ question_id: questionId, ...payload });
    }
  }

  // 5. Background Jitter Sync ke Server (20-40 detik acak)
  startJitterSync(sessionId) {
    const sendBatch = async () => {
      if (this.dirtyQuestions.size === 0) return;

      const answersToSync = {};
      this.dirtyQuestions.forEach((qId) => {
        answersToSync[qId] = this.answers[qId];
      });

      try {
        const res = await fetch(`/api/v1/cbt/schedules/${this.scheduleId}/sync`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.token}`,
          },
          body: JSON.stringify({
            session_id: sessionId,
            answers: answersToSync,
            violation_delta: 0,
          }),
        });

        if (res.ok) {
          // Hapus dari daftar dirty jika server telah konfirmasi (ack)
          Object.keys(answersToSync).forEach((qId) => this.dirtyQuestions.delete(qId));
        }
      } catch (err) {
        console.warn('Gagal sinkronisasi jawaban, tetap tersimpan aman di IndexedDB:', err);
      }
    };

    const scheduleNext = () => {
      // Random Jitter: 20 detik s/d 40 detik
      const delay = Math.floor(Math.random() * 20000 + 20000);
      this.syncIntervalId = setTimeout(async () => {
        await sendBatch();
        scheduleNext();
      }, delay);
    };

    scheduleNext();
  }

  // 6. Anti-Cheat: Deteksi keluar tab / jendela browser
  initAntiCheat(onViolation) {
    this.isExamActive = true;

    // Deteksi akurat perpindahan tab atau minimize browser
    document.addEventListener('visibilitychange', () => {
      if (!this.isExamActive) return;
      if (document.hidden) {
        this.violationCount++;
        if (typeof onViolation === 'function') {
          onViolation(this.violationCount);
        }
      }
    });
  }

  stop() {
    this.isExamActive = false;
    if (this.syncIntervalId) {
      clearTimeout(this.syncIntervalId);
      this.syncIntervalId = null;
    }
  }
}
