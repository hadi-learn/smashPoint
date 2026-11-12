/**
 * SmashPoint Server (HUB)
 * One Node process hosts: Next.js UI, REST API, Socket.io real-time broadcaster,
 * State Machine store and Session Manager - so in-memory state is shared.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import next from 'next';
import nextEnv from '@next/env';
import { Server } from 'socket.io';
import { Store, StoreError } from './lib/server/store.js';
import { AdminAuth } from './lib/server/auth.js';
import { ProfileManager } from './lib/server/profiles.js';
import { SheetsExporter, RESULT_HEADER, LOG_HEADER, resultRow, formatLogRow } from './lib/server/sheetsExporter.js';
import { ingest, parseDelimited, toCsv, COLUMNS, OPTIONAL_COLUMNS } from './lib/server/ingest.js';

const prod = process.argv.includes('--prod') || process.env.NODE_ENV === 'production';
nextEnv.loadEnvConfig(process.cwd(), !prod);
// Also fallback to .env.example if user edited .env.example directly without copying to .env
if (!fs.existsSync(path.join(process.cwd(), '.env')) && fs.existsSync(path.join(process.cwd(), '.env.example'))) {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), '.env.example'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq > 0) {
        const k = trimmed.slice(0, eq).trim();
        const v = trimmed.slice(eq + 1).trim();
        if (process.env[k] === undefined && v !== '') process.env[k] = v;
      }
    }
  } catch { /* ignore */ }
}
if (prod) process.env.NODE_ENV = 'production';

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const COURT_COUNT = parseInt(process.env.COURT_COUNT || '15', 10);
const MASTER_PIN = process.env.MASTER_PIN || '1234';
const ADMIN_PIN = process.env.ADMIN_PIN || MASTER_PIN;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const LOCK_TIMEOUT_MS = parseInt(process.env.LOCK_TIMEOUT_MS || '60000', 10);
const HEARTBEAT_MS = 10000;
const ROOT = process.cwd();

const profileManager = new ProfileManager({ rootDir: ROOT });
const store = new Store({
  dataDir: profileManager.dataDirFor(),
  courtCount: COURT_COUNT,
  lockTimeoutMs: LOCK_TIMEOUT_MS,
  masterPin: MASTER_PIN,
});
const adminAuth = new AdminAuth({ dataDir: path.join(ROOT, 'data'), defaultUsername: ADMIN_USERNAME, defaultPassword: ADMIN_PIN });
const sheetsExporter = new SheetsExporter({
  exportDir: profileManager.exportDirFor(),
  dataDir: profileManager.dataDirFor(),
  webhookUrl: process.env.GOOGLE_SHEETS_WEBHOOK_URL,
  webhookSecret: process.env.GOOGLE_SHEETS_WEBHOOK_SECRET,
  onStatus: (id, status) => store.setExportStatus(id, status),
});

// Event listener: status -> finished triggers export (PRD 8.3)
store.on('finished', (match, logs) => {
  sheetsExporter.pushResults(match, logs).catch((e) => console.error('[exporter]', e));
});

// Auto-sync live match state snapshot to Google Sheets `SmashPoint_State` (debounced 2.5s) when webhook is configured
let cloudStateSyncTimer = null;
const dirtyStateMatches = new Set();
store.on('change', (m) => {
  if (!sheetsExporter.webhookUrl || !m?.match_number) return;
  dirtyStateMatches.add(m.match_number);
  if (cloudStateSyncTimer) return;
  cloudStateSyncTimer = setTimeout(async () => {
    cloudStateSyncTimer = null;
    if (!sheetsExporter.webhookUrl || !dirtyStateMatches.size) return;
    const ids = Array.from(dirtyStateMatches);
    dirtyStateMatches.clear();
    const list = ids.map((id) => store.get(id)).filter(Boolean);
    if (!list.length) return;
    try {
      await sheetsExporter.pushStateSnapshot(list);
    } catch {
      // Quietly ignore transient network errors; full sync or finished export will retry
    }
  }, 2500);
});

// ------------------------------------------------------------------ HTTP helpers
function send(res, status, body, headers = {}) {
  const isStr = typeof body === 'string';
  res.writeHead(status, { 'Content-Type': isStr ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(isStr ? body : JSON.stringify(body));
}

function readBody(req, limit = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new StoreError('Payload terlalu besar', 'too_large', 413));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new StoreError('JSON tidak valid', 'bad_json', 400));
      }
    });
    req.on('error', reject);
  });
}

const isAdmin = (req) => Boolean(adminAuth.verifyRequest(req));
const validDevice = (id) => typeof id === 'string' && id.length >= 8 && id.length <= 100;

/**
 * Build candidate URLs to read a Google Sheets schedule tab (default: "Jadwal")
 * or a Google Apps Script Web App / custom CSV URL with zero CDN cache.
 *
 * IMPORTANT: In Google's /gviz/tq endpoint, passing both `gid=0` and `sheet=Jadwal`
 * causes `gid=0` to OVERRIDE `sheet=Jadwal`! Therefore:
 *  1. Candidate 1 queries by sheet name (`sheet=Jadwal`) WITHOUT `gid`.
 *  2. Candidate 2 falls back to `/export?format=csv&gid=<gid>` (raw CSV export, no gviz header merging).
 *  3. Candidate 3 falls back to `/gviz/tq?tqx=out:csv&gid=<gid>`.
 */
