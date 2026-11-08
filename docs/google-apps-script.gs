/**
 * SmashPoint <-> Google Sheets Two-Way Integration (Google Apps Script)
 *
 * Fitur:
 * 1. INSTANT LIVE SCHEDULE READ (doGet):
 *    Membaca tab jadwal ("Jadwal") secara langsung (0 detik delay cache CDN) jika URL Web App
 *    atau URL Google Sheets dimasukkan ke kolom URL Import di halaman Admin SmashPoint.
 * 2. AUTO-EXPORT HASIL & AUDIT LOG PERTANDINGAN (doPost):
 *    Menerima hasil akhir dari SmashPoint secara otomatis ke sheet "Results" & "Logs".
 *
 * Cara Setup (Hanya 2 Menit):
 * 1. Buka Google Spreadsheet Jadwal Panitia -> Pastikan nama tab/sheet jadwal adalah "Jadwal".
 * 2. Klik menu Extensions (Ekstensi) -> Apps Script.
 * 3. Hapus semua kode bawaan, lalu tempel (Paste) seluruh isi file ini dan tekan Ctrl+S (Simpan).
 * 4. Klik tombol biru "Deploy" (Terapkan) di kanan atas -> pilih "New deployment" (Deployment baru):
 *    - Klik ikon roda gigi (Select type) -> pilih "Web app" (Aplikasi web).
 *    - Description: SmashPoint Webhook
 *    - Execute as (Jalankan sebagai): "Me" (Saya)
 *    - Who has access (Siapa yang memiliki akses): WAJIB pilih "Anyone" (Siapa saja)
 *    - Klik "Deploy" -> Klik "Authorize access" -> Pilih akun Google Anda -> Klik "Advanced" -> Klik "Go to Untitled project (unsafe)" -> Klik "Allow".
 * 5. Salin "Web app URL" (berakhiran /exec):
 *    - Tempelkan ke kolom "URL Webhook Google Sheets" di kartu "📤 Ekspor & Sinkronisasi" pada halaman Admin SmashPoint (/admin), lalu klik "Simpan & Tes Koneksi".
 */
const SECRET = ''; // Opsional: kosongkan agar langsung bekerja, atau isi jika memakai GOOGLE_SHEETS_WEBHOOK_SECRET
const SCHEDULE_SHEET_NAME = 'Jadwal'; // Default membaca sheet bernama "Jadwal"

/**
 * doGet: Mengirimkan seluruh baris jadwal dari sheet "Jadwal" secara LIVE (JSON).
 */
