/**
 * SmashPoint Server (HUB)
 * One Node process hosts: Next.js UI, REST API, Socket.io real-time broadcaster,
 * State Machine store and Session Manager - so in-memory state is shared.
 */
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import next from 'next';
import nextEnv from '@next/env';
import { Server } from 'socket.io';
import { Store, StoreError } from './lib/server/store.js';
import { SheetsExporter, RESULT_HEADER, LOG_HEADER, resultRow } from './lib/server/sheetsExporter.js';
import { ingest, toCsv, COLUMNS, OPTIONAL_COLUMNS } from './lib/server/ingest.js';

const prod = process.argv.includes('--prod') || process.env.NODE_ENV === 'production';
nextEnv.loadEnvConfig(process.cwd(), !prod);
if (prod) process.env.NODE_ENV = 'production';

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const COURT_COUNT = parseInt(process.env.COURT_COUNT || '15', 10);
const MASTER_PIN = process.env.MASTER_PIN || '1234';
const ADMIN_PIN = process.env.ADMIN_PIN || MASTER_PIN;
const LOCK_TIMEOUT_MS = parseInt(process.env.LOCK_TIMEOUT_MS || '60000', 10);
const HEARTBEAT_MS = 10000;
const ROOT = process.cwd();

const store = new Store({ dataDir: path.join(ROOT, 'data'), courtCount: COURT_COUNT, lockTimeoutMs: LOCK_TIMEOUT_MS, masterPin: MASTER_PIN });
const sheetsExporter = new SheetsExporter({
  exportDir: path.join(ROOT, 'exports'),
  dataDir: path.join(ROOT, 'data'),
  webhookUrl: process.env.GOOGLE_SHEETS_WEBHOOK_URL,
  webhookSecret: process.env.GOOGLE_SHEETS_WEBHOOK_SECRET,
  onStatus: (id, status) => store.setExportStatus(id, status),
});

// Event listener: status -> finished triggers export (PRD 8.3)
store.on('finished', (match, logs) => {
  sheetsExporter.pushResults(match, logs).catch((e) => console.error('[exporter]', e));
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

const isAdmin = (req) => String(req.headers['x-admin-pin'] || '') === ADMIN_PIN;
const validDevice = (id) => typeof id === 'string' && id.length >= 8 && id.length <= 100;

function toSheetsCsvUrl(url) {
  const u = String(url || '').trim();
  const m = u.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m && !/\/pub\b|output=csv|format=csv/.test(u)) {
    const gid = (u.match(/[#&?]gid=(\d+)/) || [])[1] || '0';
    return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`;
  }
  return u;
}

async function handleApi(req, res, url) {
  const { pathname, searchParams } = url;
  const method = req.method;
  const parts = pathname.split('/').filter(Boolean); // ['api', ...]

  if (pathname === '/api/health') return send(res, 200, { ok: true, time: new Date().toISOString(), matches: Object.keys(store.matches).length });
  if (pathname === '/api/config') return send(res, 200, { court_count: COURT_COUNT, heartbeat_ms: HEARTBEAT_MS, lock_timeout_ms: LOCK_TIMEOUT_MS });

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

  // ---- exports (read-only)
  if (pathname === '/api/export/results.csv') {
    const rows = Object.values(store.matches)
      .filter((m) => m.session_management.status === 'finished')
      .map(resultRow);
    return send(res, 200, `\uFEFF${toCsv(RESULT_HEADER, rows)}`, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="smashpoint-results.csv"' });
  }
  if (pathname === '/api/export/logs.csv') {
    const id = searchParams.get('match');
    const logs = id ? store.getLogs(id.toUpperCase()) : Object.values(store.logs).flat().sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return send(res, 200, `\uFEFF${toCsv(LOG_HEADER, logs)}`, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="smashpoint-logs${id ? `-${id}` : ''}.csv"` });
  }

  // ---- admin
  if (pathname === '/api/admin/verify' && method === 'POST') {
    return isAdmin(req) ? send(res, 200, { ok: true }) : send(res, 403, { ok: false, error: 'PIN Admin salah' });
  }
  if (!isAdmin(req)) return send(res, 403, { ok: false, error: 'Akses admin ditolak (PIN salah)' });

  if (pathname === '/api/admin/status') return send(res, 200, { exporter: sheetsExporter.status() });
  if (pathname === '/api/admin/export/retry' && method === 'POST') {
    await sheetsExporter.flush();
    return send(res, 200, { ok: true, exporter: sheetsExporter.status() });
  }

  if (pathname === '/api/import' && method === 'POST') {
    const b = await readBody(req);
    let input = b.rows || b.csv || '';
    if (b.url) {
      const target = toSheetsCsvUrl(b.url);
      const r = await fetch(target, { redirect: 'follow' }).catch((e) => {
        throw new StoreError(`Gagal mengambil URL: ${e.message}`);
      });
      if (!r.ok) throw new StoreError(`Gagal mengambil URL (HTTP ${r.status}). Pastikan Sheet dibagikan "Siapa saja yang memiliki link" atau dipublikasikan sebagai CSV.`);
      input = await r.text();
      if (/^\s*<(!doctype|html)/i.test(input)) throw new StoreError('URL mengembalikan halaman HTML, bukan CSV. Gunakan link publikasi CSV.');
    }
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
    io.to('admin').emit('admin:state', { matches: store.list().map((m) => store.toPublic(m)), exporter: sheetsExporter.status() });
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
    return { ok: true, match: store.toPublic(m) };
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
  socket.on('admin:watch', wrap(({ pin }) => {
    if (String(pin || '') !== ADMIN_PIN) throw new StoreError('PIN Admin salah', 'bad_pin');
    socket.join('admin');
    return { ok: true, matches: store.list().map((m) => store.toPublic(m)), exporter: sheetsExporter.status() };
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
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    try {
      await handleApi(req, res, url);
    } catch (e) {
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
