/**
 * Otomatisasi Pencadangan Database CBT & LMS AI
 * Menggabungkan seluruh data master, bank soal, jadwal, dan siswa ke dalam format JSON & SQL.
 */
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const backupDir = path.join(rootDir, 'backups');
const latestDir = path.join(backupDir, 'latest');
const sqlDir = path.join(backupDir, 'sql');

if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
if (!fs.existsSync(latestDir)) fs.mkdirSync(latestDir, { recursive: true });
if (!fs.existsSync(sqlDir)) fs.mkdirSync(sqlDir, { recursive: true });

const filesToBackup = [
  'question_banks.json',
  'students.json',
  'schedules.json',
  'classes.json',
  'subjects.json',
  'school_profile.json'
];

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const consolidated = {
  backup_info: {
    system: 'CBT & LMS Terintegrasi AI (Pusmendik / ANBK Standard)',
    created_at: new Date().toISOString(),
    timestamp_local: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
    version: '2.0.0-PROD'
  },
  statistics: {},
  data: {}
};

filesToBackup.forEach(filename => {
  const filePath = path.join(rootDir, filename);
  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const key = filename.replace('.json', '');
    consolidated.data[key] = parsed;
    consolidated.statistics[key] = Array.isArray(parsed) ? parsed.length : 1;
    fs.copyFileSync(filePath, path.join(latestDir, filename));
  }
});

const consolidatedPath = path.join(backupDir, 'cbt_database_master_backup.json');
fs.writeFileSync(consolidatedPath, JSON.stringify(consolidated, null, 2), 'utf8');

// Timestamped snapshot
const snapshotPath = path.join(backupDir, `cbt_backup_${timestamp}.json`);
fs.writeFileSync(snapshotPath, JSON.stringify(consolidated, null, 2), 'utf8');

console.log(`[Backup Engine] Berhasil mencadangkan database CBT ke ${consolidatedPath}`);
console.log(`[Backup Engine] Snapshot waktu: ${snapshotPath}`);
