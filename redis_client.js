/**
 * Redis Client & Shared Session Cache Engine
 * High-Throughput In-Memory Session Storage untuk 1.700+ Siswa CBT
 * Native RESP (REdis Serialization Protocol) via Node.js net.Socket (Zero External Dependencies)
 */

const net = require('net');
const fs = require('fs');
const path = require('path');

const REDIS_CONFIG_FILE = path.join(__dirname, 'redis_config.json');

const defaultRedisConfig = {
  enabled: false,
  host: '127.0.0.1',
  port: 6379,
  password: '',
  db: 0,
  key_prefix: 'cbt:',
  auto_sync_sessions: true,
  timeout_ms: 2500
};

let currentConfig = { ...defaultRedisConfig };
let connectionStatus = {
  connected: false,
  latency_ms: 0,
  version: 'None',
  used_memory: '0B',
  peak_memory: '0B',
  connected_clients: 0,
  os: 'Unknown',
  cbt_keys_count: 0,
  last_checked: null,
  error: null
};

function loadRedisConfig() {
  try {
    if (fs.existsSync(REDIS_CONFIG_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(REDIS_CONFIG_FILE, 'utf8'));
      currentConfig = Object.assign({}, defaultRedisConfig, parsed);
    } else {
      currentConfig = { ...defaultRedisConfig };
      saveRedisConfig(currentConfig);
    }
  } catch (err) {
    console.error('[Redis Engine] Gagal membaca redis_config.json:', err.message);
    currentConfig = { ...defaultRedisConfig };
  }
  return currentConfig;
}

function saveRedisConfig(cfg) {
  currentConfig = Object.assign({}, currentConfig, cfg);
  try {
    fs.writeFileSync(REDIS_CONFIG_FILE, JSON.stringify(currentConfig, null, 2), 'utf8');

    // Sinkronkan ke .env jika file ada
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      const raw = fs.readFileSync(envPath, 'utf8');
      const lines = raw.split(/\r?\n/);
      let foundAddr = false, foundPass = false, foundDb = false;
      const updatedLines = lines.map(line => {
        if (line.startsWith('REDIS_ADDR=')) {
          foundAddr = true;
          return `REDIS_ADDR=${currentConfig.host}:${currentConfig.port}`;
        }
        if (line.startsWith('REDIS_PASSWORD=')) {
          foundPass = true;
          return `REDIS_PASSWORD=${currentConfig.password || ''}`;
        }
        if (line.startsWith('REDIS_DB=')) {
          foundDb = true;
          return `REDIS_DB=${currentConfig.db || 0}`;
        }
        return line;
      });
      if (!foundAddr) updatedLines.push(`REDIS_ADDR=${currentConfig.host}:${currentConfig.port}`);
      if (!foundPass) updatedLines.push(`REDIS_PASSWORD=${currentConfig.password || ''}`);
      if (!foundDb) updatedLines.push(`REDIS_DB=${currentConfig.db || 0}`);
      fs.writeFileSync(envPath, updatedLines.join('\n'), 'utf8');
    }
  } catch (err) {
    console.error('[Redis Engine] Gagal menyimpan redis_config.json:', err.message);
  }
  return currentConfig;
}

function sendRedisCommands(host, port, password, db, commands, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    let isResolved = false;
    let buffer = '';

    const done = (err, data) => {
      if (isResolved) return;
      isResolved = true;
      try { client.destroy(); } catch (e) {}
      if (err) reject(err);
      else resolve(data);
    };

    client.setTimeout(timeoutMs);
    client.on('timeout', () => done(new Error(`Koneksi Redis (${host}:${port}) timed out (${timeoutMs}ms)`)));
    client.on('error', (err) => done(new Error(`Gagal terhubung ke Redis (${host}:${port}): ${err.message}`)));

    client.connect(port, host, () => {
      let payload = '';
      if (password) {
        payload += `*2\r\n$4\r\nAUTH\r\n$${Buffer.byteLength(password)}\r\n${password}\r\n`;
      }
      if (db && db > 0) {
        payload += `*2\r\n$6\r\nSELECT\r\n$${String(db).length}\r\n${db}\r\n`;
      }

      for (const cmd of commands) {
        payload += `*${cmd.length}\r\n`;
        for (const arg of cmd) {
          const s = String(arg);
          payload += `$${Buffer.byteLength(s)}\r\n${s}\r\n`;
        }
      }

      client.write(payload);
    });

    client.on('data', (chunk) => {
      buffer += chunk.toString();
      done(null, buffer);
    });
  });
}

