# Product Requirements Document (PRD) — SmashPoint v2.2
**Sistem Skoring, Display Arena, LiveScore Multi-Lapangan & Broadcast Overlay Bulu Tangkis Real-Time**

- **Versi Dokumen**: 2.2 (Status Implementasi Terbaru)
- **Tanggal Pembaruan**: 10 November 2026
- **Status**: *Production-Ready* (17/17 Automated Test Suites Lulus)
- **Repositori**: `smashPoint` (Next.js 15 + Node.js HTTP Server + Socket.io)

---

## 1. Ringkasan Eksekutif (Executive Summary)

**SmashPoint** adalah *Dedicated Multi-Court Match Scoring, LiveScore & Broadcast Display Engine* berbasis web real-time untuk turnamen bulu tangkis. Dirancang dengan arsitektur **Offline-First LAN + Cloud Google Sheets Hybrid**, SmashPoint memungkinkan panitia menyelenggarakan turnamen hingga **15 lapangan secara simultan** (mendukung 15 tablet wasit, 30 layar TV arena, layar proyektor LiveScore GOR, serta overlay *livestreaming* OBS/YouTube bergaya BWF World Tour).

---

## 2. Arsitektur Sistem & Alur Data

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                        GOOGLE SPREADSHEET (CLOUD HYBRID)                         │
│  • Tab "Jadwal"           : Sumber jadwal pertandingan (Live Sync / Import)      │
│  • Tab "Results"          : Hasil akhir, skor set, durasi, wasit & jumlah cock   │
│  • Tab "Logs"             : Audit trail per-reli lengkap + wasit & jumlah cock   │
│  • Tab "SmashPoint_State" : Snapshot progres real-time untuk pindah laptop/PC    │
└───────────────────▲──────────────────────────────────────────┬───────────────────┘
                    │ Auto-Export / Cloud State Sync           │ Live Pull & Auto-Restore
                    │ (Google Apps Script Webhook)             ▼
┌───────────────────┴──────────────────────────────────────────────────────────────┐
│               SMASHPOINT HUB SERVER (Node.js + Next.js + Socket.io)              │
│  • Multi-Tournament Profile Manager (data/profiles/<id>/db.json)                 │
│  • Pure Scoring State Machine (Rally Point & Side-Out, Sets & Continuous)        │
│  • Exclusive Session Manager (Device Lock, Heartbeat 10s, Master PIN Takeover)   │
│  • Role-Based Access Control (Super Admin & Admin Operasional)                   │
└─────▲──────────────────────┬─────────────────────────┬───────────────────────┬───┘
      │                      │                         │                       │
      ▼                      ▼                         ▼                       ▼
