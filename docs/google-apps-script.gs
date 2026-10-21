/**
 * SmashPoint -> Google Sheets receiver (Google Apps Script Web App)
 *
 * Setup:
 * 1. Buka Google Sheet tujuan -> Extensions -> Apps Script, tempel kode ini.
 * 2. Ubah SECRET agar sama dengan GOOGLE_SHEETS_WEBHOOK_SECRET di .env SmashPoint.
 * 3. Deploy -> New deployment -> Web app. Execute as: Me. Who has access: Anyone.
 * 4. Salin URL Web App ke GOOGLE_SHEETS_WEBHOOK_URL di .env SmashPoint.
 *
 * Sheet "Results" berisi 1 baris per match; sheet "Logs" berisi audit trail.
 * Pengiriman ulang match yang sama akan memperbarui baris (upsert by match_number).
 */
const SECRET = 'ganti-dengan-secret-anda';

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
