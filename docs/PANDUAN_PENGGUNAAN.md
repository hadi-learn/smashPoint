# Buku Panduan Penggunaan Aplikasi SmashPoint (User Manual)

Panduan ini berisi petunjuk langkah demi langkah bagi **Panitia / Operator Admin**, **Wasit (Referee)**, **Tim Dokumentasi Livestream (OBS/YouTube)**, dan **Teknisi Layar Lapangan/GOR** dalam mengoperasikan **SmashPoint**.

---

## Daftar Isi
1. [Persiapan Awal & Menjalankan Server](#1-persiapan-awal--menjalankan-server)
2. [Daftar URL Modul Aplikasi](#2-daftar-url-modul-aplikasi)
3. [Panduan Halaman Server Admin (`/admin`)](#3-panduan-halaman-server-admin-admin)
   - [3.1. Login & Manajemen User (Super Admin vs Admin Operasional)](#31-login--manajemen-user-super-admin-vs-admin-operasional)
   - [3.2. Mengelola Profil Turnamen (Multi-Turnamen)](#32-mengelola-profil-turnamen-multi-turnamen)
   - [3.3. Import & Live Auto-Sync Jadwal dari Google Sheets](#33-import--live-auto-sync-jadwal-dari-google-sheets)
   - [3.4. Setup Google Apps Script untuk Ekspor Otomatis (`Results` & `Logs`)](#34-setup-google-apps-script-untuk-ekspor-otomatis-results--logs)
   - [3.5. Melanjutkan Progres Turnamen di Laptop / PC Lain](#35-melanjutkan-progres-turnamen-di-laptop--pc-lain)
   - [3.6. Mengedit Pertandingan, Skor, Walkover (WO) & Papan Jadwal](#36-mengedit-pertandingan-skor-walkover-wo--papan-jadwal)
4. [Panduan Tablet Wasit / Referee (`/referee`)](#4-panduan-tablet-wasit--referee-referee)
   - [4.1. Memilih Pertandingan & Mengunci Sesi](#41-memilih-pertandingan--mengunci-sesi)
   - [4.2. Setup Posisi Pemain, Sisi Lapangan & Servis Pertama](#42-setup-posisi-pemain-sisi-lapangan--servis-pertama)
   - [4.3. Menjalankan Skoring Reli, Shuttlecock Counter & Interval](#43-menjalankan-skoring-reli-shuttlecock-counter--interval)
   - [4.4. Mengambil Alih Sesi (Emergency Takeover)](#44-mengambil-alih-sesi-emergency-takeover)
5. [Panduan Layar TV Lapangan (`/display`)](#5-panduan-layar-tv-lapangan-display)
6. [Panduan Overlay Livestream OBS / YouTube (`/display?mode=obs`)](#6-panduan-overlay-livestream-obs--youtube-displaymodeobs)
7. [Panduan Layar Multi-Lapangan LiveScore GOR (`/livescore`)](#7-panduan-layar-multi-lapangan-livescore-gor-livescore)

---

## 1. Persiapan Awal & Menjalankan Server

### Prasyarat
- **Node.js** versi 18 atau lebih baru terinstal di laptop/PC server utama.
- Seluruh perangkat (Laptop Admin, Tablet/HP Wasit, Smart TV Lapangan, PC OBS) terhubung pada **jaringan Wi-Fi / LAN yang sama**.

### Langkah Menjalankan Aplikasi
1. Buka terminal (*PowerShell* atau *Command Prompt*) di folder proyek `SmashPoint`.
2. Instal dependensi (hanya perlu sekali di awal):
   ```bash
   npm install
   ```
3. Salin konfigurasi `.env.example` menjadi `.env` (opsional, untuk mengubah PIN/Password bawaan):
   ```bash
   cp .env.example .env
   ```
   - `ADMIN_USERNAME` default: `admin`
   - `ADMIN_PIN` / `MASTER_PIN` default: `1234`
   - `COURT_COUNT` default: `15` (jumlah lapangan maksimal)
4. Jalankan server:
   - **Mode Produksi (Direkomendasikan saat hari H turnamen)**:
     ```bash
     npm run build
     npm start
     ```
   - **Mode Pengembangan**:
     ```bash
     npm run dev
     ```
5. Setelah berjalan, terminal akan menampilkan alamat akses lokal dan alamat IP LAN, contoh:
   ```text
   SmashPoint v2.1 (production) siap
   Lokal : http://localhost:3000
   LAN   : http://192.168.1.10:3000   <-- Buka alamat ini dari Tablet Wasit & Smart TV
   ```

---

## 2. Daftar URL Modul Aplikasi

Buka alamat IP server (misal `http://192.168.1.10:3000`) diikuti *path* berikut sesuai fungsi perangkat:

| Perangkat / Pengguna | URL Path | Fungsi Utama |
| :--- | :--- | :--- |
| **Beranda Utama** | `/` | Menu pintasan ke seluruh modul aplikasi |
| **Laptop Panitia / Admin** | `/admin` | Pusat kendali jadwal, pantau 15 lapangan, edit skor/WO, sinkronisasi Google Sheets |
| **Tablet / HP Wasit** | `/referee` | Panel wasit untuk memilih partai, mengatur posisi pemain, menghitung poin & *shuttlecock* |
| **TV Pinggir Lapangan** | `/display?court=1` | Papan skor layar penuh untuk Smart TV di Lapangan 1 (ganti angka `1` sesuai nomor lapangan) |
| **Overlay OBS / YouTube** | `/display?court=1&mode=obs` | *Scorebug* pojok kiri atas dengan latar transparan untuk *Browser Source* OBS |
| **OBS Green Screen** | `/display?court=1&mode=obs&bg=green` | *Scorebug* berlatar hijau `#00FF00` untuk *Window Capture + Chroma Key* di OBS |
| **Layar Proyektor GOR** | `/livescore` | Tampilan *Multi-Court LiveScore* (1 s/d 15 lapangan sekaligus) beserta grafik lapangan & histori reli |

---

## 3. Panduan Halaman Server Admin (`/admin`)

### 3.1. Login & Manajemen User (Super Admin vs Admin Operasional)
1. Buka `/admin`, lalu masuk menggunakan **Username** (default: `admin`) dan **Password** (default: `1234` atau sesuai `.env`).
2. Buka tab **👥 Manajemen User & Password**:
   - **Ubah Password Saya**: Semua admin dapat memperbarui nama tampilan dan *password* pribadinya.
   - **Tambah & Kelola Akun Admin (Khusus Super Admin)**:
     - **🛡️ Admin Operasional**: Dapat mengelola jadwal, mengedit pertandingan, dan mengatur profil turnamen, tetapi tidak bisa menghapus/mengubah akun user lain.
     - **👑 Super Admin**: Memiliki hak akses penuh termasuk membuat akun baru dan mereset *password* panitia lain.

### 3.2. Mengelola Profil Turnamen (Multi-Turnamen)
Di bagian atas halaman Admin terdapat bilah **🏆 PROFIL TURNAMEN AKTIF**:
- Gunakan fitur ini jika Anda menyelenggarakan beberapa turnamen berbeda (misal *Sesi Pagi*, *Sesi Siang*, atau *Kejuaraan Berbeda*).
- Klik **📂 Kelola / Buat Profil Turnamen** untuk membuat profil baru.
- Saat Anda berpindah profil melalui *dropdown* **Pindah Profil (Auto-Save)**, seluruh progres pertandingan, log, dan pengaturan Google Sheets pada profil sebelumnya otomatis tersimpan aman dan dapat dilanjutkan kapan saja.

### 3.3. Import & Live Auto-Sync Jadwal dari Google Sheets
Pada tab **🏟️ Pengendalian Pertandingan**, lihat kartu **📥 Import & Live Sync Jadwal**:
1. **Unduh Template**: Klik **⬇ Template CSV** untuk melihat format 19 kolom standar (`match_number`, `tournament_name`, `category_name`, `discipline`, `scoring_method`, `scoring_type`, `win_point`, `interval_point`, `team_a_p1_name`, dst.).
2. **Cara 1 — Live URL Google Sheets (Direkomendasikan)**:
   - Pastikan tab jadwal di Google Spreadsheet Anda bernama **`Jadwal`**.
   - Klik tombol **Bagikan (Share)** di kanan atas Google Sheets → ubah akses menjadi **"Siapa saja yang memiliki link (Anyone with the link)"**.
   - Salin URL dari *address bar* browser (`https://docs.google.com/spreadsheets/d/.../edit`) lalu tempelkan ke kolom **Link Google Sheets**.
   - Klik **⚡ Tarik & Update Sekarang**.
   - Anda juga dapat mengaktifkan **🔄 Auto-Sync Sheet** (misal *Setiap 10 detik* atau *Setiap 30 detik*) agar perubahan jadwal di Google Sheets otomatis masuk ke aplikasi secara *real-time*.
3. **Cara 2 — Tempel dari Excel/Sheets atau Upload File CSV**:
   - Pilih tab **Tempel dari Sheets/Excel** (blok tabel beserta baris *header* di Excel/Sheets, lalu *Copy-Paste*) atau tab **File CSV**.

### 3.4. Setup Google Apps Script untuk Ekspor Otomatis (`Results` & `Logs`)
Agar setiap pertandingan yang selesai otomatis mengirim hasil akhir, nama wasit, jumlah *shuttlecock*, dan waktu lokal ke Google Spreadsheet:
1. Pada kartu **📤 Ekspor, Cloud Sync & Pindah Laptop**, klik tombol kuning **📜 Kode Google Apps Script Terbaru**, lalu klik **📋 Salin Seluruh Kode**.
2. Buka Google Spreadsheet Anda → klik menu **Extensions (Ekstensi) → Apps Script**.
3. Hapus kode lama di editor Apps Script, **Paste (Tempel)** kode yang baru disalin, lalu tekan **Ctrl+S (Simpan)**.
4. Klik tombol biru **Deploy (Terapkan)** di kanan atas:
   - Jika baru pertama kali: Pilih **New deployment** → pilih jenis **Web app** → *Execute as*: **Me** → *Who has access*: **Anyone (Siapa saja)** → klik **Deploy**.
   - Jika memperbarui script yang sudah ada: Pilih **Manage deployments** → klik ikon **Pensil (Edit)** → pada bagian *Version* pilih **New version (Versi baru)** → klik **Deploy**.
5. Salin **Web App URL** (berakhiran `/exec`), tempelkan ke kolom **URL Web App Google Apps Script** di halaman Admin SmashPoint, lalu klik **💾 Simpan & 🧪 Tes Koneksi Webhook**.
6. Saat pertandingan selesai, Google Sheets otomatis membuat/memperbarui:
   - Tab **`Results`**: Hasil pertandingan, skor per set, pemenang, **`referee_name`** (nama wasit), **`shuttlecock_count`** (jumlah cock), serta **`started_at`** & **`finished_at`** dalam format waktu lokal komputer (`YYYY-MM-DD HH:mm:ss`).
   - Tab **`Logs`**: Riwayat detail poin demi poin beserta nama wasit dan jumlah cock.
   - Tab **`SmashPoint_State`**: Snapshot *state* turnamen untuk sinkronisasi antar-laptop.

### 3.5. Melanjutkan Progres Turnamen di Laptop / PC Lain
Jika Anda berpindah komputer/laptop di tengah penyelenggaraan turnamen, Anda **tidak perlu mengulang turnamen dari awal**:

- **Metode 1: Otomatis via Google Sheets (Cloud Sync)**
  1. Di laptop pertama, pastikan Webhook Google Apps Script sudah terhubung (atau klik tombol **☁️ Simpan Progres ke Cloud Sheet Sekarang** pada kartu Ekspor).
  2. Di laptop kedua, buka `/admin`, masukkan link Google Sheets yang sama pada kartu **Import & Live Sync Jadwal**, lalu klik **⚡ Tarik & Update Sekarang**.
  3. Aplikasi akan otomatis membaca tab `Jadwal` sekaligus memulihkan seluruh status pertandingan yang sudah selesai dari tab `Results` dan pertandingan *live* dari tab `SmashPoint_State`.

- **Metode 2: Menggunakan File Backup & Restore (`.json`) (Tanpa Internet)**
  1. Di laptop pertama, pada kartu **📤 Ekspor, Cloud Sync & Pindah Laptop**, klik tombol **💾 Backup Progres (.json)**. File `smashpoint-state-<profil>.json` akan terunduh.
  2. Kirim file tersebut ke laptop kedua (via Flashdisk / WhatsApp / LAN).
  3. Di laptop kedua, klik tombol **📂 Restore dari File (.json)** dan pilih file tersebut. Seluruh progres pertandingan, skor *live*, histori reli, dan log langsung pulih 100%.

### 3.6. Mengedit Pertandingan, Skor, Walkover (WO) & Papan Jadwal
1. **Menu 🗂️ Papan Jadwal & Progres**:
   - Menampilkan seluruh partai dalam kartu yang rapi.
   - Anda dapat menyusun kartu berdasarkan **🏟️ Per-Lapangan**, **🏅 Per-Kategori**, **📅 Per-Tanggal**, **🏸 Per-Disiplin**, atau **📊 Per-Status**, serta memilih tampilan **1, 2, atau 3 Kolom**.
   - Pilihan susunan dan jumlah kolom yang Anda pilih **otomatis tersimpan (*persist*)** meskipun Anda berpindah ke menu lain.
2. **Modal ✏️ Edit Lengkap Pertandingan**:
   - Klik tombol **✏️ Edit** pada baris pertandingan mana saja.
   - Anda dapat mengubah lapangan, memilih tanggal via **📅 Date Picker**, memilih jam via **🕒 Time Picker**, mengoreksi nama pemain/klub/*seeded*, mengubah skor & set aktif, mengubah jumlah *shuttlecock*, atau mengisi nama wasit.
   - **Keputusan Cepat WO / Diskualifikasi**: Klik tombol **🏆 Menangkan Tim A** atau **🏆 Menangkan Tim B** untuk langsung menyelesaikan pertandingan dengan status Walkover/Diskualifikasi.
   - **Kunci Perlindungan Auto-Sync (`🔒 DIEDIT PANITIA`)**: Setiap perubahan yang disimpan melalui menu Edit otomatis dikunci agar tidak tertimpa oleh *Auto-Sync* Google Sheets. Jika ingin mengembalikan agar mengikuti Sheet kembali, klik **↺ Buka Kunci (Ikuti Sheet)**.

---

## 4. Panduan Tablet Wasit / Referee (`/referee`)

### 4.1. Memilih Pertandingan & Mengunci Sesi
1. Buka `/referee` di tablet atau smartphone wasit.
2. **Isi Nama Wasit**: Ketik nama Anda pada kolom **Nama Wasit (Wajib)** di bagian atas.
3. Pilih filter **Lapangan** tempat Anda bertugas.
4. Gunakan tombol **👁️ Sembunyikan Selesai** agar daftar partai yang sudah selesai disembunyikan dan Anda langsung melihat partai berikutnya.
5. Klik partai yang akan dimulai, periksa detail aturan main (Rally Point / Side-Out, Sets / Continuous, Win Point, Interval Point), lalu klik **🔒 Kunci & Mulai Setup**.

### 4.2. Setup Posisi Pemain, Sisi Lapangan & Servis Pertama
1. **Tukar Sisi Lapangan (Kiri ↔ Kanan)**: Klik tombol **⇄ Tukar Sisi Lapangan (Kiri ↔ Kanan)** di bagian atas sesuai hasil undian koin (*toss*).
2. **Tukar Posisi Pemain (Atas ↔ Bawah)**: Untuk partai ganda, klik tombol **⇅ Tukar Posisi Atas ↔ Bawah** di sisi kiri atau kanan agar sesuai dengan posisi berdiri pemain di lapangan.
3. **Pilih Server & Receiver**: Klik tombol **🏸 Servis** pada pemain yang melakukan servis pertama, dan pastikan **🎯 Terima** terpilih pada pemain lawan di kotak diagonalnya.
4. Klik tombol hijau **▶ Mulai Pertandingan (0 - 0)**.

### 4.3. Menjalankan Skoring Reli, Shuttlecock Counter & Interval
1. **Menambah Poin / Memenangkan Reli**:
   - Tekan tombol besar **+1 / MENANG RELI** di sebelah kiri (untuk tim di sisi kiri lapangan) atau di sebelah kanan (untuk tim di sisi kanan lapangan).
   - Pada mode **Side-Out (Pindah Bola)**, aplikasi otomatis mengelola perpindahan **Servis Ke-1 ➔ Servis Ke-2 ➔ Pindah Bola** hingga poin bertambah.
2. **Menghitung Penggunaan Shuttlecock (`🏸 COCK`)**:
   - Di bagian tengah atas (di antara skor kedua tim), terdapat kontrol **🏸 COCK**.
   - Saat pertandingan dimulai, hitungan otomatis bernilai **`1 buah`**.
   - Setiap kali terjadi pergantian *shuttlecock* baru di lapangan, tekan tombol kuning **`+1 Cock`**. Jika salah tekan, gunakan tombol merah **`-`**.
3. **Membatalkan Aksi Terakhir (`UNDO`)**:
   - Jika salah menekan pemenang reli, klik tombol **↶ UNDO** di bagian bawah untuk mengembalikan skor dan posisi pemain ke reli sebelumnya.
4. **Saat Interval & Pindah Set**:
   - Ketika skor menyentuh poin interval (misal poin 11 pada mode *sets* atau poin 15 pada mode *continuous*), timer hitung mundur (**60 detik** untuk *sets*, **120 detik** untuk *continuous* dan *set break*) otomatis berjalan di bagian atas.
   - Peta lapangan di bawahnya **tetap menampilkan siapa pemain yang servis dan menerima servis** agar wasit tidak bingung setelah istirahat selesai.
   - Klik tombol **✔ Lanjutkan Pertandingan** setelah waktu istirahat selesai.
5. **Menyelesaikan Pertandingan**:
   - Saat poin kemenangan tercapai, klik tombol **🏆 Konfirmasi Hasil & Kirim**. Hasil otomatis terkirim ke Server Admin dan Google Sheets.

### 4.4. Mengambil Alih Sesi (Emergency Takeover)
- Jika tablet wasit kehabisan baterai atau terputus di tengah laga, buka `/referee` dari tablet cadangan, pilih pertandingan tersebut, lalu klik **🔑 Ambil Alih Sesi (Takeover)**.
- Masukkan **Master PIN** (default: `1234`). Tablet cadangan akan langsung mengambil alih kendali tanpa kehilangan satu poin pun.

---

## 5. Panduan Layar TV Lapangan (`/display`)

1. Buka `/display` pada Smart TV / PC monitor di pinggir lapangan, pilih mode **📺 Arena TV Monitor**, lalu klik nomor lapangan (misal **Court 1** -> `/display?court=1`).
2. Layar TV akan menampilkan:
   - **Header Atas**: Nomor Lapangan, Nama Turnamen, Kategori, Disiplin, Nomor Partai, serta **Badge ⏱ DURASI Berukuran Besar** di pojok kanan atas.
   - **Panel Kiri & Kanan**: Nama pemain dan klub sesuai sisi lapangan sebenarnya.
     - Pemain yang melakukan servis diberi *highlight* kuning/oranye (`1ST SERVE` / `2ND SERVE` / `SERVE`) beserta ikon *shuttlecock* besar di samping angka skor.
     - Pemain yang menerima servis diberi *highlight* biru muda (`PENERIMA`).
   - **Saat Pertandingan Selesai**: Layar otomatis menampilkan ringkasan 4 pertandingan sebelumnya, pemenang pertandingan yang baru selesai, serta 5 antrean pertandingan berikutnya di lapangan tersebut.
3. **Pindah Lapangan Tanpa Tombol Back**: Arahkan kursor ke pojok kanan bawah layar, klik tombol **⚙️ Court N · Pengaturan**, lalu pilih lapangan lain atau aktifkan **⛶ Fullscreen**.

---

## 6. Panduan Overlay Livestream OBS / YouTube (`/display?mode=obs`)

1. **Menambahkan ke OBS Studio (Rekomendasi: Browser Source Transparan)**:
   - Di OBS Studio, tambahkan *Source* baru → pilih **Browser**.
   - Masukkan URL: `http://<IP-SERVER>:3000/display?court=1&mode=obs` (ganti `court=1` sesuai lapangan yang disiarkan).
   - Atur **Width**: `1920` dan **Height**: `1080`.
   - *Scorebug* bergaya BWF World Tour akan tampil otomatis di pojok kiri atas dengan latar belakang transparan, lengkap dengan *Lower-Third Banner* otomatis saat *Interval*, *Set Break*, dan *Official Result*.
2. **Alternatif Chroma Key (Green Screen)**:
   - Gunakan URL: `http://<IP-SERVER>:3000/display?court=1&mode=obs&bg=green` jika menangkap layar menggunakan *Window Capture* + Filter *Chroma Key*.
3. **Menampilkan / Menyembunyikan Histori 10 Reli Terakhir di Livestream**:
   - Secara bawaan, histori reli disembunyikan agar *scorebug* tetap ringkas.
   - Saat momen seru atau ketika komentator/panitia ingin menampilkan grafik jalannya 10 reli terakhir, aktifkan melalui salah satu dari **3 cara** berikut:
     1. **Dari Halaman Admin (`/admin`)**: Pada kartu pemantauan lapangan di bagian atas, klik tombol **📊 Histori OBS: OFF ➔ ON** pada lapangan terkait.
     2. **Shortcut Keyboard di Layar Display/OBS**: Tekan tombol huruf **`H`** pada *keyboard*.
     3. **Dari Menu Dock Pojok Kanan Bawah Layar OBS**: Klik **⚙️ Pengaturan** di pojok kanan bawah → klik **📊 Histori Reli: ON (Tampil)**.
   - Ketika histori reli aktif, kotak **Skor Utama otomatis bergeser ke paling kanan** di sebelah kanan deretan kotak histori reli, sehingga progres kenaikan skor terlihat berurutan dari kiri ke kanan.

---

## 7. Panduan Layar Multi-Lapangan LiveScore GOR (`/livescore`)

1. Buka `/livescore` pada layar proyektor utama GOR, TV ruang tunggu pemain, atau layar informasi penonton.
2. **Pengaturan Tampilan di Pojok Kanan Atas**:
   - **Pilih Lapangan**: Klik chip `C1`, `C2`, dst. untuk memilih lapangan mana saja yang ingin ditampilkan (atau klik `Semua` / `Hanya Aktif`).
   - **Jumlah Kolom Grid**: Pilih `Auto`, `1 Kolom`, `2 Kolom`, `3 Kolom`, atau `4 Kolom`.
3. **Histori Reli Dinamis Otomatis (`Auto-Fit`)**:
   - Setiap kartu lapangan menampilkan visual lapangan bulu tangkis beserta pita **📊 N RALLY TERAKHIR** yang menyesuaikan jumlah kotaknya secara otomatis dengan lebar kartu (hingga ~40+ reli pada tampilan 1 lapangan, ~25+ reli pada tampilan 2 lapangan).
   - Kotak atas mewakili pemain/tim baris atas dan kotak bawah mewakili pemain/tim baris bawah secara sejajar vertikal, sehingga pemenang setiap reli dan perpindahan servis langsung terlihat jelas.
