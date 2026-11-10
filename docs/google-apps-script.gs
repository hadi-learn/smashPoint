/**
 * SmashPoint <-> Google Sheets Two-Way Integration & Cloud Tournament State Sync (Google Apps Script)
 *
 * Fitur:
 * 1. INSTANT LIVE SCHEDULE READ & CLOUD PROGRESS SYNC (doGet):
 *    - Membaca tab jadwal ("Jadwal") secara langsung (0 detik delay cache CDN).
 *    - Menyertakan baris hasil yang sudah selesai dari tab "Results" dan snapshot live dari tab "SmashPoint_State"
 *      sehingga saat dibuka dari laptop/PC manapun dan menarik data, progres turnamen otomatis dilanjutkan dari state terakhir!
 * 2. AUTO-EXPORT HASIL, AUDIT LOG & LIVE STATE SNAPSHOT (doPost):
 *    - Menerima hasil akhir dari SmashPoint secara otomatis ke sheet "Results" & "Logs".
 *    - Menyimpan snapshot progres turnamen real-time ke sheet "SmashPoint_State" untuk sinkronisasi antar-laptop.
 *
 * Cara Setup (Hanya 2 Menit):
 * 1. Buka Google Spreadsheet Jadwal Panitia -> Pastikan nama tab/sheet jadwal adalah "Jadwal".
 * 2. Klik menu Extensions (Ekstensi) -> Apps Script.
 * 3. Hapus semua kode bawaan, lalu tempel (Paste) seluruh isi file ini dan tekan Ctrl+S (Simpan).
 * 4. Klik tombol biru "Deploy" (Terapkan) di kanan atas -> pilih "New deployment" (Deployment baru) atau "Manage deployments" -> "New version":
 *    - Klik ikon roda gigi (Select type) -> pilih "Web app" (Aplikasi web).
 *    - Description: SmashPoint Webhook & Cloud Sync
 *    - Execute as (Jalankan sebagai): "Me" (Saya)
 *    - Who has access (Siapa yang memiliki akses): WAJIB pilih "Anyone" (Siapa saja)
 *    - Klik "Deploy" -> Klik "Authorize access" -> Pilih akun Google Anda -> Klik "Advanced" -> Klik "Go to Untitled project (unsafe)" -> Klik "Allow".
 * 5. Salin "Web app URL" (berakhiran /exec):
 *    - Tempelkan ke kolom "URL Webhook Google Sheets" di kartu "📤 Ekspor & Sinkronisasi" pada halaman Admin SmashPoint (/admin), lalu klik "Simpan & Tes Koneksi".
 */
const SECRET = ''; // Opsional: kosongkan agar langsung bekerja, atau isi jika memakai GOOGLE_SHEETS_WEBHOOK_SECRET
const SCHEDULE_SHEET_NAME = 'Jadwal'; // Default membaca sheet bernama "Jadwal"

function readSheetObjects_(sh, preferMatchHeader) {
  if (!sh || sh.getLastRow() < 2) return [];
  const values = sh.getDataRange().getDisplayValues();
  let headerRowIdx = 0;
  if (preferMatchHeader) {
    for (let i = 0; i < Math.min(15, values.length); i++) {
      const normalized = values[i].map((h) => String(h).trim().toLowerCase().replace(/[\s\-]+/g, '_'));
      if (normalized.indexOf('match_number') >= 0 || normalized.indexOf('no_partai') >= 0) {
        headerRowIdx = i;
        break;
      }
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
  return rows;
}

/**
 * doGet: Mengirimkan seluruh baris jadwal dari sheet "Jadwal" secara LIVE (JSON),
 * sekaligus menyertakan progres dari sheet "Results", "SmashPoint_State", dan "Logs"
 * agar laptop lain dapat langsung melanjutkan progres turnamen tanpa mengulang dari awal.
 */
function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const mode = (e && e.parameter && e.parameter.mode) ? String(e.parameter.mode).trim() : '';
  const requestedSheet = (e && e.parameter && e.parameter.sheet) ? String(e.parameter.sheet).trim() : SCHEDULE_SHEET_NAME;
  let sh = requestedSheet ? ss.getSheetByName(requestedSheet) : null;
  if (!sh && SCHEDULE_SHEET_NAME) sh = ss.getSheetByName(SCHEDULE_SHEET_NAME);
  if (!sh) sh = ss.getSheets()[0];

  const rows = readSheetObjects_(sh, true);
  const resultsSh = ss.getSheetByName('Results');
  const results = resultsSh ? readSheetObjects_(resultsSh, true) : [];
  const stateSh = ss.getSheetByName('SmashPoint_State');
  const states = stateSh ? readSheetObjects_(stateSh, false) : [];
  const logsSh = (mode === 'full' || (e && e.parameter && e.parameter.include_logs === '1')) ? ss.getSheetByName('Logs') : null;
  const logs = logsSh ? readSheetObjects_(logsSh, false) : [];

  return ContentService.createTextOutput(
    JSON.stringify({
      ok: true,
      sheet: sh ? sh.getName() : null,
      rows: rows,
      results: results,
      states: states,
      logs: logs,
    })
  ).setMimeType(ContentService.MimeType.JSON);
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

        // 3. Simpan juga state lengkap match ke "SmashPoint_State" jika disertakan
        if (body.match_state) {
          upsertStateSnapshot_(ss, 'SmashPoint_State', [body.match_state]);
        }
      } else if (body.type === 'state_sync' && Array.isArray(body.states)) {
        // Simpan snapshot progres seluruh match (live, setup, finished, maupun editan panitia) ke sheet "SmashPoint_State"
        upsertStateSnapshot_(ss, 'SmashPoint_State', body.states);
        if (Array.isArray(body.results)) {
          for (let i = 0; i < body.results.length; i++) {
            upsertRow_(ss, 'Results', body.results[i], 'match_number');
          }
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

/**
 * upsertStateSnapshot_: Menyimpan JSON state setiap match ke sheet "SmashPoint_State"
 * agar laptop/PC lain dapat memulihkan progres turnamen (skor live, set, histori reli, wasit, cock, selesai) secara utuh.
 */
function upsertStateSnapshot_(ss, name, stateItems) {
  if (!stateItems || !stateItems.length) return;
  const header = ['match_number', 'status', 'updated_at', 'match_json'];
  const sh = getSheet_(ss, name, header);
  for (let i = 0; i < stateItems.length; i++) {
    const item = stateItems[i];
    if (!item || !item.match_number) continue;
    upsertRow_(
      ss,
      name,
      {
        match_number: item.match_number,
        status: item.status || '',
        updated_at: item.updated_at || new Date().toISOString(),
        match_json: typeof item.match_json === 'string' ? item.match_json : JSON.stringify(item.match || item),
      },
      'match_number'
    );
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
