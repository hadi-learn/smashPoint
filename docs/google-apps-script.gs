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
        // 1. Upsert baris hasil akhir ke sheet "Results" (otomatis menambah kolom baru seperti referee_name & shuttlecock_count)
        upsertRow_(ss, 'Results', body.result, 'match_number');

        // 2. Sinkronisasi log audit ke sheet "Logs" (otomatis memperbarui header & mengisi kolom referee_name dan shuttlecock_count)
        upsertLogs_(ss, 'Logs', body.logs || [], body.result);
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
  const lastCol = Math.max(sh.getLastColumn(), 1);
  let head = sh.getRange(1, 1, 1, lastCol).getValues()[0].map((h) => String(h).trim()).filter(Boolean);
  if (head.length === 0) {
    head = header.slice();
  }
  // Jika ada kolom baru (mis. referee_name, shuttlecock_count, duration_min, duration_text), tambahkan ke header
  let headChanged = false;
  for (let i = 0; i < header.length; i++) {
    if (head.indexOf(header[i]) === -1) {
      head.push(header[i]);
      headChanged = true;
    }
  }
  if (headChanged || sh.getLastColumn() < head.length) {
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

/**
 * upsertLogs_: Menyimpan riwayat log pertandingan ke sheet "Logs" lengkap dengan
 * kolom referee_name (Nama Wasit) dan shuttlecock_count (Jumlah Penggunaan Cock).
 * Jika sheet "Logs" sudah dibuat dengan versi lama (tanpa kolom referee_name & shuttlecock_count),
 * fungsi ini otomatis menambahkan kolom tersebut ke baris header dan mengisinya.
 */
function upsertLogs_(ss, name, logs, matchResult) {
  const defaultLogHeader = [
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
  const sh = getSheet_(ss, name, defaultLogHeader);
  const lastCol = Math.max(sh.getLastColumn(), 1);
  let head = sh.getRange(1, 1, 1, lastCol).getValues()[0].map((h) => String(h).trim()).filter(Boolean);
  if (head.length === 0) {
    head = defaultLogHeader.slice();
  }

  // Pastikan seluruh kolom standar maupun kolom dinamis dari objek log ada pada header sheet "Logs"
  const incomingKeys = defaultLogHeader.slice();
  for (let i = 0; i < logs.length; i++) {
    const keys = Object.keys(logs[i] || {});
    for (let k = 0; k < keys.length; k++) {
      if (incomingKeys.indexOf(keys[k]) === -1) incomingKeys.push(keys[k]);
    }
  }

  let headChanged = false;
  for (let i = 0; i < incomingKeys.length; i++) {
    if (head.indexOf(incomingKeys[i]) === -1) {
      head.push(incomingKeys[i]);
      headChanged = true;
    }
  }
  if (headChanged || sh.getLastColumn() < head.length) {
    sh.getRange(1, 1, 1, head.length).setValues([head]);
  }

  if (!logs || !logs.length) return;

  // Map log_id yang sudah ada di sheet agar dapat di-update jika diekspor ulang atau di-append jika baru
  const logIdCol = head.indexOf('log_id') + 1;
  const existingRowMap = {};
  if (sh.getLastRow() > 1 && logIdCol > 0) {
    const existingIds = sh.getRange(2, logIdCol, sh.getLastRow() - 1, 1).getValues();
    for (let r = 0; r < existingIds.length; r++) {
      const idStr = String(existingIds[r][0] || '').trim();
      if (idStr) existingRowMap[idStr] = r + 2; // Nomor baris di Google Sheet (mulai dari baris 2)
    }
  }

  const fallbackReferee = (matchResult && matchResult.referee_name) ? matchResult.referee_name : '';
  const fallbackCock = (matchResult && matchResult.shuttlecock_count !== undefined) ? matchResult.shuttlecock_count : 0;

  const newRows = [];
  for (let i = 0; i < logs.length; i++) {
    const l = logs[i] || {};
    const enriched = Object.assign({}, l, {
      referee_name: (l.referee_name !== undefined && l.referee_name !== '') ? l.referee_name : fallbackReferee,
      shuttlecock_count: (l.shuttlecock_count !== undefined && l.shuttlecock_count !== '') ? l.shuttlecock_count : fallbackCock,
    });
    const rowValues = head.map((h) => (enriched[h] === undefined || enriched[h] === null ? '' : enriched[h]));
    const existingRowNumber = existingRowMap[String(l.log_id || '').trim()];
    if (existingRowNumber) {
      sh.getRange(existingRowNumber, 1, 1, rowValues.length).setValues([rowValues]);
    } else {
      newRows.push(rowValues);
    }
  }

  if (newRows.length > 0) {
    sh.getRange(sh.getLastRow() + 1, 1, newRows.length, head.length).setValues(newRows);
  }
}