async function testRedisConnection(cfg) {
  const host = cfg.host || '127.0.0.1';
  const port = parseInt(cfg.port, 10) || 6379;
  const password = cfg.password || '';
  const db = parseInt(cfg.db, 10) || 0;
  const prefix = cfg.key_prefix || 'cbt:';

  const start = Date.now();
  try {
    const raw = await sendRedisCommands(host, port, password, db, [
      ['PING'],
      ['INFO', 'server'],
      ['INFO', 'memory'],
      ['INFO', 'clients'],
      ['KEYS', `${prefix}*`]
    ]);
    const latency = Date.now() - start;

    if (raw.includes('-ERR') || raw.includes('-WRONGPASS') || raw.includes('-NOAUTH')) {
      const errLine = raw.split(/\r?\n/).find(l => l.startsWith('-'));
      return {
        connected: false,
        latency_ms: latency,
        error: errLine ? errLine.substring(1) : 'Autentikasi Redis ditolak'
      };
    }

    const vMatch = raw.match(/redis_version:([^\r\n]+)/);
    const osMatch = raw.match(/os:([^\r\n]+)/);
    const memMatch = raw.match(/used_memory_human:([^\r\n]+)/);
    const peakMatch = raw.match(/used_memory_peak_human:([^\r\n]+)/);
    const clientsMatch = raw.match(/connected_clients:([^\r\n]+)/);

    let cbtKeysCount = 0;
    const keysIdx = raw.indexOf('*');
    if (keysIdx !== -1) {
      const countMatch = raw.substring(keysIdx).match(/^\*(\d+)/m);
      if (countMatch) cbtKeysCount = parseInt(countMatch[1], 10);
    }

    return {
      connected: true,
      latency_ms: latency,
      version: vMatch ? vMatch[1].trim() : 'Unknown',
      os: osMatch ? osMatch[1].trim() : 'Linux/Unix',
      used_memory: memMatch ? memMatch[1].trim() : '0B',
      peak_memory: peakMatch ? peakMatch[1].trim() : '0B',
      connected_clients: clientsMatch ? parseInt(clientsMatch[1].trim(), 10) : 1,
      cbt_keys_count: cbtKeysCount,
      host,
      port,
      db
    };
  } catch (err) {
    return {
      connected: false,
      latency_ms: Date.now() - start,
      error: err.message
    };
  }
}

async function refreshRedisHealth() {
  const result = await testRedisConnection(currentConfig);
  connectionStatus = {
    ...result,
    last_checked: new Date().toISOString()
  };
  return connectionStatus;
}

function saveSessionToRedis(sessionKey, sessionData) {
  if (!currentConfig.enabled || !connectionStatus.connected) return;
  const k = `${currentConfig.key_prefix}session:${sessionKey}`;
  const v = JSON.stringify(sessionData);
  sendRedisCommands(currentConfig.host, currentConfig.port, currentConfig.password, currentConfig.db, [
    ['SET', k, v]
  ]).catch(() => {});
}

async function syncAllSessionsToRedis(studentSessions, studentAnswersStore, activeExamStudents) {
  if (!connectionStatus.connected) {
    throw new Error('Redis belum terhubung. Pastikan host & port benar dan server Redis aktif.');
  }

  const commands = [];
  const prefix = currentConfig.key_prefix || 'cbt:';

  for (const [sKey, sObj] of Object.entries(studentSessions || {})) {
    const k = `${prefix}session:${sKey}`;
    const v = JSON.stringify({
      ...sObj,
      answers: (studentAnswersStore && studentAnswersStore[sKey]) || sObj.answers || {},
      synced_at: new Date().toISOString()
    });
    commands.push(['SET', k, v]);
  }

  const actArr = activeExamStudents ? (Array.isArray(activeExamStudents) ? activeExamStudents : Array.from(activeExamStudents)) : [];
  commands.push(['SET', `${prefix}active_students`, JSON.stringify(actArr)]);
  commands.push(['SET', `${prefix}last_sync_ts`, String(Date.now())]);

  if (commands.length > 0) {
    await sendRedisCommands(currentConfig.host, currentConfig.port, currentConfig.password, currentConfig.db, commands);
  }

  return commands.length;
}

async function flushAllCbtKeys() {
  if (!connectionStatus.connected) {
    throw new Error('Redis belum terhubung');
  }

  const prefix = currentConfig.key_prefix || 'cbt:';
  const raw = await sendRedisCommands(currentConfig.host, currentConfig.port, currentConfig.password, currentConfig.db, [
    ['KEYS', `${prefix}*`]
  ]);

  const lines = raw.split(/\r?\n/);
  const keysToDelete = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith(prefix)) {
      keysToDelete.push(line);
    }
  }

  if (keysToDelete.length > 0) {
    const delCmds = keysToDelete.map(k => ['DEL', k]);
    await sendRedisCommands(currentConfig.host, currentConfig.port, currentConfig.password, currentConfig.db, delCmds);
  }

  return keysToDelete.length;
}

// Inisialisasi awal saat server start
loadRedisConfig();
refreshRedisHealth().then(status => {
  if (status.connected && currentConfig.enabled) {
    console.log(`[Redis Engine] In-Memory Cache AKTIF di ${status.host}:${status.port} (v${status.version}, Latensi: ${status.latency_ms}ms, Mem: ${status.used_memory})`);
  } else {
    console.log(`[Redis Engine] Mode Fallback: RAM Internal aktif. (Redis: ${status.connected ? 'Tersedia' : 'Offline'})`);
  }
}).catch(() => {});

module.exports = {
  loadRedisConfig,
  saveRedisConfig,
  getRedisConfig: () => currentConfig,
  testRedisConnection,
  refreshRedisHealth,
  getRedisStatus: () => connectionStatus,
  saveSessionToRedis,
  syncAllSessionsToRedis,
  flushAllCbtKeys
};
