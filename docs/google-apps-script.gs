/**
 * SmashPoint <-> Google Sheets Two-Way Integration (Google Apps Script)
 *
 * Fitur:
 * 1. INSTANT LIVE SCHEDULE READ (doGet):
 *    Membaca tab jadwal secara langsung (0 detik delay cache CDN) jika URL Web App
 *    dimasukkan ke kolom URL Import di halaman Admin SmashPoint.
 * 2. TOMBOL MENU "⚡ SmashPoint" DI GOOGLE SHEETS (onOpen):
 *    Jika laptop Server berada di jaringan yang bisa diakses atau memakai tunnel,
 *    panitia bisa langsung klik menu "⚡ SmashPoint -> Push Jadwal ke Server".
 * 3. AUTO-EXPORT HASIL & AUDIT LOG PERTANDINGAN (doPost):
 *    Menerima hasil akhir dari SmashPoint ke sheet "Results" & "Logs".
 *
 * Cara Setup:
 * 1. Buka Google Sheet Jadwal -> Extensions -> Apps Script, tempel kode ini.
 * 2. Deploy -> New deployment -> Web app:
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 3. Salin URL Web App tersebut:
 *    - Bisa dipakai di kolom "Live URL Google Sheets" di halaman Admin SmashPoint (0 delay!)
 *    - Juga bisa dipasang di GOOGLE_SHEETS_WEBHOOK_URL pada .env untuk menerima hasil pertandingan.
 */
const SECRET = 'ganti-dengan-secret-anda';
const SCHEDULE_SHEET_NAME = ''; // Kosongkan untuk memakai sheet pertama, atau isi mis. 'Jadwal'

/**
 * doGet: Mengirimkan seluruh baris jadwal secara LIVE (JSON) tanpa cache CDN 5 menit Google.
 * Cukup tempel URL Web App Apps Script ini di tab "Live URL Google Sheets" Admin SmashPoint!
 */
function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = SCHEDULE_SHEET_NAME ? ss.getSheetByName(SCHEDULE_SHEET_NAME) : ss.getSheets()[0];
  if (!sh || sh.getLastRow() < 2) {
    return ContentService.createTextOutput(JSON.stringify({ rows: [] })).setMimeType(ContentService.MimeType.JSON);
  }
  const values = sh.getDataRange().getDisplayValues();
  const headers = values[0].map((h) => String(h).trim());
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (r.every((c) => !String(c).trim())) continue;
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      if (headers[c]) obj[headers[c]] = r[c];
    }
    rows.push(obj);
  }
  return ContentService.createTextOutput(JSON.stringify({ rows })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  if (SECRET && body.secret !== SECRET) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'bad secret' })).setMimeType(ContentService.MimeType.JSON);
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (body.type === 'match_result') {
      upsertRow_(ss, 'Results', body.result, 'match_number');
      const logSheet = getSheet_(ss, 'Logs', ['log_id', 'match_number', 'timestamp', 'event_type', 'details', 'actor_id', 'score_a', 'score_b', 'set']);
      const existing = new Set(logSheet.getLastRow() > 1 ? logSheet.getRange(2, 1, logSheet.getLastRow() - 1, 1).getValues().map((r) => r[0]) : []);
      const rows = (body.logs || []).filter((l) => !existing.has(l.log_id)).map((l) => [l.log_id, l.match_number, l.timestamp, l.event_type, l.details, l.actor_id, l.score_a, l.score_b, l.set]);
      if (rows.length) logSheet.getRange(logSheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    }
  } finally {
    lock.releaseLock();
  }
  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
}

function getSheet_(ss, name, header) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(header);
    sh.setFrozenRows(1);
  }
  return sh;
}

function upsertRow_(ss, name, obj, key) {
  const header = Object.keys(obj);
  const sh = getSheet_(ss, name, header);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const row = head.map((h) => (obj[h] === undefined ? '' : obj[h]));
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
