# Panduan Git, Struktur Repositori & CI/CD GitHub
## Deployment Otomatis ke Server 4 Core / 4GB RAM

Dokumen ini berisi langkah standar untuk menginisialisasi repositori Git, aturan keamanan file (`.gitignore`), dan pipa *Continuous Deployment* menggunakan GitHub Actions.

---

### 1. File `.gitignore` Wajib
Pastikan file rahasia, kunci enkripsi soal, dan hasil backup tidak pernah ter-*upload* ke GitHub:

```gitignore
# Binary & Build Artifacts
/bin/
cbt-server
*.exe
*.out

# Environment & Rahasia
.env
.env.production
*.pem
*.key

# Paket Soal Terenkripsi & Backup Lokal
/static/packages/*.json
*.dump
*.rdb
*.aof
*.zst

# Dependencies Frontend & OS
node_modules/
/web/dist/
/web/.svelte-kit/
.DS_Store
```

---

### 2. Perintah Inisialisasi & Push Pertama ke GitHub

Jalankan perintah berikut di terminal lokal Anda:

```bash
# 1. Inisialisasi Git di folder proyek
git init
git branch -M main

# 2. Tambahkan seluruh dokumen blueprint & kode awal
git add prd.md database.md backup.md restore.md api.md requirements.md roadmap.md design.md log.md pushgithub.md readme.md
git add .

# 3. Buat commit pertama dengan standar Conventional Commits
git commit -m "docs(blueprint): initialize architectural documentation for CBT+LMS AI system"

# 4. Hubungkan ke repositori GitHub Anda (Ganti URL sesuai repo Anda)
git remote add origin git@github.com:username-anda/cbt-lms-ai.git

# 5. Push ke branch main
git push -u origin main
```

---

### 3. Strategi Branching
* `main` : Branch produksi yang stabil. Setiap *push* atau *tag release* (`v1.0.0`) di branch ini otomatis memicu *build* di GitHub Actions.
* `staging` : Branch pengujian terintegrasi sebelum jadwal ujian sekolah dimulai.
* `feat/*` : Branch pengembangan fitur baru (contoh: `feat/ai-question-generator`, `feat/lms-presigned-upload`).

---

### 4. GitHub Actions CI/CD (`.github/workflows/deploy.yml`)
Kompilasi aplikasi Go dan Frontend dilakukan **di server GitHub Actions (bukan di VPS 4GB RAM)** agar CPU dan RAM VPS Anda tidak terbebani oleh proses `go build` atau `npm run build`:

```yaml
name: Build & Deploy CBT-LMS Binary

on:
  push:
    tags:
      - 'v*'

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Source Code
        uses: actions/checkout@v4

      - name: Setup Go 1.23
        uses: actions/setup-go@v5
        with:
          go-version: '1.23'

      - name: Build Optimized Static Go Binary
        run: |
          CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o cbt-server ./cmd/server/main.go

      - name: Copy Binary to VPS via SCP
        uses: appleboy/scp-action@v0.1.7
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          source: "cbt-server"
          target: "/opt/cbt/bin/"

      - name: Restart CBT Service on VPS
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            sudo chmod +x /opt/cbt/bin/cbt-server
            sudo systemctl restart cbt-backend
```
