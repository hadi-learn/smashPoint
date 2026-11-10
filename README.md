# SmashPoint v2.2 — Dedicated Multi-Court Match Scoring, LiveScore & Broadcast Engine

SmashPoint adalah *Scoring, Arena Display, Multi-Court LiveScore & Broadcast Overlay Engine* real-time untuk turnamen bulu tangkis. Aplikasi ini berjalan di LAN (*offline-first*) sekaligus mendukung sinkronisasi dua arah dengan **Google Sheets** (Live Schedule Sync, Auto-Export Results & Audit Logs, serta Cloud State Sync untuk melanjutkan progres turnamen lintas laptop/PC). Kapasitasnya mendukung hingga **15 lapangan simultan** (15 tablet wasit, 30 TV lapangan, layar LiveScore GOR, dan OBS/YouTube livestream overlay).

## Dokumentasi Lengkap
- 📄 **[Product Requirements Document (PRD) Terbaru (`docs/PRD.md`)](docs/PRD.md)** — Daftar lengkap seluruh fitur yang sudah diimplementasikan (progress saat ini), arsitektur sistem, skema data, serta **Future Features / Roadmap Komersial (User Center Subscription & Cloud User-Tied Tournament Profiles)**.
- 📘 **[Buku Panduan Penggunaan Aplikasi (`docs/PANDUAN_PENGGUNAAN.md`)](docs/PANDUAN_PENGGUNAAN.md)** — Panduan langkah demi langkah untuk Server Admin, Wasit (Referee), Layar TV Lapangan, Overlay Livestream OBS/YouTube, Layar Multi-Lapangan LiveScore, dan cara pindah laptop tanpa mengulang turnamen dari awal.
- 📜 **[Kode Google Apps Script (`docs/google-apps-script.gs`)](docs/google-apps-script.gs)** — Script integrasi dua arah Google Spreadsheet (`Jadwal`, `Results`, `Logs`, dan `SmashPoint_State`).

```
[Google Sheets / CSV] ◄──sync──▶ SMASHPOINT SERVER (Node + Next.js + Socket.io)
                                  ├─ Multi-Tournament Profile Manager (data/profiles/<id>)
                                  ├─ Ingest & Live Auto-Sync + Cloud Progress Restore
                                  ├─ Pure State Machine (Rally Point & Side-Out, Sets & Continuous)
                                  ├─ Shuttlecock Counter, Referee Identity & Audit Log
                                  └─ Broadcaster per room (match, court, admin)
                                       │                │                  │                 │
                            Tablet Wasit (/referee)  TV Arena (/display)  OBS Overlay  LiveScore (/livescore)
```

## Menjalankan Aplikasi

```bash
npm install
cp .env.example .env        # opsional: sesuaikan MASTER_PIN / ADMIN_PIN / ADMIN_USERNAME
npm run dev                 # development  -> http://localhost:3000
# atau produksi:
npm run build && npm start
```

Saat server berjalan, konsol menampilkan alamat LAN (mis. `http://192.168.1.10:3000`). Buka alamat tersebut dari tablet wasit, Smart TV, dan PC OBS.

| Modul | URL | Keterangan |
| --- | --- | --- |
| **Server Admin** | `/admin` | Login Username & Password (RBAC: Super Admin & Admin Operasional) |
| **Tablet Wasit** | `/referee` | Panel kendali wasit, setup posisi, skoring reli & *shuttlecock counter* |
| **TV Lapangan** | `/display?court=3` | Papan skor raksasa layar penuh di pinggir lapangan |
| **OBS / YouTube Overlay** | `/display?court=3&mode=obs` | *Scorebug* BWF di pojok kiri atas + *on-demand* histori 10 reli terakhir |
| **Multi-Court LiveScore** | `/livescore` | Layar proyektor GOR untuk memantau banyak lapangan sekaligus |

Jalankan seluruh pengujian otomatis (*17 test suites*) dengan perintah:
```bash
npm test
```