function buildSheetsCandidateUrls(url, sheetName = 'Jadwal') {
  const u = String(url || '').trim();
  const cb = `_t=${Date.now()}`;
  const cleanSheet = String(sheetName || 'Jadwal').trim();

  // Case 1: Google Apps Script Web App URL (https://script.google.com/macros/s/.../exec)
  if (/script\.google\.com\/macros\/s\//i.test(u)) {
    const sep = u.includes('?') ? '&' : '?';
    return [
      `${u}${sep}${cleanSheet ? `sheet=${encodeURIComponent(cleanSheet)}&` : ''}${cb}`,
    ];
  }

  // Case 2: Standard Google Sheets URL (/spreadsheets/d/<ID>/edit...)
  const m = u.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m && !/\/d\/e\//.test(u)) {
    const id = m[1];
    const gid = (u.match(/[#&?]gid=(\d+)/) || [])[1] || '0';
    const urlSheet = (u.match(/[?&]sheet=([^&#]+)/) || [])[1];
    const targetSheet = urlSheet ? decodeURIComponent(urlSheet) : cleanSheet;
    const candidates = [];
    if (targetSheet) {
      // Primary: read directly from sheet named "Jadwal" (do NOT include gid so sheet name is respected!)
      candidates.push(
        `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(targetSheet)}&${cb}`
      );
    }
    // Fallback 1: direct CSV export by gid (preserves exact cell values & headers without gviz type stripping)
    candidates.push(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}&${cb}`);
    // Fallback 2: gviz by gid
    candidates.push(`https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&gid=${gid}&${cb}`);
    return candidates;
  }

  // Case 3: Published (/d/e/.../pub) or arbitrary CSV URL
  return [u.includes('?') ? `${u}&${cb}` : `${u}?${cb}`];
}

// ------------------------------------------------------------------ Auto-Sync Poller & Persisted Config (Per Tournament Profile)
const sheetSync = {
  url: process.env.GOOGLE_SHEETS_SCHEDULE_URL || '',
  sheetName: process.env.GOOGLE_SHEETS_TAB_NAME || 'Jadwal',
  intervalSec: 0, // 0 = off, >= 5 = poll every N seconds
  lastSync: null,
  lastResult: null,
  lastError: null,
  busy: false,
  timer: null,
};

function loadSyncConfigForActiveProfile() {
  const saved = profileManager.readSyncConfig();
  sheetSync.url = saved.url || process.env.GOOGLE_SHEETS_SCHEDULE_URL || '';
  sheetSync.sheetName = saved.sheetName || process.env.GOOGLE_SHEETS_TAB_NAME || 'Jadwal';
  sheetSync.intervalSec = Number.isInteger(saved.intervalSec) ? saved.intervalSec : 0;
  sheetSync.lastSync = null;
  sheetSync.lastResult = null;
  sheetSync.lastError = null;
  sheetsExporter.setConfig({
    webhookUrl: saved.webhookUrl || process.env.GOOGLE_SHEETS_WEBHOOK_URL || '',
    webhookSecret: saved.webhookSecret || process.env.GOOGLE_SHEETS_WEBHOOK_SECRET || '',
  });
}
loadSyncConfigForActiveProfile();

function saveSyncConfig() {
  profileManager.writeSyncConfig(profileManager.activeId, {
    url: sheetSync.url,
    sheetName: sheetSync.sheetName || 'Jadwal',
    intervalSec: sheetSync.intervalSec,
    webhookUrl: sheetsExporter.webhookUrl || '',
    webhookSecret: sheetsExporter.webhookSecret || '',
  });
}

function switchTournamentProfile(targetId) {
  // 1. Save current profile's sync config and flush store + exporter queue
  saveSyncConfig();
  store.flush();

  // 2. Activate target profile in ProfileManager
  const profile = profileManager.setActive(targetId);

  // 3. Switch Store dataDir & load target profile's matches/logs/undo
  store.switchDataDir(profileManager.dataDirFor(profile.id));

  // 4. Switch SheetsExporter & reload sync config for target profile
  const savedSync = profileManager.readSyncConfig(profile.id);
  sheetsExporter.switchProfile({
    exportDir: profileManager.exportDirFor(profile.id),
    dataDir: profileManager.dataDirFor(profile.id),
    webhookUrl: savedSync.webhookUrl || process.env.GOOGLE_SHEETS_WEBHOOK_URL || '',
    webhookSecret: savedSync.webhookSecret || process.env.GOOGLE_SHEETS_WEBHOOK_SECRET || '',
  });
  loadSyncConfigForActiveProfile();
  restartAutoSyncTimer();

  // 5. Broadcast updated courts & admin state to all connected screens
  for (let c = 1; c <= COURT_COUNT; c += 1) emitCourt(c);
  io.emit('profile:switched', {
    active_profile: profileManager.activeProfile(store),
  });
  emitAdmin();

  return profileManager.activeProfile(store);
}

/**
 * Fetch optional remote progress (`Results` and `SmashPoint_State` tabs) from a standard Google Sheets URL
 * or configured Google Apps Script Web App URL so that pulling schedule on any laptop also restores progress.
 */
async function fetchRemoteProgressFromSheets(rawUrl) {
  const remote = { results: [], states: [], logs: [] };
  const cb = `_t=${Date.now()}`;

  // 1. If a Google Apps Script Webhook URL is configured, query its doGet (which returns results, states, and logs in one JSON call)
  const webhook = sheetsExporter.webhookUrl || (/script\.google\.com\/macros\/s\//i.test(rawUrl) ? rawUrl : '');
  if (webhook && /script\.google\.com\/macros\/s\//i.test(webhook)) {
    try {
      const sep = webhook.includes('?') ? '&' : '?';
      const r = await fetch(`${webhook}${sep}mode=full&${cb}`, { redirect: 'follow' });
      if (r.ok) {
        const txt = await r.text();
        if (/^\s*\{/.test(txt)) {
          const j = JSON.parse(txt);
          if (Array.isArray(j.results)) remote.results = j.results;
          if (Array.isArray(j.states)) remote.states = j.states;
          if (Array.isArray(j.logs)) remote.logs = j.logs;
          if (remote.results.length || remote.states.length) return remote;
        }
      }
    } catch { /* fallback to gviz below */ }
  }

  // 2. If rawUrl is a standard Google Sheets URL (/spreadsheets/d/<ID>), read "SmashPoint_State" and "Results" tabs via gviz CSV
  const m = String(rawUrl || '').match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m && !/\/d\/e\//.test(rawUrl)) {
    const id = m[1];
    // Fetch "Results" tab
    try {
      const resUrl = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent('Results')}&${cb}`;
      const r = await fetch(resUrl, { redirect: 'follow' });
      if (r.ok) {
        const csvText = await r.text();
        if (!/^\s*<(!doctype|html)/i.test(csvText)) {
          const rows = parseDelimited(csvText);
          // Verify that the returned sheet actually has result columns (e.g. set_scores or winner) and didn't just fallback to first sheet
          if (rows.length > 0 && ('set_scores' in rows[0] || 'winner' in rows[0] || 'sets_a' in rows[0])) {
            remote.results = rows;
          }
        }
      }
    } catch { /* ignore */ }

    // Fetch "SmashPoint_State" tab
    try {
      const stUrl = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent('SmashPoint_State')}&${cb}`;
      const r = await fetch(stUrl, { redirect: 'follow' });
      if (r.ok) {
        const csvText = await r.text();
        if (!/^\s*<(!doctype|html)/i.test(csvText)) {
          const rows = parseDelimited(csvText);
          if (rows.length > 0 && 'match_json' in rows[0]) {
            remote.states = rows;
          }
        }
      }
    } catch { /* ignore */ }
  }

  return remote;
}

async function fetchAndIngestUrl(rawUrl, { dryRun = false, sheetName } = {}) {
  const targetSheet = String(sheetName || sheetSync.sheetName || 'Jadwal').trim();
  const candidates = buildSheetsCandidateUrls(rawUrl, targetSheet);
  let lastParsed = null;
  let lastFetchError = null;
  let usedSheetSource = targetSheet;
  let embeddedRemoteProgress = null;

  for (let i = 0; i < candidates.length; i += 1) {
    const target = candidates[i];
    let r;
    try {
      r = await fetch(target, {
        redirect: 'follow',
        headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', Pragma: 'no-cache' },
      });
    } catch (e) {
      lastFetchError = `Gagal mengambil URL: ${e.message}`;
      continue;
    }
    if (!r.ok) {
      lastFetchError = `Gagal mengambil URL (HTTP ${r.status}). Pastikan Sheet diatur Bagikan -> "Siapa saja yang memiliki link (Pelihat)".`;
      continue;
    }
    const text = await r.text();
    if (/^\s*<(!doctype|html)/i.test(text)) {
      if (/accounts\.google\.com|ServiceLogin/i.test(text)) {
        throw new StoreError('Sheet belum dibuka aksesnya. Klik tombol "Bagikan (Share)" di kanan atas Google Sheets -> ubah ke "Siapa saja yang memiliki link (Anyone with the link)".');
      }
      lastFetchError = 'Google mengembalikan halaman HTML, bukan data tabel.';
      continue;
    }

    // Support both JSON (from Apps Script Web App doGet) and CSV/TSV
    let input = text;
    if (/^\s*[\[{]/.test(text)) {
      try {
        const j = JSON.parse(text);
        input = Array.isArray(j) ? j : j.rows || j.matches || text;
        if (j.sheet) usedSheetSource = j.sheet;
        if (Array.isArray(j.results) || Array.isArray(j.states)) {
          embeddedRemoteProgress = {
            results: j.results || [],
            states: j.states || [],
            logs: j.logs || [],
          };
        }
      } catch { /* fallback to CSV */ }
    }

    const parsed = ingest(input, { courtCount: COURT_COUNT });
    lastParsed = parsed;
    // If we found valid matches (or rows on the primary named sheet), stop trying fallbacks
    if (parsed.matches.length > 0) {
      break;
    }
  }

  if (!lastParsed) {
    throw new StoreError(lastFetchError || 'Tidak dapat membaca data dari URL Google Sheets.');
  }

  // If 0 rows or 0 valid matches, provide a clear diagnostic warning
  if (lastParsed.total === 0) {
    throw new StoreError(
      `Berhasil terhubung ke Google Sheets, tetapi tidak ditemukan baris jadwal pada sheet "${targetSheet}". Pastikan: (1) Nama tab sheet di bawah adalah "${targetSheet}", (2) Baris pertama berisi header kolom sesuai template (match_number, tournament_name, dst.), dan (3) Sheet sudah di-Share "Siapa saja yang memiliki link".`
    );
  }

  if (dryRun) {
    return {
      ok: true,
      dry_run: true,
      sheet_name: usedSheetSource,
      valid: lastParsed.matches.length,
      total: lastParsed.total,
      errors: lastParsed.errors,
    };
  }
  const result = store.upsertMatches(lastParsed.matches);

  // Restore any finished or live match progress from Google Sheets (`Results` & `SmashPoint_State`) so opening on another laptop continues seamlessly!
  const remoteProgress = embeddedRemoteProgress || (await fetchRemoteProgressFromSheets(rawUrl));
  const restored = store.applyRemoteProgress(remoteProgress);

  return {
    ok: true,
    sheet_name: usedSheetSource,
    total: lastParsed.total,
    ...result,
    restored_from_state: restored.restored_from_state,
    restored_from_results: restored.restored_from_results,
    errors: lastParsed.errors,
  };
}

async function runAutoSync() {
  if (sheetSync.busy || !sheetSync.url) return null;
  sheetSync.busy = true;
  try {
    const res = await fetchAndIngestUrl(sheetSync.url);
    sheetSync.lastSync = new Date().toISOString();
    sheetSync.lastResult = { total: res.total, created: res.created, updated: res.updated, errors: res.errors?.length || 0 };
    sheetSync.lastError = null;
    emitAdmin();
    return res;
  } catch (e) {
    sheetSync.lastError = e.message;
    emitAdmin();
    return { ok: false, error: e.message };
  } finally {
    sheetSync.busy = false;
  }
}

function restartAutoSyncTimer() {
  if (sheetSync.timer) {
    clearInterval(sheetSync.timer);
    sheetSync.timer = null;
  }
  if (sheetSync.url && sheetSync.intervalSec >= 5) {
    sheetSync.timer = setInterval(() => runAutoSync(), sheetSync.intervalSec * 1000);
    sheetSync.timer.unref?.();
  }
}
restartAutoSyncTimer();

function syncStatus() {
  return {
    url: sheetSync.url,
    sheet_name: sheetSync.sheetName || 'Jadwal',
    interval_sec: sheetSync.intervalSec,
    last_sync: sheetSync.lastSync,
    last_result: sheetSync.lastResult,
    last_error: sheetSync.lastError,
    is_pub_link: /\/d\/e\/|\/pub\b/.test(sheetSync.url || ''),
  };
}

async function handleApi(req, res, url) {
  const { pathname, searchParams } = url;
  const method = req.method;
  const parts = pathname.split('/').filter(Boolean); // ['api', ...]

  if (pathname === '/api/health') return send(res, 200, { ok: true, time: new Date().toISOString(), matches: Object.keys(store.matches).length, active_profile: profileManager.activeProfile(store) });
  if (pathname === '/api/config') return send(res, 200, { court_count: COURT_COUNT, heartbeat_ms: HEARTBEAT_MS, lock_timeout_ms: LOCK_TIMEOUT_MS, active_profile: profileManager.activeProfile(store) });

  if (pathname === '/api/template.csv') {
    const sample = [
      { match_number: 'M-101', tournament_name: 'Pak Pele Cup 3 2026', category_name: 'Veteran U-110', discipline: 'MD', scoring_method: 'side_out', scoring_type: 'continuous', win_point: 30, interval_point: 15, team_a_p1_name: 'Budi Santoso', team_a_p2_name: 'Agus Wijaya', team_a_club: 'PB Djarum', team_a_details: '{"age": 56}', team_b_p1_name: 'Hendro Gunawan', team_b_p2_name: 'Rudy Hartono', team_b_club: 'PB Jaya Raya', team_b_details: '{"age": 54}', scheduled_date: '2026-10-20', court_number: 3, scheduled_time: '14:30 WIB' },
      { match_number: 'M-102', tournament_name: 'Pak Pele Cup 3 2026', category_name: 'Dewasa', discipline: 'MS', scoring_method: 'rally_point', scoring_type: 'sets', win_point: 21, interval_point: 11, team_a_p1_name: 'Andi Pratama', team_a_p2_name: '', team_a_club: 'PB Mutiara', team_a_details: '', team_b_p1_name: 'Rizky Ramadhan', team_b_p2_name: '', team_b_club: 'PB Exist', team_b_details: '', scheduled_date: '2026-10-20', court_number: 1, scheduled_time: '15:00 WIB' },
    ];
    return send(res, 200, `\uFEFF${toCsv(COLUMNS, sample)}`, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="smashpoint-template.csv"' });
  }

  // ---- public reads
  if (parts[1] === 'matches' && method === 'GET') {
    if (parts.length === 2) {
      const court = searchParams.get('court');
      return send(res, 200, { matches: store.list({ court }).map((m) => store.toPublic(m)) });
    }
    const m = store.mustGet(decodeURIComponent(parts[2]));
    if (parts[3] === 'logs') return send(res, 200, { logs: store.getLogs(m.match_number) });
    return send(res, 200, { match: store.toPublic(m) });
  }
  if (pathname === '/api/courts' && method === 'GET') {
    const courts = [];
    for (let c = 1; c <= COURT_COUNT; c += 1) courts.push(store.courtSnapshot(c));
    return send(res, 200, { courts });
  }

  // ---- scoring (idempotent via last_log_id) - REST twin of the socket 'match:action'
  if (pathname === '/api/score' && method === 'POST') {
    const b = await readBody(req);
    if (!validDevice(b.device_id)) throw new StoreError('device_id tidak valid');
    const r = store.action(b.match_number, b.device_id, b);
    return send(res, r.ok ? 200 : 409, r);
  }

  if (pathname === '/api/export/google-apps-script.gs') {
    const gsPath = path.join(ROOT, 'docs', 'google-apps-script.gs');
    const code = fs.existsSync(gsPath) ? fs.readFileSync(gsPath, 'utf8') : '';
    return send(res, 200, code, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': 'inline; filename="google-apps-script.gs"',
    });
  }
  if (pathname === '/api/export/results.csv') {
    const rows = Object.values(store.matches)
      .filter((m) => m.session_management.status === 'finished')
      .map(resultRow);
    return send(res, 200, `\uFEFF${toCsv(RESULT_HEADER, rows)}`, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="smashpoint-results.csv"' });
  }
  if (pathname === '/api/export/logs.csv') {
    const id = searchParams.get('match');
    const rawLogs = id ? store.getLogs(id.toUpperCase()) : Object.values(store.logs).flat().sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
    const logs = rawLogs.map((l) => formatLogRow(l, store.get(l.match_number)));
    return send(res, 200, `\uFEFF${toCsv(LOG_HEADER, logs)}`, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="smashpoint-logs${id ? `-${id}` : ''}.csv"` });
  }

  // ---- admin authentication & user management (RBAC)
  if (pathname === '/api/admin/login' && method === 'POST') {
    const b = await readBody(req);
    const { token, user } = adminAuth.login(b.username, b.password);
    return send(res, 200, { ok: true, token, user });
  }
  if (pathname === '/api/admin/logout' && method === 'POST') {
    const token = req.headers['x-admin-token'] || req.headers['x-admin-pin'] || '';
    adminAuth.logout(token);
    return send(res, 200, { ok: true });
  }
  if (pathname === '/api/admin/verify' && (method === 'POST' || method === 'GET')) {
    const user = adminAuth.verifyRequest(req);
    return user
      ? send(res, 200, { ok: true, user })
      : send(res, 401, { ok: false, error: 'Sesi berakhir atau kredensial tidak valid' });
  }

  const adminUser = adminAuth.verifyRequest(req);
  if (!adminUser) return send(res, 401, { ok: false, error: 'Akses admin ditolak (Silakan login dengan Username & Password)' });

  if (pathname === '/api/admin/me/password' && method === 'POST') {
    const b = await readBody(req);
    const updated = adminAuth.changeOwnPassword(adminUser.username, {
      currentPassword: b.current_password,
      newPassword: b.new_password,
      displayName: b.display_name,
    });
    return send(res, 200, { ok: true, user: updated });
  }

  if (pathname === '/api/admin/users' && method === 'GET') {
    adminAuth.mustVerifyRequest(req, { requireSuper: true });
    return send(res, 200, { ok: true, users: adminAuth.listUsers() });
  }
  if (pathname === '/api/admin/users' && method === 'POST') {
    const actor = adminAuth.mustVerifyRequest(req, { requireSuper: true });
    const b = await readBody(req);
    const created = adminAuth.createUser(actor, b);
    return send(res, 200, { ok: true, user: created, users: adminAuth.listUsers() });
  }
  if (parts[1] === 'admin' && parts[2] === 'users' && parts[3]) {
    const actor = adminAuth.mustVerifyRequest(req, { requireSuper: true });
    const targetUsername = decodeURIComponent(parts[3]);
    if (method === 'PATCH') {
      const b = await readBody(req);
      const updated = adminAuth.updateUser(actor, targetUsername, b);
      return send(res, 200, { ok: true, user: updated, users: adminAuth.listUsers() });
    }
    if (method === 'DELETE') {
      adminAuth.deleteUser(actor, targetUsername);
      return send(res, 200, { ok: true, users: adminAuth.listUsers() });
    }
  }

  if (pathname === '/api/admin/status') {
    return send(res, 200, {
      exporter: sheetsExporter.status(),
      sync: syncStatus(),
      user: adminUser,
      active_profile: profileManager.activeProfile(store),
      profiles: profileManager.list(store),
    });
  }

  // ---- tournament profile management (available to ALL logged-in admins: Super Admin & Operational Admin)
  if (pathname === '/api/admin/profiles' && method === 'GET') {
    return send(res, 200, {
      ok: true,
      active_profile: profileManager.activeProfile(store),
      profiles: profileManager.list(store),
    });
  }
  if (pathname === '/api/admin/profiles' && method === 'POST') {
    const b = await readBody(req);
    const created = profileManager.create({
      name: b.name,
      description: b.description,
      createdBy: adminUser.username,
    });
    if (b.activate) {
      switchTournamentProfile(created.id);
    } else {
      emitAdmin();
    }
    return send(res, 200, {
      ok: true,
      profile: profileManager.profileSummary(created, store),
      active_profile: profileManager.activeProfile(store),
      profiles: profileManager.list(store),
      matches: store.list().map((m) => store.toPublic(m)),
      exporter: sheetsExporter.status(),
      sync: syncStatus(),
    });
  }
  if (parts[1] === 'admin' && parts[2] === 'profiles' && parts[3]) {
    const profId = decodeURIComponent(parts[3]);
    if (parts[4] === 'activate' && method === 'POST') {
      const activeProf = switchTournamentProfile(profId);
      return send(res, 200, {
        ok: true,
        active_profile: activeProf,
        profiles: profileManager.list(store),
        matches: store.list().map((m) => store.toPublic(m)),
        exporter: sheetsExporter.status(),
        sync: syncStatus(),
      });
    }
    if (parts[4] === 'close' && method === 'POST') {
      const b = await readBody(req);
      profileManager.closeTournament(profId, {
        closedBy: adminUser.username,
        closing_notes: b.closing_notes,
        venue: b.venue,
        chief_referee: b.chief_referee,
        committee_head: b.committee_head,
      });
      emitAdmin();
      return send(res, 200, {
        ok: true,
        active_profile: profileManager.activeProfile(store),
        profiles: profileManager.list(store),
      });
    }
    if (parts[4] === 'reopen' && method === 'POST') {
      profileManager.reopenTournament(profId);
      emitAdmin();
      return send(res, 200, {
        ok: true,
        active_profile: profileManager.activeProfile(store),
        profiles: profileManager.list(store),
      });
    }
    if (parts.length === 4 && method === 'PATCH') {
      const b = await readBody(req);
      profileManager.update(profId, b);
      emitAdmin();
      return send(res, 200, {
        ok: true,
        active_profile: profileManager.activeProfile(store),
        profiles: profileManager.list(store),
      });
    }
    if (parts.length === 4 && method === 'DELETE') {
      profileManager.delete(profId);
      emitAdmin();
      return send(res, 200, {
        ok: true,
        active_profile: profileManager.activeProfile(store),
        profiles: profileManager.list(store),
      });
    }
  }
  if (pathname === '/api/admin/export/retry' && method === 'POST') {
    await sheetsExporter.flush();
    return send(res, 200, { ok: true, exporter: sheetsExporter.status() });
  }
  if (pathname === '/api/admin/export/push-state' && method === 'POST') {
    try {
      const resSync = await sheetsExporter.pushStateSnapshot(store.matches);
      emitAdmin();
      return send(res, 200, { ok: true, ...resSync, exporter: sheetsExporter.status() });
    } catch (e) {
      sheetsExporter.lastError = e.message;
      emitAdmin();
      return send(res, 400, { ok: false, error: e.message, exporter: sheetsExporter.status() });
    }
  }
  if (pathname === '/api/admin/backup/export' && method === 'GET') {
    const activeProf = profileManager.activeProfile(store);
    const bundle = store.exportStateBundle({
      profile: activeProf,
      sync: {
        url: sheetSync.url,
        sheetName: sheetSync.sheetName,
        intervalSec: sheetSync.intervalSec,
        webhookUrl: sheetsExporter.webhookUrl,
      },
    });
    const safeName = String(activeProf?.id || 'turnamen').replace(/[^a-z0-9_-]/gi, '_');
    return send(res, 200, JSON.stringify(bundle, null, 2), {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="smashpoint-state-${safeName}.json"`,
    });
  }
  if (pathname === '/api/admin/backup/import' && method === 'POST') {
    const b = await readBody(req, 20 * 1024 * 1024);
    const bundle = b.bundle || b;
    const resRestore = store.importStateBundle(bundle, { merge: Boolean(b.merge) });
    if (bundle.sync && typeof bundle.sync === 'object') {
      if (bundle.sync.url && !sheetSync.url) sheetSync.url = bundle.sync.url;
      if (bundle.sync.sheetName) sheetSync.sheetName = bundle.sync.sheetName;
      if (bundle.sync.webhookUrl && !sheetsExporter.webhookUrl) {
        sheetsExporter.setConfig({ webhookUrl: bundle.sync.webhookUrl });
      }
      saveSyncConfig();
    }
    for (let c = 1; c <= COURT_COUNT; c += 1) emitCourt(c);
    emitAdmin();
    return send(res, 200, {
      ok: true,
      ...resRestore,
      matches: store.list().map((m) => store.toPublic(m)),
      active_profile: profileManager.activeProfile(store),
      profiles: profileManager.list(store),
      exporter: sheetsExporter.status(),
      sync: syncStatus(),
    });
  }
  if (pathname === '/api/admin/export/config' && method === 'POST') {
    const b = await readBody(req);
    sheetsExporter.setConfig({
      webhookUrl: b.webhook_url,
      webhookSecret: b.webhook_secret,
    });
    saveSyncConfig();
    if (b.test && sheetsExporter.webhookUrl) {
      try {
        const testRes = await sheetsExporter.testConnection();
        await sheetsExporter.flush();
        emitAdmin();
        return send(res, 200, { ok: true, exporter: sheetsExporter.status(), test: testRes });
      } catch (e) {
        sheetsExporter.lastError = e.message;
        emitAdmin();
        return send(res, 400, { ok: false, error: e.message, exporter: sheetsExporter.status() });
      }
    }
    if (sheetsExporter.webhookUrl && sheetsExporter.queue.length) {
      await sheetsExporter.flush();
    }
    emitAdmin();
    return send(res, 200, { ok: true, exporter: sheetsExporter.status() });
  }

  if (pathname === '/api/admin/sync' && method === 'POST') {
    const b = await readBody(req);
    if (b.url !== undefined) sheetSync.url = String(b.url || '').trim();
    if (b.sheet_name !== undefined) sheetSync.sheetName = String(b.sheet_name || 'Jadwal').trim() || 'Jadwal';
    if (b.interval_sec !== undefined) {
      const iv = parseInt(b.interval_sec, 10);
      sheetSync.intervalSec = Number.isInteger(iv) && iv >= 5 ? iv : 0;
    }
    saveSyncConfig();
    restartAutoSyncTimer();
    let syncRes = null;
    if (b.run_now && sheetSync.url) {
      syncRes = await runAutoSync();
    }
    return send(res, 200, { ok: true, sync: syncStatus(), result: syncRes });
  }

  if (pathname === '/api/import' && method === 'POST') {
    const b = await readBody(req);
    if (b.url) {
      sheetSync.url = String(b.url).trim();
      if (b.sheet_name !== undefined) {
        sheetSync.sheetName = String(b.sheet_name || 'Jadwal').trim() || 'Jadwal';
      }
      saveSyncConfig();
      restartAutoSyncTimer();
      const resData = await fetchAndIngestUrl(b.url, { dryRun: Boolean(b.dry_run), sheetName: sheetSync.sheetName });
      if (!b.dry_run) {
        sheetSync.lastSync = new Date().toISOString();
        sheetSync.lastResult = { total: resData.total, created: resData.created, updated: resData.updated, errors: resData.errors?.length || 0 };
        sheetSync.lastError = null;
        emitAdmin();
      }
      return send(res, 200, { ...resData, sync: syncStatus() });
    }
    const input = b.rows || b.csv || '';
    const parsed = ingest(input, { courtCount: COURT_COUNT });
    if (b.dry_run) return send(res, 200, { ok: true, dry_run: true, valid: parsed.matches.length, total: parsed.total, errors: parsed.errors });
    const result = store.upsertMatches(parsed.matches);
    return send(res, 200, { ok: true, total: parsed.total, ...result, errors: parsed.errors });
  }

  if (parts[1] === 'matches' && parts.length === 2 && method === 'DELETE') {
    store.adminClearAll();
    return send(res, 200, { ok: true });
  }

  if (parts[1] === 'matches' && parts[2]) {
    const id = decodeURIComponent(parts[2]);
    if (parts.length === 3 && method === 'PATCH') return send(res, 200, { ok: true, match: store.adminUpdate(id, await readBody(req)) });
    if (parts.length === 3 && method === 'DELETE') {
      store.adminDelete(id);
      return send(res, 200, { ok: true });
    }
    if (method === 'POST') {
      const op = parts[3];
      if (op === 'unlock') return send(res, 200, { ok: true, match: store.adminUnlock(id) });
      if (op === 'reset') return send(res, 200, { ok: true, match: store.adminReset(id) });
      if (op === 'reopen') return send(res, 200, { ok: true, match: store.adminReopen(id) });
      if (op === 'reset_override') return send(res, 200, { ok: true, match: store.adminResetOverride(id) });
      if (op === 'toggle_history') {
        const body = await readBody(req);
        return send(res, 200, { ok: true, match: store.toggleOverlayHistory(id, body?.show) });
      }
      if (op === 'export') {
        const m = store.mustGet(id);
        if (m.session_management.status !== 'finished') throw new StoreError('Hanya match berstatus selesai yang dapat diekspor');
        await sheetsExporter.pushResults(m, store.getLogs(m.match_number));
        return send(res, 200, { ok: true, match: store.toPublic(m) });
      }
    }
  }
  return send(res, 404, { ok: false, error: 'Endpoint tidak ditemukan' });
}

// ------------------------------------------------------------------ boot
const server = http.createServer();
const app = next({ dev: !prod, hostname: HOST, port: PORT });
const nextHandler = app.getRequestHandler();

const io = new Server(server, { cors: { origin: '*' }, destroyUpgrade: false, pingInterval: 10000, pingTimeout: 20000 });

// ---- broadcasting (rooms per match & court so courts don't flood each other)
let adminTimer = null;
function emitAdmin() {
  if (adminTimer) return;
  adminTimer = setTimeout(() => {
    adminTimer = null;
    io.to('admin').emit('admin:state', {
      matches: store.list().map((m) => store.toPublic(m)),
      exporter: sheetsExporter.status(),
      sync: syncStatus(),
      active_profile: profileManager.activeProfile(store),
      profiles: profileManager.list(store),
    });
  }, 200);
}
function emitCourt(court) {
  if (court) io.to(`court:${court}`).emit('court:state', store.courtSnapshot(court));
}
store.on('change', (m, prevCourt) => {
  io.to(m.match_number).emit('match:state', store.toPublic(m));
  emitCourt(m.court_number);
  if (prevCourt && prevCourt !== m.court_number) emitCourt(prevCourt);
  emitAdmin();
});
store.on('removed', (m) => {
  io.to(m.match_number).emit('match:removed', { match_number: m.match_number });
  emitCourt(m.court_number);
  emitAdmin();
});
store.on('kick', (deviceId, matchNumber, message) => {
  io.to(`device:${deviceId}`).emit('session:kicked', { match_number: matchNumber, message });
});

function wrap(fn) {
  return (data, ack) => {
    const cb = typeof ack === 'function' ? ack : () => {};
    try {
      cb(fn(data || {}));
    } catch (e) {
      if (e instanceof StoreError) cb({ ok: false, error: e.message, reason: e.code });
      else {
        console.error('[socket]', e);
        cb({ ok: false, error: 'Kesalahan server' });
      }
    }
  };
}

io.on('connection', (socket) => {
  socket.on('hello', wrap(({ device_id }) => {
    if (validDevice(device_id)) {
      socket.data.device_id = device_id;
      socket.join(`device:${device_id}`);
    }
    return { ok: true, server_time: new Date().toISOString(), court_count: COURT_COUNT };
  }));

  socket.on('match:watch', wrap(({ match_number }) => {
    const m = store.mustGet(match_number);
    for (const r of socket.rooms) if (r !== socket.id && !r.startsWith('device:') && !r.startsWith('court:') && r !== 'admin') socket.leave(r);
    socket.join(m.match_number);
    socket.join(`court:${m.court_number}`);
    const snap = store.courtSnapshot(m.court_number);
    return { ok: true, match: store.toPublic(m), previous: snap.previous, upcoming: snap.upcoming };
  }));
  socket.on('match:unwatch', wrap(({ match_number }) => {
    socket.leave(String(match_number || '').toUpperCase());
    return { ok: true };
  }));
  socket.on('court:watch', wrap(({ court }) => {
    const c = parseInt(court, 10);
    if (!(c >= 1 && c <= COURT_COUNT)) throw new StoreError('Nomor lapangan tidak valid');
    socket.join(`court:${c}`);
    return { ok: true, snapshot: store.courtSnapshot(c) };
  }));
  socket.on('courts:watch_all', wrap(() => {
    const snapshots = {};
    for (let c = 1; c <= COURT_COUNT; c += 1) {
      socket.join(`court:${c}`);
      snapshots[c] = store.courtSnapshot(c);
    }
    return {
      ok: true,
      court_count: COURT_COUNT,
      active_profile: profileManager.activeProfile(store),
      snapshots,
    };
  }));
  socket.on('admin:watch', wrap(({ pin, token }) => {
    const user = adminAuth.verifyToken(token || pin);
    if (!user) throw new StoreError('Sesi Admin tidak valid atau sudah berakhir', 'bad_pin');
    socket.join('admin');
    return {
      ok: true,
      user,
      matches: store.list().map((m) => store.toPublic(m)),
      exporter: sheetsExporter.status(),
      sync: syncStatus(),
      active_profile: profileManager.activeProfile(store),
      profiles: profileManager.list(store),
    };
  }));

  // ---- session manager
  socket.on('match:lock', wrap(({ match_number, device_id, label }) => {
    if (!validDevice(device_id)) throw new StoreError('device_id tidak valid');
    const r = store.lock(match_number, device_id, String(label || '').slice(0, 40));
    socket.join(r.match.match_number);
    return r;
  }));
  socket.on('match:takeover', wrap(({ match_number, device_id, label, pin }) => {
    if (!validDevice(device_id)) throw new StoreError('device_id tidak valid');
    return store.takeover(match_number, device_id, String(label || '').slice(0, 40), pin);
  }));
  socket.on('match:release', wrap(({ match_number, device_id }) => store.release(match_number, device_id)));
  socket.on('PING', wrap(({ match_number, device_id }) => store.heartbeat(match_number, device_id)));

  // ---- scoring
  socket.on('match:action', wrap((data) => {
    if (!validDevice(data.device_id)) throw new StoreError('device_id tidak valid');
    return store.action(data.match_number, data.device_id, data);
  }));
});

// Heartbeat sweeper: releases locks without PING for > LOCK_TIMEOUT_MS
setInterval(() => store.sweep(), 5000);

await app.prepare();
const nextUpgrade = typeof app.getUpgradeHandler === 'function' ? app.getUpgradeHandler() : null;

server.on('request', async (req, res) => {
  // Ignore Socket.io HTTP long-polling requests (already handled by engine.io)
  if (req.url?.startsWith('/socket.io')) return;
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    try {
      await handleApi(req, res, url);
    } catch (e) {
      if (res.headersSent) return;
      if (e instanceof StoreError) send(res, e.status || 400, { ok: false, error: e.message, reason: e.code });
      else {
        console.error('[api]', e);
        send(res, 500, { ok: false, error: 'Kesalahan server' });
      }
    }
    return;
  }
  nextHandler(req, res);
});
server.on('upgrade', (req, socket, head) => {
  if (req.url?.startsWith('/socket.io')) return; // handled by socket.io
  if (nextUpgrade) nextUpgrade(req, socket, head);
});

const shutdown = () => {
  store.flush();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, HOST, () => {
  const ifaces = Object.entries(os.networkInterfaces()).flatMap(([name, list]) =>
    (list || [])
      .filter((i) => i && i.family === 'IPv4' && !i.internal)
      .map((i) => ({ name, address: i.address }))
  );
  console.log(`\n  SmashPoint v2.1 ${prod ? '(production)' : '(development)'} siap`);
  console.log(`  Lokal : http://localhost:${PORT}`);
  for (const { name, address } of ifaces) {
    console.log(`  LAN   : http://${address}:${PORT}   <-- [${name}]`);
  }
  console.log(`  Admin PIN / Master PIN: ${ADMIN_PIN === '1234' || MASTER_PIN === '1234' ? '(default 1234 - ganti via .env!)' : '(dari .env)'}\n`);
});