┌───────────────┐    ┌──────────────────┐    ┌───────────────────┐   ┌───────────────────┐
│ TABLET WASIT  │    │ LAYAR TV ARENA   │    │  OBS / YOUTUBE    │   │   LAYAR VENUE     │
│  (/referee)   │    │ (/display?court) │    │  OVERLAY STREAM   │   │  MULTI-LIVESCORE  │
│ • Setup Posisi│    │ • Skor Raksasa   │    │ (/display?mode=obs│   │   (/livescore)    │
│ • Skoring Reli│    │ • Highlight Srv/ │    │ • BWF Scorebug    │   │ • 1 s/d 15 Court  │
│ • Hitung Cock │    │   Receiver       │    │ • On-Demand 10    │   │ • Visual Lapangan │
│ • Timer Break │    │ • Durasi 2x Besar│    │   Rally History   │   │ • Auto-Fit History│
└───────────────┘    └──────────────────┘    └───────────────────┘   └───────────────────┘
```

---

## 3. Daftar Lengkap Fitur yang Sudah Diimplementasikan (Current Progress)

### 3.1. Mesin Skoring Bulu Tangkis (`lib/engine.js`)
1. **Dukungan Penuh Metode Skoring**:
   - **Rally Point (`rally_point`)**: Setiap reli menghasilkan poin bagi pemenang reli. Mendukung *deuce* otomatis (selisih 2 poin hingga batas `max_point`, default `win_point + 9` untuk mode *sets*).
   - **Side-Out / Pindah Bola (`side_out`)**: Poin hanya bertambah jika tim yang memegang servis memenangkan reli.
     - Untuk nomor **Ganda (`MD`, `WD`, `XD`)**: Servis pembuka (*0-0*) dimulai langsung dari **Servis Ke-2 (`turn = 2`)** sesuai aturan klasik pindah bola. Setelah pindah servis berikutnya, tim mendapatkan **Servis Ke-1 (`turn = 1`)** lalu **Servis Ke-2 (`turn = 2`)** sebelum pindah bola (`SIDE_OUT`).
     - Untuk nomor **Tunggal (`MS`, `WS`)**: Kegagalan reli oleh pemegang servis langsung mengakibatkan pindah bola (`SIDE_OUT`).
2. **Dukungan Tipe Pertandingan**:
   - **Sets (`sets` - Best of 3)**: Pertandingan dimenangkan oleh tim pertama yang merebut 2 set.
   - **Continuous (`continuous` - 1 Game Panjang)**: Pertandingan 1 set panjang (misal target 30 poin atau 42 poin).
3. **Rotasi Kotak Lapangan & Servis Presisi**:
   - Penentuan posisi pemain di kotak Kanan (*Even*) dan Kiri (*Odd*) secara otomatis maupun manual saat *Setup*.
   - Indikator visual dan kalkulasi otomatis siapa **Pelaku Servis (*Server*)** dan siapa **Penerima Servis (*Receiver*)** di setiap reli.
4. **Sistem Interval & Pindah Lapangan (BWF Standard & Continuous)**:
   - Saat skor mencapai `interval_point`, papan skor otomatis mengunci sementara dan menampilkan status **INTERVAL**.
   - **Timer Countdown Istirahat Otomatis**:
     - **Interval Mode Sets**: **60 detik (1 menit)**, dengan peringatan panggil pemain di sisa 20 detik.
     - **Interval Mode Continuous**: **120 detik (2 menit)** disertai instruksi tukar sisi lapangan otomatis (`interval_swap`).
     - **Pergantian Set (`set_break`)**: **120 detik (2 menit)** disertai pertukaran sisi lapangan dan setup set berikutnya.
5. **Pencatatan Histori Reli & Servis (`rally_history`)**:
   - Setiap reli mencatat nomor reli, set, pemenang reli, skor kedua tim setelah reli, sisi pemegang servis, status servis ke-1 / servis ke-2, dan status pindah bola (*side-out*).
6. **Pencatatan Penggunaan Shuttlecock (`shuttlecock_count`)**:
   - Saat pertandingan dimulai (`SETUP_START`), jumlah *shuttlecock* otomatis disetel ke **1**.
   - Wasit dapat menambah (`+1 Cock`) atau mengoreksi (`-1`) penggunaan *shuttlecock* kapan saja selama laga berlangsung.
   - Aksi penambahan *shuttlecock* dicatat ke *audit log*, namun **tidak merusak tumpukan UNDO skor** (jika wasit menekan *Undo* poin, jumlah *shuttlecock* tetap terjaga).

---

### 3.2. Modul Tablet Wasit / Referee (`/referee`)
1. **Pemilihan Pertandingan Ergonomis**:
   - Filter cepat berdasarkan Lapangan (*Court*), Pencarian Nama/Nomor Partai, serta tombol **Sembunyikan/Tampilkan Selesai** agar wasit tidak perlu *scroll* jauh melewati partai yang sudah berakhir.
2. **Validasi Wajib Nama Wasit**:
   - Wasit wajib mengisi **Nama Wasit** sebelum dapat mengklik **Kunci & Mulai Setup**. Nama wasit disimpan pada sesi pertandingan, ditampilkan di halaman Admin, dan diekspor ke laporan Google Sheets (`Results` & `Logs`).
3. **Layar Setup Posisi Lapangan Interaktif**:
   - Pertukaran sisi lapangan Kiri ↔ Kanan (`SWAP_SIDES`), pertukaran posisi pemain Atas ↔ Bawah per tim (`SWAP_TEAM_POS`), dan pemilihan langsung siapa *Server* pertama serta *Receiver* pertama.
4. **Layar Kendali Pertandingan Live**:
   - Tombol raksasa **+1 Poin / Menang Reli** di sisi Kiri dan Kanan lapangan.
   - Visualisasi lapangan 2D lengkap dengan garis vektor arah servis animasi (*animated shuttlecock trajectory*) dari kotak *Server* menuju kotak *Receiver*.
   - **Panel Istirahat / Interval Non-Blocking**: Ketika *Interval* atau *Set Break* berlangsung, informasi *Countdown Timer* dan tombol konfirmasi tampil di bagian atas tanpa menutupi visual lapangan, sehingga wasit tetap dapat melihat jelas siapa pemain yang melakukan servis dan menerima servis berikutnya.
   - **Widget Shuttlecock Elegan**: Berada di baris tengah di antara skor kedua tim dengan tombol `-`, indikator jumlah `N buah`, dan tombol `+1 Cock`.
   - **Kontrol Skala Teks (`A-` / `A+`)** dan **Orientasi Layar** agar nyaman di berbagai ukuran tablet/HP.

---

### 3.3. Modul Layar TV Lapangan / Arena Display (`/display?court=N`)
1. **Desain Kontras Tinggi untuk Jarak Jauh**:
   - Menampilkan identitas turnamen, kategori, disiplin, nomor partai, dan nomor lapangan di *header*.
   - **Tidak menampilkan tulisan "VS"** di tengah layar karena penonton dan pemain sudah mengetahui kedua sisi berhadapan.
   - **Badge Durasi Berukuran 2x Lipat**: Terletak di pojok kanan atas *header* dengan label **⏱ DURASI** dan angka waktu *real-time* berukuran ekstra besar agar terbaca jelas oleh pemain maupun penonton dari kejauhan.
2. **Highlight Server & Receiver**:
   - Pemain yang memegang servis diberi *highlight* kuning keemasan (atau oranye untuk *2nd Serve*) dengan label `1ST SERVE` / `2ND SERVE` / `SERVE` serta ikon *shuttlecock* berkedip di samping angka skor raksasa.
   - Pemain lawan yang menjadi **Penerima Servis (*Receiver*)** juga diberi *highlight* warna biru muda (*cyan*) beserta badge **`PENERIMA`**.
3. **Layar Transisi Otomatis Saat Pertandingan Selesai**:
   - Menampilkan hingga **4 Riwayat Pertandingan Sebelumnya** di lapangan tersebut (bagian atas), **Hasil Pertandingan yang Baru Saja Selesai** lengkap dengan pemenang dan skor set (bagian tengah), serta **5 Antrean Pertandingan Berikutnya** dengan *highlight* khusus pada partai selanjutnya (`HARAP BERSIAP`).

---

### 3.4. Modul Overlay Livestream YouTube / OBS (`/display?court=N&mode=obs`)
1. **Scorebug Standar Turnamen Internasional BWF**:
   - Terletak presisi di pojok kiri atas (`top: 28px; left: 36px`).
   - Mendukung 3 mode latar: **Transparan** (untuk *OBS Browser Source*), **Chroma Key Green Screen `#00FF00`** (untuk *Window Capture*), dan **Simulasi Kamera**.
   - Menampilkan nama turnamen, kategori, disiplin, nomor lapangan, status `LIVE`, nama pemain, bendera/nama klub, *seed/unggulan*, ikon *shuttlecock* servis (1 atau 2 *cock*), skor set sebelumnya, set yang dimenangkan, dan skor poin aktif.
   - **Tanpa Nomor Match & Tanpa Tag Side-Out/Target**: Tampilan bersih dari informasi teknis yang tidak diperlukan penonton *livestream*.
   - **Callout Otomatis**: Menampilkan panah animasi **GAME POINT**, **MATCH POINT**, atau **DEUCE** secara akurat (pada mode *side-out*, *Game/Match Point* hanya muncul jika tim yang mencapai poin kritis sedang memegang servis).
2. **Fitur Histori 10 Reli Terakhir On-Demand (`RallyHistoryStrip`)**:
   - **Dikendalikan Operator/Panitia**: Hanya tampil apabila diaktifkan oleh operator (melalui tombol **📊 Histori Reli** di halaman Admin, menu *dock* kanan bawah layar OBS, atau menekan tombol **`H`** pada *keyboard*).
   - **Jumlah Kolom Dinamis (Tanpa Placeholder Kosong)**: Jika pertandingan baru berjalan 5 reli, hanya menampilkan 5 kolom kotak; jika 7 reli, tampil 7 kolom; maksimal menampilkan **10 reli terakhir**.
   - **Posisi Skor Utama di Paling Kanan**: Saat histori reli ditampilkan, kotak skor utama bergeser ke ujung paling kanan setelah deretan kotak histori reli (`[Nama Pemain] ➔ [Histori Reli] ➔ [Skor Utama]`), sehingga progres kenaikan poin terlihat berurutan dari kiri ke kanan.
   - **Tinggi & Garis Sejajar Presisi**: Tinggi sel histori reli (`54px` per baris) dan garis pembagi tengah sejajar persis dengan baris pemain dan kotak skor utama.
   - **Indikator Simbol Murni**:
     - Mode **Side-Out**: Menampilkan simbol **`●`** untuk Servis Ke-1, **`● ●`** untuk Servis Ke-2, dan **`⇄`** untuk Pindah Servis (*Side-Out*) tepat di bawah angka skor.
     - Mode **Rally Point**: Tidak menampilkan simbol servis di bawah angka skor agar tampilan tetap bersih.

---

### 3.5. Modul Layar Multi-Lapangan / Venue LiveScore (`/livescore`)
1. **Pemantauan Multi-Lapangan Serentak**:
   - Menampilkan banyak lapangan sekaligus dalam 1 layar proyektor/TV besar dengan pilihan filter lapangan fleksibel dan pengaturan kolom grid (`Auto`, `1 Kolom`, `2 Kolom`, `3 Kolom`, `4 Kolom`).
2. **Desain Fokus pada Visual Lapangan**:
   - Setiap kartu lapangan menampilkan gambar lapangan bulu tangkis hijau 2D yang menonjolkan posisi nyata keempat/kedua pemain, indikator *Server* & *Receiver*, serta skor besar di bagian atas kartu.
   - Keterangan tekstual kotak kanan/kiri (genap/ganjil) dihilangkan agar kartu tampak lega dan bersih.
3. **Histori Reli Dinamis (`Auto-Fit` Sesuai Lebar Kartu)**:
   - Menggunakan `ResizeObserver` untuk menghitung jumlah kolom histori reli secara otomatis mengikuti lebar kartu lapangan:
     - Tampilan **1 Lapangan (1 Kolom)**: Menampilkan hingga **40–60 histori reli terakhir**.
     - Tampilan **2 Lapangan (2 Kolom)**: Menampilkan hingga **~25–30 histori reli terakhir**.
     - Tampilan **3–4 Lapangan**: Menyesuaikan jumlah kotak secara otomatis tanpa meluber keluar batas kartu.
   - Setiap kolom histori disusun **sejajar vertikal (Atas vs Bawah)** sesuai baris Tim A (atas) dan Tim B (bawah) agar penonton mudah membandingkan siapa pemenang setiap reli.

---

### 3.6. Modul Server Admin & Manajemen Turnamen (`/admin`)
1. **Autentikasi Berjenjang (RBAC - Role-Based Access Control)**:
   - **Super Admin (`super_admin`)**: Memiliki akses penuh ke seluruh pengendalian pertandingan, profil turnamen, ekspor/impor, serta menu **Manajemen User & Password** (membuat, menonaktifkan, mengubah *role*, dan mereset *password* akun Admin lain).
   - **Admin Operasional (`admin`)**: Memiliki akses penuh untuk mengelola pertandingan, jadwal, dan profil turnamen, serta mengubah *password* miliknya sendiri, namun tidak dapat mengubah akun pengguna lain.
2. **Manajemen Multi-Profil Turnamen (`TournamentProfileBar`)**:
   - Memungkinkan satu server/laptop menangani beberapa turnamen berbeda (misal *Turnamen Pagi*, *Turnamen Siang*, *Turnamen Malam*) dengan database, antrian ekspor, dan pengaturan sinkronisasi yang terisolasi penuh (`data/profiles/<id>/`).
3. **Papan Jadwal & Progres (`GroupedMatchBoard`) & Tabel Pertandingan (`MatchTable`)**:
   - Menyusun kartu pertandingan berdasarkan **Per-Lapangan**, **Per-Kategori**, **Per-Tanggal**, **Per-Disiplin**, atau **Per-Status**, dengan pilihan **1, 2, atau 3 Kolom**.
   - **Persistensi Pilihan Operator (`localStorage`)**: Seluruh pilihan susunan kategori (`groupBy`), jumlah kolom (`cols`), filter status, pencarian, dan tab aktif tetap tersimpan (*persist*) saat panitia berpindah menu di halaman Admin maupun saat *browser* dimuat ulang.
4. **Edit Lengkap Pertandingan & Perlindungan Auto-Sync (`admin_override`)**:
   - Admin dapat mengedit jadwal, lapangan (dengan *Date Picker* & *Time Picker*), nama pemain, klub, *seeded*, metode skor, skor *live*, jumlah *shuttlecock*, nama wasit, maupun menetapkan keputusan cepat **Walkover (WO) / Diskualifikasi**.
   - Pertandingan yang diedit manual oleh panitia otomatis diberi **Kunci Perlindungan Auto-Sync (`🔒 DIEDIT PANITIA`)** sehingga perubahannya tidak tertimpa ketika *Auto-Sync* Google Sheets berjalan.
5. **Integrasi Dua Arah Google Sheets & Kesinambungan Antar-Laptop (Multi-PC Sync)**:
   - **Live Schedule Import & Auto-Sync Poller**: Menarik jadwal dari tab `Jadwal` Google Sheets secara instan (0 detik *delay cache*) secara manual atau berkala (tiap 5–60 detik).
   - **Auto-Export Hasil & Log (`Results` & `Logs`)**: Setiap pertandingan selesai otomatis diekspor ke CSV lokal (`exports/`) dan dikirim ke Google Sheets lengkap dengan **Nama Wasit (`referee_name`)**, **Jumlah Penggunaan Shuttlecock (`shuttlecock_count`)**, dan **Waktu Mulai/Selesai Berformat Lokal Komputer (`YYYY-MM-DD HH:mm:ss`)**.
   - **Lanjutkan Progres di Laptop/PC Lain (`Cross-Laptop Continuation`)**:
     - **Otomatis via Cloud Google Sheets**: Saat menarik jadwal di laptop lain, sistem otomatis membaca tab `Results` dan `SmashPoint_State` sehingga pertandingan yang sudah selesai maupun yang sedang *live* langsung dilanjutkan dari *state* terakhir (tidak mengulang dari awal).
     - **Backup & Restore File `.json` 1-Klik**: Fitur unduh dan unggah bundel database turnamen (`smashpoint-state-<profil>.json`) untuk perpindahan antar-laptop secara *offline*.

---

## 4. Spesifikasi Skema Data Import & Ekspor

### 4.1. Skema 19 Kolom Import Jadwal (`Jadwal`)
| No | Nama Kolom (Header) | Alias yang Didukung | Keterangan / Contoh |
| :--- | :--- | :--- | :--- |
| 1 | `match_number` | `no_partai`, `kode_partai`, `partai` | Kode unik partai (mendukung simbol seperti `M-101`, `A-B#1`) |
| 2 | `tournament_name` | `nama_turnamen`, `turnamen` | Nama kejuaraan (contoh: `Pak Pele Cup 3 2026`) |
| 3 | `category_name` | `kategori`, `category` | Kelompok umur/babak (contoh: `Veteran U-110 · Perempat Final`) |
| 4 | `discipline` | `disiplin`, `nomor` | `MS`, `WS`, `MD`, `WD`, atau `XD` |
| 5 | `scoring_method` | `metode_skor`, `sistem_skor` | `rally_point` atau `side_out` |
| 6 | `scoring_type` | `tipe_skor` | `sets` (Best of 3) atau `continuous` (1 Game) |
| 7 | `win_point` | `target_poin`, `poin_menang` | Poin kemenangan (contoh: `21`, `30`, `42`) |
| 8 | `interval_point` | `poin_interval`, `interval` | Poin istirahat interval (contoh: `11`, `15`, `21`) |
| 9 | `team_a_p1_name` | - | Nama Pemain 1 Tim A (Wajib) |
| 10 | `team_a_p2_name` | - | Nama Pemain 2 Tim A (Wajib jika Ganda) |
| 11 | `team_a_club` | - | Nama Klub / PB Tim A |
| 12 | `team_a_details` | `seed_a`, `unggulan_a` | Unggulan / Seed Tim A (contoh: `1`, `[3/4]`, `{"seed":1}`) |
| 13 | `team_b_p1_name` | - | Nama Pemain 1 Tim B (Wajib) |
| 14 | `team_b_p2_name` | - | Nama Pemain 2 Tim B (Wajib jika Ganda) |
| 15 | `team_b_club` | - | Nama Klub / PB Tim B |
| 16 | `team_b_details` | `seed_b`, `unggulan_b` | Unggulan / Seed Tim B |
| 17 | `scheduled_date` | `tanggal`, `date`, `tgl` | Hari/Tanggal jadwal (contoh: `Sabtu / 7 November 2026`) |
| 18 | `court_number` | `lapangan`, `court`, `no_lapangan` | Nomor lapangan bulat (`1` s/d `15`) |
| 19 | `scheduled_time` | `jam`, `waktu`, `jam_main` | Jam jadwal (contoh: `14:30 WIB`) |

### 4.2. Skema Kolom Ekspor Hasil (`Results`) & Audit Log (`Logs`)
- **Tab `Results` (24 Kolom)**:
  `match_number`, `tournament_name`, `category_name`, `discipline`, `scheduled_date`, `court_number`, `scheduled_time`, `team_a`, `team_a_club`, `team_b`, `team_b_club`, `scoring_method`, `scoring_type`, `sets_a`, `sets_b`, `set_scores`, `winner`, `winner_team`, **`referee_name`**, **`shuttlecock_count`**, **`started_at`** *(Format Lokal `YYYY-MM-DD HH:mm:ss`)*, **`finished_at`** *(Format Lokal `YYYY-MM-DD HH:mm:ss`)*, `duration_min`, `duration_text`.
- **Tab `Logs` (11 Kolom)**:
  `log_id`, `match_number`, **`timestamp`** *(Format Lokal `YYYY-MM-DD HH:mm:ss`)*, `event_type`, `details`, `actor_id`, **`referee_name`**, **`shuttlecock_count`**, `score_a`, `score_b`, `set`.

---

## 5. Future Features (Roadmap Pengembangan Komersial & Cloud SaaS)

Bagian ini mendefinisikan peta jalan (*roadmap*) pengembangan SmashPoint selanjutnya menuju platform komersial (*Software-as-a-Service* / SaaS):

### 5.1. Komersialisasi dengan User Center & Sistem Langganan (Subscription Management)
1. **Portal User Center Mandiri (`/account` / `/user-center`)**:
   - Registrasi akun pengguna umum (penyelenggara turnamen / EO, pengurus klub/PB, pengelola GOR) menggunakan Email/Password atau *Single Sign-On* (Google OAuth).
   - Dashboard profil pengguna untuk mengelola informasi organisasi, riwayat transaksi, status masa aktif langganan, dan daftar perangkat yang terhubung.
2. **Paket Langganan Berjangka Waktu (Time-Based Subscription Tiers)**:
   - Pengguna umum dapat berlangganan (*subscribe*) akses penuh aplikasi berdasarkan durasi kebutuhan event:
     - **Event Pass (3 Hari / 7 Hari)**: Cocok untuk panitia turnamen insidental atau kejuaraan akhir pekan.
     - **Monthly Pro (30 Hari)**: Cocok untuk GOR atau komunitas yang rutin mengadakan liga bulanan.
     - **Annual Enterprise (1 Tahun)**: Untuk asosiasi olahraga, klub besar, atau EO profesional dengan jumlah lapangan tak terbatas.
3. **Integrasi Payment Gateway Otomatis**:
   - Pembayaran instan melalui QRIS, Virtual Account Bank, dan E-Wallet (Midtrans / Xendit / Stripe) yang secara otomatis mengaktifkan lisensi/kuota durasi akun begitu pembayaran terkonfirmasi.
4. **License & Quota Enforcement**:
   - Validasi masa aktif langganan (*subscription expiry check*) saat membuat turnamen baru atau mengaktifkan lapangan, dilengkapi *grace period* agar pertandingan yang sedang berlangsung di lapangan tidak pernah terputus di tengah jalan apabila masa langganan habis tepat saat hari H.

### 5.2. Profil Turnamen Terikat ke Akun Pengguna (*Cloud User-Tied Tournament Profiles*)
1. **Kepemilikan Profil Berbasis Akun (`owner_user_id`)**:
   - Setiap **Profil Turnamen** yang dibuat oleh pengguna secara otomatis terikat (*tied to*) ke ID akun pengguna tersebut di database Cloud terpusat (PostgreSQL / Supabase / Firebase), bukan lagi hanya terikat pada penyimpanan lokal satu laptop.
2. **Akses Lintas Perangkat Tanpa Batas (*Log In From Any Laptop & Resume*)**:
   - Ketika pengguna *login* ke akunnya dari laptop atau PC manapun (misal berpindah dari laptop rumah saat menyusun bagan/jadwal ke PC meja panitia di GOR, atau mengganti laptop operator di tengah turnamen), **seluruh daftar Profil Turnamen miliknya beserta progres skor, histori reli, pengaturan *layout* Admin, dan koneksi Google Sheets langsung tampil dan siap dilanjutkan secara otomatis**.
3. **Sinkronisasi Hybrid Offline-First ke Cloud Akun**:
   - Saat dijalankan di GOR dengan koneksi internet terbatas, laptop tetap menyimpan perubahan ke cache lokal secara instan (< 5 ms), lalu melakukan *background delta-sync* ke penyimpanan Cloud milik akun pengguna setiap kali koneksi tersedia.
4. **Kolaborasi Tim Panitia per Turnamen (*Role Delegation per Profile*)**:
   - Pemilik akun (*Tournament Owner*) dapat mengundang akun panitia lain atau membuat kode akses sementara (*Session Invite Code*) untuk Admin Operasional dan Wasit yang hanya berlaku khusus pada profil turnamen tersebut.
