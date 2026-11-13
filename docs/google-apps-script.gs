/**
 * SmashPoint <-> Google Sheets Two-Way Integration & Cloud Tournament State Sync (v2.3)
 *
 * Fitur:
 * 1. INSTANT LIVE SCHEDULE READ & CLOUD PROGRESS SYNC (doGet):
 *    - Membaca tab jadwal ("Jadwal") secara langsung (0 detik delay cache CDN).
 *    - Menyertakan baris hasil ("Results"), snapshot lengkap ("SmashPoint_State"), log ("Logs"),
 *      daftar wasit resmi ("SmashPoint_Referees"), dan metadata turnamen ("SmashPoint_Meta")
 *      sehingga saat dibuka dari laptop/PC manapun dan menarik data, seluruh progres turnamen
 *      dan daftar wasit otomatis dilanjutkan dari state terakhir!
 * 2. AUTO-EXPORT HASIL, AUDIT LOG, LIVE STATE & DAFTAR WASIT (doPost):
 *    - Menerima hasil akhir dari SmashPoint secara otomatis ke sheet "Results" & "Logs".
 *    - Menyimpan snapshot progres turnamen real-time ke "SmashPoint_State", daftar wasit ke
 *      "SmashPoint_Referees", serta info profil ke "SmashPoint_Meta".
 * 3. MENU PANITIA LANGSUNG DI GOOGLE SHEETS (onOpen -> "🏸 SmashPoint"):
 *    - Validasi Format Jadwal (deteksi duplikat match_number, kolom wajib kosong, typo kategori/mode).
 *    - Buat Template Tab Jadwal untuk turnamen baru.
 *    - Proteksi baris header tab Results/Logs/State agar tidak terhapus tidak sengaja.
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
  const refSh = ss.getSheetByName('SmashPoint_Referees');
  const referees = refSh ? readSheetObjects_(refSh, false) : [];
  const metaSh = ss.getSheetByName('SmashPoint_Meta');
  const metaRows = metaSh ? readSheetObjects_(metaSh, false) : [];
  const meta = metaRows.length > 0 ? metaRows[0] : null;

  return ContentService.createTextOutput(
    JSON.stringify({
      ok: true,
      sheet: sh ? sh.getName() : null,
      rows: rows,
      results: results,
      states: states,
      logs: logs,
      referees: referees,
      meta: meta,
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
        if (Array.isArray(body.referees)) {
          upsertReferees_(ss, 'SmashPoint_Referees', body.referees);
        }
        if (body.meta && typeof body.meta === 'object') {
          upsertMeta_(ss, 'SmashPoint_Meta', body.meta);
        }
      } else if (body.type === 'referees_sync' && Array.isArray(body.referees)) {
        upsertReferees_(ss, 'SmashPoint_Referees', body.referees);
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


/**
 * upsertReferees_: Menyimpan daftar nama wasit resmi ke sheet "SmashPoint_Referees"
 * agar nama wasit tetap seragam dan ikut terpulihkan saat dibuka di laptop lain.
 */
function upsertReferees_(ss, name, referees) {
  const header = ['id', 'name', 'license', 'phone', 'active', 'created_at', 'updated_at'];
  const sh = getSheet_(ss, name, header);
  sh.getRange(1, 1, 1, header.length).setValues([header]);
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(sh.getLastColumn(), header.length)).clearContent();
  }
  if (!referees || !referees.length) return;
  const rows = [];
  for (let i = 0; i < referees.length; i++) {
    const r = referees[i] || {};
    if (!r.name) continue;
    rows.push([
      r.id || ('ref_' + i),
      String(r.name || ''),
      String(r.license || ''),
      String(r.phone || ''),
      r.active === false ? 'false' : 'true',
      String(r.created_at || ''),
      String(r.updated_at || ''),
    ]);
  }
  if (rows.length > 0) {
    sh.getRange(2, 1, rows.length, header.length).setValues(rows);
  }
}

/**
 * upsertMeta_: Menyimpan metadata profil turnamen (nama, venue, status closed, ketua panitia, dll.)
 * ke sheet "SmashPoint_Meta".
 */
function upsertMeta_(ss, name, meta) {
  if (!meta || typeof meta !== 'object') return;
  const row = {
    meta_key: 'active_profile',
    profile_id: meta.id || '',
    tournament_name: meta.name || meta.tournament_name || '',
    status: meta.status || 'active',
    venue: meta.venue || '',
    chief_referee: meta.chief_referee || '',
    committee_head: meta.committee_head || '',
    closed_at: meta.closed_at || '',
    closed_by: meta.closed_by || '',
    closing_notes: meta.closing_notes || '',
    updated_at: new Date().toISOString(),
  };
  upsertRow_(ss, name, row, 'meta_key');
}

/**
 * Menu khusus Panitia langsung di Google Sheets ("🏸 SmashPoint")
 * untuk validasi jadwal sebelum ditarik oleh aplikasi & proteksi header.
 */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('🏸 SmashPoint')
      .addItem('✅ Validasi Format Jadwal', 'spValidateSchedule')
      .addItem('📋 Buat / Cek Template Tab Jadwal', 'spCreateScheduleTemplate')
      .addItem('🔒 Proteksi Header Results & State', 'spProtectSystemHeaders')
      .addToUi();
  } catch (e) {
    // Ignore when run outside Spreadsheet UI context
  }
}