function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const requestedSheet = (e && e.parameter && e.parameter.sheet) ? String(e.parameter.sheet).trim() : SCHEDULE_SHEET_NAME;
  let sh = requestedSheet ? ss.getSheetByName(requestedSheet) : null;
  if (!sh && SCHEDULE_SHEET_NAME) sh = ss.getSheetByName(SCHEDULE_SHEET_NAME);
  if (!sh) sh = ss.getSheets()[0];

  if (!sh || sh.getLastRow() < 2) {
    return ContentService.createTextOutput(JSON.stringify({ ok: true, sheet: sh ? sh.getName() : null, rows: [] })).setMimeType(ContentService.MimeType.JSON);
  }
  const values = sh.getDataRange().getDisplayValues();
  // Cari baris header (baris yang memiliki kolom 'match_number' atau baris pertama yang tidak kosong)
  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(15, values.length); i++) {
    const normalized = values[i].map((h) => String(h).trim().toLowerCase().replace(/[\s\-]+/g, '_'));
    if (normalized.indexOf('match_number') >= 0 || normalized.indexOf('no_partai') >= 0) {
      headerRowIdx = i;
      break;
    }
  }
  const headers = values[headerRowIdx].map((h) => String(h).trim());
  const rows = [];
  for (let i = headerRowIdx + 1; i < values.length; i++) {
    const r = values[i];
    if (r.every((c) => !String(c).trim())) continue;
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      if (headers[c]) obj[headers[c]] = r[c];
    }
    rows.push(obj);
  }
  return ContentService.createTextOutput(JSON.stringify({ ok: true, sheet: sh.getName(), rows })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const raw = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    const body = JSON.parse(raw);
    if (SECRET && body.secret && body.secret !== SECRET) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'bad secret' })).setMimeType(ContentService.MimeType.JSON);
    }
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // Respon cepat untuk tombol "Tes Koneksi" dari halaman Admin SmashPoint
    if (body.type === 'ping') {
      return ContentService.createTextOutput(
        JSON.stringify({
          ok: true,
          message: 'Terhubung ke Spreadsheet: ' + ss.getName(),
          sheets: ss.getSheets().map((s) => s.getName()),
        })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      if (body.type === 'match_result' && body.result) {
        upsertRow_(ss, 'Results', body.result, 'match_number');
        const logHeader = [
          'log_id',
          'match_number',
          'timestamp',
          'event_type',
          'details',
          'actor_id',
          'referee_name',
          'shuttlecock_count',
          'score_a',
          'score_b',
          'set',
        ];
        const logSheet = getSheet_(ss, 'Logs', logHeader);
        // Pastikan header sheet Logs memiliki kolom baru jika sheet sudah ada sebelumnya
        const lastLogCol = Math.max(logSheet.getLastColumn(), logHeader.length);
        let curLogHead = logSheet.getRange(1, 1, 1, lastLogCol).getValues()[0].map((h) => String(h).trim());
        let logHeadChanged = false;
        for (let i = 0; i < logHeader.length; i++) {
          if (curLogHead.indexOf(logHeader[i]) === -1) {
            curLogHead.push(logHeader[i]);
            logHeadChanged = true;
          }
        }
        if (logHeadChanged) {
          logSheet.getRange(1, 1, 1, curLogHead.length).setValues([curLogHead]);
        }
        const existing = new Set(
          logSheet.getLastRow() > 1
            ? logSheet
                .getRange(2, 1, logSheet.getLastRow() - 1, 1)
                .getValues()
                .map((r) => String(r[0]))
            : []
        );
        const rows = (body.logs || [])
          .filter((l) => !existing.has(String(l.log_id)))
          .map((l) => curLogHead.map((h) => (l[h] === undefined || l[h] === null ? '' : l[h])));
        if (rows.length) {
          logSheet.getRange(logSheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
        }
      }
    } finally {
      lock.releaseLock();
    }
    return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) })).setMimeType(ContentService.MimeType.JSON);
  }
}

function getSheet_(ss, name, header) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(header);
    sh.setFrozenRows(1);
  } else if (sh.getLastRow() === 0) {
    sh.appendRow(header);
    sh.setFrozenRows(1);
  }
  return sh;
}

function upsertRow_(ss, name, obj, key) {
  const header = Object.keys(obj);
  const sh = getSheet_(ss, name, header);
  const lastCol = Math.max(sh.getLastColumn(), header.length);
  let head = sh.getRange(1, 1, 1, lastCol).getValues()[0].map((h) => String(h).trim());
  // Jika ada kolom baru (mis. duration_min / duration_text), tambahkan ke kanan header
  let headChanged = false;
  for (let i = 0; i < header.length; i++) {
    if (head.indexOf(header[i]) === -1) {
      head.push(header[i]);
      headChanged = true;
    }
  }
  if (headChanged) {
    sh.getRange(1, 1, 1, head.length).setValues([head]);
  }
  const row = head.map((h) => (obj[h] === undefined || obj[h] === null ? '' : obj[h]));
  const keyCol = head.indexOf(key) + 1;
  if (sh.getLastRow() > 1 && keyCol > 0) {
    const keys = sh.getRange(2, keyCol, sh.getLastRow() - 1, 1).getValues().map((r) => String(r[0]));
    const idx = keys.indexOf(String(obj[key]));
    if (idx >= 0) {
      sh.getRange(idx + 2, 1, 1, row.length).setValues([row]);
      return;
    }
  }
  sh.appendRow(row);
}
