# Spesifikasi Kebutuhan Sistem & Tuning Server
## Optimalisasi 1.700 Siswa Serentak pada 4 Core CPU & 4GB RAM

Dokumen ini merinci kebutuhan perangkat keras, perangkat lunak, pembagian anggaran memori (RAM Budgeting), dan konfigurasi *tuning* kernel/layanan.

---

### 1. Spesifikasi Minimum Server (VPS / Bare-Metal)
* **CPU:** 4 vCPU / Core (Arsitektur x86_64 atau ARM64, clock >= 2.4 GHz)
* **RAM:** 4 GB ECC / DDR4 (Ditambah Swap File 2 GB sebagai jaring pengaman darurat, dengan `vm.swappiness=10`)
* **Penyimpanan (Disk):** 60 GB NVMe SSD (Wajib SSD/NVMe untuk mendukung IOPS PostgreSQL dan Redis AOF)
* **Bandwidth Jaringan:** Minimal 100 Mbps simetris (Paket soal teks 50 nomor untuk 1.700 siswa hanya memakan total ~85 MB trafik saat *pre-fetch*).
* **Sistem Operasi:** Ubuntu Server 24.04 LTS atau Debian 12 (Minimal Install tanpa GUI).

---

### 2. Alokasi Anggaran RAM (4.096 MB Total)

| Layanan / Komponen | Batas Alokasi RAM | Persentase | Keterangan Teknis |
| :--- | :--- | :--- | :--- |
| **Linux Kernel + Systemd + Nginx** | ~300 MB | 7,3% | Nginx melayani SPA statis dan *reverse proxy*. |
| **Aplikasi Backend Go (`cbt-server`)** | ~250 MB | 6,1% | Dikontrol dengan `GOMEMLIMIT=250MiB`. |
| **Redis Server (`redis-server`)** | 512 MB | 12,5% | Dibatasi keras dengan `maxmemory 512mb`. |
| **PostgreSQL 16 + `pgxpool`** | ~1.500 MB | 36,6% | `shared_buffers=512MB`, max 80 koneksi. |
| **OS Page Cache & Buffer Bebas** | ~1.534 MB | 37,5% | Digunakan kernel Linux untuk meng-cache file paket soal di RAM. |

---

### 3. Daftar Perangkat Lunak (Tech Stack Versions)
* **Bahasa Backend:** Go (Golang) `v1.23+` (Framework: Fiber v2 atau Echo v4)
* **Database Utama:** PostgreSQL `v16+`
* **In-Memory Store:** Redis `v7.2+`
* **Web Server / Proxy:** Nginx `v1.24+`
* **Frontend:** SvelteKit (Static Adapter) atau Vue 3 + Vite + Dexie.js (Wrapper `IndexedDB`)
* **Object Storage:** Cloudflare R2 / AWS S3 Compatible
* **AI Provider:** Google Gemini API (`gemini-2.5-flash`) / OpenAI API dengan *Structured JSON Outputs*

---

### 4. Konfigurasi Tuning Layanan

#### A. Tuning Kernel Linux (`/etc/sysctl.d/99-cbt-tuning.conf`)
Agar server sanggup menerima ribuan koneksi TCP serentak tanpa ditolak oleh kernel:
```ini
net.core.somaxconn = 8192
net.ipv4.tcp_max_syn_backlog = 8192
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 15
fs.file-max = 2097152
vm.swappiness = 10
vm.overcommit_memory = 1
```

#### B. Tuning PostgreSQL (`/etc/postgresql/16/main/postgresql.conf`)
Khusus untuk server 4 Core CPU dan alokasi 1,5 GB RAM:
```ini
max_connections = 100
shared_buffers = 512MB
effective_cache_size = 2GB
maintenance_work_mem = 128MB
checkpoint_completion_target = 0.9
wal_buffers = 16MB
default_statistics_target = 100
random_page_cost = 1.1
effective_io_concurrency = 200
work_mem = 4MB
min_wal_size = 512MB
max_wal_size = 2GB
max_worker_processes = 4
max_parallel_workers_per_gather = 2
max_parallel_workers = 4
synchronous_commit = off
```
*Catatan Penting:* `synchronous_commit = off` meningkatkan kecepatan *Bulk Upsert* PostgreSQL hingga 3x lipat tanpa risiko korupsi database.

#### C. Tuning Redis (`/etc/redis/redis.conf`)
```ini
maxmemory 512mb
maxmemory-policy volatile-lru
tcp-backlog 4096
timeout 300
tcp-keepalive 60
appendonly yes
appendfsync everysec
```

#### D. Tuning Nginx (`/etc/nginx/nginx.conf`)
```nginx
worker_processes auto; # Otomatis mengikuti 4 Core CPU
worker_rlimit_nofile 65535;

events {
    worker_connections 8192;
    use epoll;
    multi_accept on;
}

http {
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 30;
    types_hash_max_size 2048;

    # Kompresi Gzip/Brotli untuk paket soal JSON
    gzip on;
    gzip_comp_level 5;
    gzip_min_length 256;
    gzip_types application/json text/css application/javascript;

    # Cache file paket soal statis di memori
    open_file_cache max=2000 inactive=20s;
    open_file_cache_valid 60s;
    open_file_cache_min_uses 2;
    open_file_cache_errors on;
}
```