function spValidateSchedule() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SCHEDULE_SHEET_NAME) || ss.getActiveSheet();
  if (!sh || sh.getLastRow() < 2) {
    ui.alert('Validasi Jadwal', 'Sheet "' + (sh ? sh.getName() : SCHEDULE_SHEET_NAME) + '" masih kosong.', ui.ButtonSet.OK);
    return;
  }
  const rows = readSheetObjects_(sh, true);
  const seen = {};
  const issues = [];
  const validDisc = ['MS', 'WS', 'MD', 'WD', 'XD', 'SINGLE', 'DOUBLE', 'TUNGGAL', 'GANDA'];
  const validMethod = ['rally_point', 'side_out', ''];
  const validType = ['sets', 'continuous', ''];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 2;
    const mn = String(r.match_number || r.no_partai || '').trim();
    if (!mn) {
      issues.push('Baris ' + rowNum + ': match_number kosong');
    } else if (seen[mn.toLowerCase()]) {
      issues.push('Baris ' + rowNum + ': duplikat match_number "' + mn + '" (sudah ada di baris ' + seen[mn.toLowerCase()] + ')');
    } else {
      seen[mn.toLowerCase()] = rowNum;
    }
    if (!String(r.team_a_p1_name || '').trim() || !String(r.team_b_p1_name || '').trim()) {
      issues.push('Baris ' + rowNum + ' (' + (mn || '?') + '): nama pemain utama Tim A / Tim B kosong');
    }
    const disc = String(r.discipline || '').trim().toUpperCase();
    if (disc && validDisc.indexOf(disc) === -1) {
      issues.push('Baris ' + rowNum + ' (' + mn + '): discipline "' + disc + '" tidak dikenal (gunakan MS/WS/MD/WD/XD)');
    }
    const sm = String(r.scoring_method || '').trim().toLowerCase();
    if (validMethod.indexOf(sm) === -1) {
      issues.push('Baris ' + rowNum + ' (' + mn + '): scoring_method "' + sm + '" harus rally_point atau side_out');
    }
    const st = String(r.scoring_type || '').trim().toLowerCase();
    if (validType.indexOf(st) === -1) {
      issues.push('Baris ' + rowNum + ' (' + mn + '): scoring_type "' + st + '" harus sets atau continuous');
    }
  }

  if (issues.length === 0) {
    ui.alert('✅ Jadwal Valid!', 'Ditemukan ' + rows.length + ' baris pertandingan pada tab "' + sh.getName() + '" dan semuanya siap ditarik ke SmashPoint.', ui.ButtonSet.OK);
  } else {
    const preview = issues.slice(0, 15).join('\n') + (issues.length > 15 ? '\n...dan ' + (issues.length - 15) + ' error lainnya.' : '');
    ui.alert('⚠️ Ditemukan ' + issues.length + ' Masalah pada Jadwal', preview, ui.ButtonSet.OK);
  }
}

function spCreateScheduleTemplate() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  const headers = [
    'match_number',
    'tournament_name',
    'category_name',
    'discipline',
    'scoring_method',
    'scoring_type',
    'win_point',
    'interval_point',
    'team_a_p1_name',
    'team_a_p2_name',
    'team_a_club',
    'team_a_details',
    'team_b_p1_name',
    'team_b_p2_name',
    'team_b_club',
    'team_b_details',
    'scheduled_date',
    'court_number',
    'scheduled_time',
  ];
  let sh = ss.getSheetByName(SCHEDULE_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SCHEDULE_SHEET_NAME);
  }
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.appendRow([
      'M-001',
      'Turnamen Bulutangkis',
      'Dewasa Putra',
      'MD',
      'rally_point',
      'sets',
      21,
      11,
      'Andi',
      'Budi',
      'PB Jaya',
      '1',
      'Candra',
      'Dedi',
      'PB Tangkas',
      '',
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      1,
      '09:00 WIB',
    ]);
    sh.setFrozenRows(1);
    ui.alert('Template Dibuat', 'Tab "' + SCHEDULE_SHEET_NAME + '" berhasil dibuat dengan header resmi SmashPoint.', ui.ButtonSet.OK);
  } else {
    ui.alert('Sudah Ada Data', 'Tab "' + SCHEDULE_SHEET_NAME + '" sudah berisi ' + sh.getLastRow() + ' baris. Tidak ditimpa.', ui.ButtonSet.OK);
  }
}

function spProtectSystemHeaders() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  const names = ['Results', 'Logs', 'SmashPoint_State', 'SmashPoint_Referees', 'SmashPoint_Meta'];
  let count = 0;
  for (let i = 0; i < names.length; i++) {
    const sh = ss.getSheetByName(names[i]);
    if (!sh) continue;
    const p = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).protect();
    p.setDescription('Header Sistem SmashPoint - Jangan diubah manual');
    p.setWarningOnly(true);
    count++;
  }
  ui.alert('Proteksi Header', 'Proteksi peringatan aktif pada ' + count + ' tab sistem SmashPoint.', ui.ButtonSet.OK);
}
