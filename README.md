# SmashPoint v2.1 — Dedicated Multi-Court Match Scoring Engine

SmashPoint adalah *Scoring & Display Engine* real-time untuk turnamen bulu tangkis. Aplikasi ini berjalan di LAN dan tetap bisa dipakai tanpa internet (offline-first). Kapasitasnya sampai 15 lapangan: 15 tablet wasit dan 30 TV.

```
[Google Sheets / CSV] ──import──▶ SMASHPOINT SERVER (Node + Next.js + Socket.io)
                                   ├─ Ingest & validasi (PRD §2)
                                   ├─ State machine + audit log (PRD §5, §6)
                                   ├─ Session manager / anti-conflict lock (PRD §4)
                                   └─ Broadcaster per room (match & court)
                                        │                      │
                             Tablet Wasit (/referee)    TV Lapangan (/display?court=N)
```

## Menjalankan

```bash
npm install
cp .env.example .env        # ganti MASTER_PIN / ADMIN_PIN
npm run dev                 # development  -> http://localhost:3000
# atau produksi:
npm run build && npm start
```

Saat server berjalan, konsol menampilkan alamat LAN (mis. `http://192.168.1.10:3000`). Buka alamat itu dari tablet dan TV.

| Modul | URL |
| --- | --- |
| Server Admin | `/admin` (PIN Admin) |
| Wasit | `/referee` |
| TV per lapangan | `/display?court=3` |
| TV per match | `/display?match=M-101` |

Jalankan unit test state machine dengan `npm test`.

## Format Import (PRD §2)

Gunakan 19 kolom sesuai PRD (termasuk `scheduled_date` di kolom ke-17). Template bisa diunduh dari `/api/template.csv`, dan contoh data tersedia di [`samples/matches.csv`](samples/matches.csv). Data bisa dimasukkan dengan tiga cara:
- **File CSV/TSV/JSON**
- **Tempel langsung** dari Google Sheets / Excel (format tab otomatis terdeteksi)
- **URL Google Sheets**: sheet dibagikan "siapa saja yang memiliki link" atau dipublikasikan sebagai CSV

Validasi yang dijalankan:
- `match_number` unik
- enum `discipline` / `scoring_method` / `scoring_type`
- `interval_point < win_point`
- `court_number` 1–15
- nama pemain 2 wajib untuk ganda

Kolom opsional tambahan `max_point` mengatur batas deuce untuk tipe `sets` (default `win_point + 9`, jadi 21 → 30).

Import ulang bersifat *upsert*. Untuk match yang sudah dimulai, hanya metadata jadwal yang diperbarui. Aturan skor dan data pemain tetap terkunci.

## Logika Skoring

- **Rally point**: setiap reli menambah poin.
  - Jika tim servis menang, server pindah kotak.
  - Jika penerima menang, servis pindah ke pemain di kotak sesuai paritas skor (genap = kanan, ganjil = kiri).
- **Side-out ganda**: tim servis yang kalah reli pertama masuk ke **Servis Ke-2** (`SIDE_OUT_2ND`). Kalah lagi berarti **Pindah Bola** (`SIDE_OUT`). Poin tidak bertambah.
- **Side-out tunggal**: kalah reli langsung pindah bola.
- **Interval**: saat salah satu tim mencapai `interval_point`, skor terkunci dan muncul "INTERVAL - TUKAR LAPANGAN". Tukar sisi terjadi setelah wasit menekan **Konfirmasi Tukar Posisi**.
  - Tipe `continuous` dan set penentuan (set 3) bertukar sisi.
  - Set 1 dan 2 hanya istirahat, sesuai gaya BWF.
- **Sets** (best of 3): menang dengan selisih 2 poin, dibatasi `max_point`. Setelah set selesai, pemain ganti tempat, lalu wasit melakukan setup posisi untuk set berikutnya.
- **Selesai**: wasit menekan **Konfirmasi Hasil & Kirim**. Status match menjadi `finished`, lalu `sheetsExporter.pushResults()` dijalankan.

## Resolusi Konflik (PRD §4, §8.2)

- **Exclusive lock**: "Kunci & Mulai Setup" menautkan match ke UUID perangkat. Perangkat lain otomatis masuk **Mode Pantau** dengan pesan penolakan.
- **Takeover**: tombol "Ambil Alih Sesi (Takeover)" meminta Master PIN. Setelah PIN benar, perangkat lama diputus (`session:kicked`) dan state dilanjutkan tanpa kehilangan poin.
- **Heartbeat**: tablet mengirim `PING` setiap 10 detik. Jika server tidak menerima ping selama 60 detik, kunci dilepas otomatis.
- **Admin** dapat melepas kunci secara paksa, reset, reopen, memindah lapangan, atau mengubah jam.
- **Idempotensi**: setiap aksi membawa `last_log_id`. Klik ganda atau request basi ditolak tanpa mengubah skor. Tersedia lewat socket `match:action` dan REST `POST /api/score`.
- **Cache lokal**: tablet menyimpan `live_state` di `localStorage`, jadi layar tidak kosong saat server restart.

## Ekspor (PRD §8.3)

Saat match `finished`, hasilnya ditangani sebagai berikut:
1. Selalu ditulis ke `exports/results.csv` dan `exports/logs/<match>.csv`.
2. Jika `GOOGLE_SHEETS_WEBHOOK_URL` diisi, hasil dikirim ke Google Apps Script ([`docs/google-apps-script.gs`](docs/google-apps-script.gs)). Saat offline, data masuk antrian persisten dan dicoba ulang setiap 60 detik.

Unduhan manual tersedia di `/api/export/results.csv` dan `/api/export/logs.csv`.

## Penyimpanan

DB berjalan in-memory dan disimpan ke `data/db.json` secara atomik dengan debounce 250 ms. Isinya:
- koleksi `matches`
- `logs` (append-only)
- stack UNDO

Lapisan `lib/server/store.js` terisolasi, jadi bisa diganti PostgreSQL tanpa mengubah engine maupun UI.

## Struktur

```
server.js                  HTTP + Next.js + Socket.io + REST API
lib/engine.js              State machine skoring (murni, dipakai server & klien)
lib/server/store.js        Master state, audit log, session manager, UNDO
lib/server/ingest.js       Parser CSV/TSV/JSON + validasi
lib/server/sheetsExporter.js  Ekspor lokal + webhook Google Sheets (antrian offline)
app/admin | app/referee | app/display   Antarmuka
tests/engine.test.js       Unit test logika skoring
```
