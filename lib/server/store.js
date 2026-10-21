/**
 * SmashPoint Store - in-memory master state with JSON file persistence (offline-first).
 *
 * Holds:
 *  - matches   : Matches collection (master state)  -> PRD 6.1
 *  - logs      : MatchLogs append-only audit trail  -> PRD 6.2
 *  - undo      : per-match snapshot stack backing UNDO
 *
 * Also implements the Session Manager (Exclusive Match Lock, Heartbeat expiry,
 * Emergency Takeover) -> PRD 4 & 8.2.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { applyAction, courtPositions, DISCIPLINES, DOUBLES, EngineError, initialLiveState, playerName, SCORING_METHODS, SCORING_TYPES } from '../engine.js';

const ACTIVE_STATUSES = ['locked', 'in_progress'];
const UNDO_LIMIT = 500;

const uuid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();
const tagOf = (id) => (id ? String(id).slice(-6) : null);

export function parseTime(s) {
  const m = String(s || '').match(/(\d{1,2})[:.](\d{2})/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 99999;
}

export class StoreError extends Error {
  constructor(message, code = 'error', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export class Store extends EventEmitter {
  constructor({ dataDir, courtCount = 15, lockTimeoutMs = 60000, masterPin = '1234' }) {
    super();
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'db.json');
    this.courtCount = courtCount;
    this.lockTimeoutMs = lockTimeoutMs;
    this.masterPin = String(masterPin);
    this.matches = {};
    this.logs = {};
    this.undo = {};
    this._saveTimer = null;
    this.load();
  }

  // ---------------------------------------------------------------- persistence
  load() {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      if (fs.existsSync(this.file)) {
        const db = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        this.matches = db.matches || {};
        this.logs = db.logs || {};
        this.undo = db.undo || {};
      }
    } catch (e) {
      console.error('[store] gagal memuat database, memulai kosong:', e.message);
    }
  }

  persist() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.flush();
    }, 250);
  }

  flush() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    try {
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ matches: this.matches, logs: this.logs, undo: this.undo }));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[store] gagal menyimpan database:', e.message);
    }
  }

  // ---------------------------------------------------------------- read
  get(matchNumber) {
    return this.matches[String(matchNumber || '').trim().toUpperCase()] || null;
  }

  mustGet(matchNumber) {
    const m = this.get(matchNumber);
    if (!m) throw new StoreError(`Match ${matchNumber} tidak ditemukan`, 'not_found', 404);
    return m;
  }

  list({ court } = {}) {
    let arr = Object.values(this.matches);
    if (court) arr = arr.filter((m) => m.court_number === Number(court));
    return arr.sort((x, y) => x.court_number - y.court_number || parseTime(x.scheduled_time) - parseTime(y.scheduled_time) || x.match_number.localeCompare(y.match_number));
  }

  getLogs(matchNumber) {
    return this.logs[String(matchNumber).toUpperCase()] || [];
  }

  isLockActive(m) {
    const s = m.session_management;
    if (!s.active_controller_id) return false;
    return Date.now() - new Date(s.last_heartbeat || 0).getTime() <= this.lockTimeoutMs;
  }

  /** Public shape broadcast to clients (no secrets: full controller id & undo stack hidden). */
  toPublic(m) {
    if (!m) return null;
    const s = m.session_management;
    const st = m.live_state;
    return {
      match_number: m.match_number,
      tournament_name: m.tournament_name,
      category_name: m.category_name,
      discipline: m.discipline,
      scheduled_date: m.scheduled_date || '',
      scheduled_time: m.scheduled_time,
      court_number: m.court_number,
      rules: m.rules,
      teams: m.teams,
      session_management: {
        status: s.status,
        locked: this.isLockActive(m),
        controller_tag: tagOf(s.active_controller_id),
        controller_label: s.controller_label || null,
        last_heartbeat: s.last_heartbeat,
      },
      live_state: {
        ...st,
        court_positions: courtPositions(m),
        service_status: {
          ...st.service_status,
          player_name: playerName(m, st.service_status.player_id),
          receiver_name: playerName(m, st.service_status.receiver_id),
        },
      },
      last_log_id: m.last_log_id,
      can_undo: (this.undo[m.match_number] || []).length > 0 && s.status !== 'finished',
      export_status: m.export_status || null,
      version: m.version,
      updated_at: m.updated_at,
      finished_at: m.finished_at || null,
    };
  }

  summary(m) {
    const p = this.toPublic(m);
    return p;
  }

  courtSnapshot(court) {
    const c = Number(court);
    const ms = this.list({ court: c });
    const active = ms
      .filter((m) => ACTIVE_STATUSES.includes(m.session_management.status))
      .sort((x, y) => (y.updated_at || '').localeCompare(x.updated_at || ''))[0];
    let featured = active || null;
    if (!featured) {
      const fin = ms
        .filter((m) => m.session_management.status === 'finished' && m.finished_at)
        .sort((x, y) => y.finished_at.localeCompare(x.finished_at))[0];
      if (fin && Date.now() - new Date(fin.finished_at).getTime() < 15 * 60 * 1000) featured = fin;
    }
    const upcoming = ms
      .filter((m) => m.session_management.status === 'scheduled')
      .slice(0, 4)
      .map((m) => ({
        match_number: m.match_number,
        scheduled_date: m.scheduled_date || '',
        scheduled_time: m.scheduled_time,
        category_name: m.category_name,
        discipline: m.discipline,
        team_a: [m.teams.team_a.p1, m.teams.team_a.p2].filter(Boolean).join(' / '),
        team_b: [m.teams.team_b.p1, m.teams.team_b.p2].filter(Boolean).join(' / '),
      }));
    return { court: c, match: this.toPublic(featured), upcoming };
  }

  // ---------------------------------------------------------------- write helpers
  _touch(m, prevCourt = m.court_number) {
    m.version = (m.version || 0) + 1;
    m.updated_at = nowIso();
    this.persist();
    this.emit('change', m, prevCourt);
  }

  _log(m, event_type, details, actor_id) {
    const entry = {
      log_id: uuid(),
      match_number: m.match_number,
      timestamp: nowIso(),
      event_type,
      details,
      actor_id: actor_id || 'system',
      score_a: m.live_state.score.a,
      score_b: m.live_state.score.b,
      set: m.live_state.current_set,
    };
    (this.logs[m.match_number] ||= []).push(entry);
    return entry;
  }

  // ---------------------------------------------------------------- ingest
  upsertMatches(list) {
    let created = 0;
    let updated = 0;
    const skipped = [];
    for (const inc of list) {
      const existing = this.matches[inc.match_number];
      if (!existing) {
        this.matches[inc.match_number] = {
          ...inc,
          session_management: { status: 'scheduled', active_controller_id: null, controller_label: null, last_heartbeat: null, locked_at: null },
          live_state: initialLiveState(),
          last_log_id: null,
          version: 0,
          created_at: nowIso(),
          updated_at: nowIso(),
        };
        this._log(this.matches[inc.match_number], 'IMPORT', 'Match diimpor', 'admin');
        created += 1;
        this._touch(this.matches[inc.match_number]);
      } else {
        const started = existing.session_management.status !== 'scheduled' || existing.live_state.phase !== 'setup';
        const prevCourt = existing.court_number;
        existing.tournament_name = inc.tournament_name;
        existing.category_name = inc.category_name;
        existing.scheduled_date = inc.scheduled_date;
        existing.scheduled_time = inc.scheduled_time;
        existing.court_number = inc.court_number;
        if (!started) {
          existing.discipline = inc.discipline;
          existing.rules = inc.rules;
          existing.teams = inc.teams;
          existing.live_state = initialLiveState();
        } else {
          skipped.push(inc.match_number);
        }
        this._log(existing, 'IMPORT_UPDATE', started ? 'Metadata jadwal diperbarui (aturan & pemain dikunci karena laga sudah dimulai)' : 'Data match diperbarui via import', 'admin');
        updated += 1;
        this._touch(existing, prevCourt);
      }
    }
    return { created, updated, locked_rules: skipped };
  }

  // ---------------------------------------------------------------- session manager
  lock(matchNumber, deviceId, label) {
    const m = this.mustGet(matchNumber);
    const s = m.session_management;
    if (s.status === 'finished') {
      return { ok: true, mode: 'spectator', message: `Match ${m.match_number} sudah selesai. Mode pemantau.`, match: this.toPublic(m) };
    }
    if (s.active_controller_id && s.active_controller_id !== deviceId && this.isLockActive(m)) {
      return {
        ok: true,
        mode: 'spectator',
        reason: 'locked_by_other',
        message: `Akses Ditolak: Match ${m.match_number} sedang dikontrol oleh Wasit di Lapangan ${m.court_number}${s.controller_label ? ` (${s.controller_label})` : ''}. Anda masuk dalam mode pemantau.`,
        match: this.toPublic(m),
      };
    }
    const same = s.active_controller_id === deviceId;
    s.active_controller_id = deviceId;
    s.controller_label = label || s.controller_label || null;
    s.last_heartbeat = nowIso();
    if (!same) s.locked_at = nowIso();
    if (s.status === 'scheduled') s.status = 'locked';
    if (!same) this._log(m, 'LOCK', `Sesi dikunci oleh perangkat ${tagOf(deviceId)}${label ? ` (${label})` : ''}`, deviceId);
    this._touch(m);
    return { ok: true, mode: 'controller', match: this.toPublic(m) };
  }

  heartbeat(matchNumber, deviceId) {
    const m = this.mustGet(matchNumber);
    const s = m.session_management;
    if (s.active_controller_id !== deviceId) return { ok: false, reason: 'not_controller' };
    s.last_heartbeat = nowIso();
    this.persist();
    return { ok: true, server_time: s.last_heartbeat };
  }

  takeover(matchNumber, deviceId, label, pin) {
    const m = this.mustGet(matchNumber);
    if (String(pin || '') !== this.masterPin) {
      this._log(m, 'TAKEOVER_DENIED', `Percobaan takeover dengan PIN salah dari ${tagOf(deviceId)}`, deviceId);
      this.persist();
      throw new StoreError('Master PIN salah', 'bad_pin', 403);
    }
    const s = m.session_management;
    if (s.status === 'finished') throw new StoreError('Match sudah selesai', 'finished', 409);
    const prev = s.active_controller_id;
    s.active_controller_id = deviceId;
    s.controller_label = label || null;
    s.last_heartbeat = nowIso();
    s.locked_at = nowIso();
    if (s.status === 'scheduled') s.status = 'locked';
    this._log(m, 'TAKEOVER', `Emergency takeover: ${tagOf(prev) || '-'} -> ${tagOf(deviceId)}${label ? ` (${label})` : ''}`, deviceId);
    this._touch(m);
    if (prev && prev !== deviceId) {
      this.emit('kick', prev, m.match_number, `Sesi Anda untuk Match ${m.match_number} telah diambil alih oleh perangkat lain (${label || tagOf(deviceId)}). Anda sekarang dalam mode pemantau.`);
    }
    return { ok: true, mode: 'controller', match: this.toPublic(m) };
  }

  release(matchNumber, deviceId) {
    const m = this.mustGet(matchNumber);
    const s = m.session_management;
    if (s.active_controller_id !== deviceId) return { ok: false, reason: 'not_controller' };
    this._releaseLock(m, `Kontrol dilepas oleh ${tagOf(deviceId)}`, deviceId);
    return { ok: true };
  }

  _releaseLock(m, reason, actor) {
    const s = m.session_management;
    s.active_controller_id = null;
    s.controller_label = null;
    if (s.status === 'locked' && m.live_state.phase === 'setup' && m.live_state.current_set === 1 && !m.last_log_id) s.status = 'scheduled';
    this._log(m, 'UNLOCK', reason, actor);
    this._touch(m);
  }

  /** Release locks whose heartbeat stopped > lockTimeout (PRD 8.2). */
  sweep() {
    const now = Date.now();
    for (const m of Object.values(this.matches)) {
      const s = m.session_management;
      if (s.active_controller_id && now - new Date(s.last_heartbeat || 0).getTime() > this.lockTimeoutMs) {
        const dev = s.active_controller_id;
        this._releaseLock(m, `Kunci sesi dilepas otomatis (tidak ada heartbeat > ${Math.round(this.lockTimeoutMs / 1000)} detik)`, 'system');
        this.emit('kick', dev, m.match_number, `Kunci sesi Match ${m.match_number} kedaluwarsa karena koneksi terputus. Kunci ulang untuk melanjutkan.`);
      }
    }
  }

  // ---------------------------------------------------------------- scoring actions
  /**
   * Executes a controller action with idempotency guard (PRD 8.1):
   * the client sends the last_log_id it knows. If it differs from the server's,
   * the request is a duplicate/stale click and is ignored.
   */
  action(matchNumber, deviceId, { type, payload, last_log_id }) {
    const m = this.mustGet(matchNumber);
    const s = m.session_management;
    if (s.active_controller_id !== deviceId || !this.isLockActive(m)) {
      throw new StoreError('Anda bukan pengontrol aktif match ini', 'not_controller', 403);
    }
    if (s.status === 'finished') throw new StoreError('Match sudah selesai', 'finished', 409);
    if ((last_log_id ?? null) !== (m.last_log_id ?? null)) {
      return { ok: false, duplicate: true, reason: 'stale', message: 'Aksi diabaikan (duplikat / data tidak sinkron).', match: this.toPublic(m) };
    }
    s.last_heartbeat = nowIso();

    if (type === 'UNDO') {
      const stack = this.undo[m.match_number] || [];
      const top = stack.pop();
      if (!top) throw new StoreError('Tidak ada aksi untuk dibatalkan', 'nothing_to_undo');
      const prevCourt = m.court_number;
      m.live_state = top.snapshot.live_state;
      m.teams = top.snapshot.teams;
      m.court_number = top.snapshot.court_number;
      if (m.live_state.phase === 'setup' && m.live_state.current_set === 1) s.status = 'locked';
      else s.status = 'in_progress';
      const entry = this._log(m, 'UNDO', `UNDO -> membatalkan ${top.event_type} (${top.log_id.slice(0, 8)}). Poin: ${m.live_state.score.a}-${m.live_state.score.b}`, deviceId);
      entry.undo_of = top.log_id;
      m.last_log_id = entry.log_id;
      this._touch(m, prevCourt);
      return { ok: true, log: entry, match: this.toPublic(m) };
    }

    let result;
    try {
      result = applyAction(m, { type, payload });
    } catch (e) {
      if (e instanceof EngineError) throw new StoreError(e.message, e.code, 400);
      throw e;
    }

    const snapshot = { live_state: m.live_state, teams: m.teams, court_number: m.court_number };
    const prevCourt = m.court_number;
    m.live_state = result.live_state;
    m.teams = result.teams;
    m.court_number = result.court_number;
    if (s.status === 'scheduled' || s.status === 'locked') {
      if (m.live_state.phase !== 'setup' || m.live_state.current_set > 1) s.status = 'in_progress';
    }
    const entry = this._log(m, result.event_type, result.details, deviceId);
    m.last_log_id = entry.log_id;

    if (type === 'CONFIRM_FINISH') {
      s.status = 'finished';
      m.finished_at = nowIso();
      s.active_controller_id = null;
      this._touch(m, prevCourt);
      this.emit('finished', m, this.getLogs(m.match_number));
    } else {
      const stack = (this.undo[m.match_number] ||= []);
      stack.push({ log_id: entry.log_id, event_type: entry.event_type, snapshot });
      if (stack.length > UNDO_LIMIT) stack.shift();
      this._touch(m, prevCourt);
    }
    return { ok: true, log: entry, match: this.toPublic(m) };
  }

  // ---------------------------------------------------------------- admin
  adminUpdate(matchNumber, patch) {
    const m = this.mustGet(matchNumber);
    const prevCourt = m.court_number;
    const prevStatus = m.session_management.status;
    const changes = [];

    if (patch.court_number !== undefined) {
      const c = parseInt(patch.court_number, 10);
      if (!Number.isInteger(c) || c < 1 || c > this.courtCount) throw new StoreError(`Lapangan harus 1-${this.courtCount}`);
      if (m.court_number !== c) {
        m.court_number = c;
        changes.push(`lapangan=${c}`);
      }
    }
    if (patch.scheduled_date !== undefined) {
      const v = String(patch.scheduled_date).trim().slice(0, 40);
      if ((m.scheduled_date || '') !== v) {
        m.scheduled_date = v;
        changes.push(`tanggal=${v || '-'}`);
      }
    }
    if (patch.scheduled_time !== undefined) {
      const v = String(patch.scheduled_time).trim().slice(0, 40);
      if (m.scheduled_time !== v) {
        m.scheduled_time = v;
        changes.push(`jam=${v || '-'}`);
      }
    }
    for (const k of ['tournament_name', 'category_name']) {
      if (patch[k] !== undefined) {
        const v = String(patch[k]).trim().slice(0, 120);
        if (m[k] !== v) {
          m[k] = v;
          changes.push(`${k}=${v}`);
        }
      }
    }
    if (patch.discipline !== undefined) {
      const d = String(patch.discipline).trim().toUpperCase();
      if (!DISCIPLINES.includes(d)) throw new StoreError('Disiplin tidak valid');
      if (m.discipline !== d) {
        m.discipline = d;
        const isDbl = DOUBLES.includes(d);
        if (!isDbl) {
          m.teams.team_a.p2 = null;
          m.teams.team_b.p2 = null;
        } else {
          if (!m.teams.team_a.p2) m.teams.team_a.p2 = 'Pemain A2';
          if (!m.teams.team_b.p2) m.teams.team_b.p2 = 'Pemain B2';
        }
        changes.push(`disiplin=${d}`);
      }
    }
    if (patch.rules && typeof patch.rules === 'object') {
      const r = m.rules;
      if (patch.rules.scoring_method !== undefined) {
        const sm = String(patch.rules.scoring_method).trim();
        if (!SCORING_METHODS.includes(sm)) throw new StoreError('Metode skor tidak valid');
        r.scoring_method = sm;
      }
      if (patch.rules.scoring_type !== undefined) {
        const st = String(patch.rules.scoring_type).trim();
        if (!SCORING_TYPES.includes(st)) throw new StoreError('Tipe skor tidak valid');
        r.scoring_type = st;
      }
      if (patch.rules.win_point !== undefined) {
        const wp = parseInt(patch.rules.win_point, 10);
        if (!Number.isInteger(wp) || wp < 1 || wp > 200) throw new StoreError('Win point harus 1-200');
        r.win_point = wp;
        r.max_point = r.scoring_type === 'sets' ? wp + 9 : wp;
      }
      if (patch.rules.interval_point !== undefined) {
        const ip = parseInt(patch.rules.interval_point, 10);
        if (!Number.isInteger(ip) || ip < 0 || ip >= r.win_point) throw new StoreError('Interval point harus 0 s/d < win_point');
        r.interval_point = ip;
      }
      changes.push(`aturan=${r.scoring_method}/${r.scoring_type}/${r.win_point}`);
    }
    if (patch.teams) {
      const isDbl = DOUBLES.includes(m.discipline);
      for (const key of ['team_a', 'team_b']) {
        const src = patch.teams[key];
        if (!src) continue;
        if (src.p1 !== undefined) {
          const v = String(src.p1).trim().slice(0, 80);
          if (!v) throw new StoreError('Nama Pemain 1 tidak boleh kosong');
          m.teams[key].p1 = v;
        }
        if (src.p2 !== undefined) {
          m.teams[key].p2 = isDbl ? String(src.p2).trim().slice(0, 80) : null;
        }
        if (src.club !== undefined) {
          m.teams[key].club = String(src.club).trim().slice(0, 80);
        }
      }
      changes.push('data pemain/club');
    }

    // Score, Sets, Set History, Winner & Status override (for live, unfinished, finished, WO / Disqualification)
    const st = m.live_state;
    const sm = m.session_management;
    if (patch.score && typeof patch.score === 'object') {
      const a = Math.max(0, Math.min(200, parseInt(patch.score.a, 10) || 0));
      const b = Math.max(0, Math.min(200, parseInt(patch.score.b, 10) || 0));
      st.score = { a, b };
      changes.push(`skor=${a}-${b}`);
    }
    if (patch.sets && typeof patch.sets === 'object') {
      const a = Math.max(0, Math.min(5, parseInt(patch.sets.a, 10) || 0));
      const b = Math.max(0, Math.min(5, parseInt(patch.sets.b, 10) || 0));
      st.sets = { a, b };
      changes.push(`sets=${a}-${b}`);
    }
    if (Array.isArray(patch.set_history)) {
      st.set_history = patch.set_history
        .map((s, idx) => {
          const a = Math.max(0, parseInt(s.a, 10) || 0);
          const b = Math.max(0, parseInt(s.b, 10) || 0);
          const w = s.winner === 'a' || s.winner === 'b' ? s.winner : a >= b ? 'a' : 'b';
          return { set: idx + 1, a, b, winner: w };
        });
      changes.push(`riwayat_set=[${st.set_history.map((s) => `${s.a}-${s.b}`).join(', ')}]`);
    }
    if (patch.winner !== undefined) {
      const w = patch.winner === 'a' || patch.winner === 'b' ? patch.winner : null;
      st.winner = w;
      changes.push(`pemenang=${w ? `Tim ${w.toUpperCase()}` : '-'}`);
    }
    if (patch.status !== undefined) {
      const newStatus = String(patch.status);
      if (!['scheduled', 'locked', 'in_progress', 'finished'].includes(newStatus)) {
        throw new StoreError('Status tidak valid');
      }
      sm.status = newStatus;
      if (newStatus === 'finished') {
        st.phase = 'finished';
        if (!st.started_at) st.started_at = nowIso();
        if (!st.ended_at) st.ended_at = nowIso();
        m.finished_at = nowIso();
        sm.active_controller_id = null;
        if (!st.winner) {
          if (m.rules.scoring_type === 'sets' && st.sets.a !== st.sets.b) {
            st.winner = st.sets.a > st.sets.b ? 'a' : 'b';
          } else {
            st.winner = st.score.a >= st.score.b ? 'a' : 'b';
          }
        }
        if (!st.set_history.length) {
          st.set_history = [{ set: 1, a: st.score.a, b: st.score.b, winner: st.winner }];
          if (m.rules.scoring_type === 'sets' && st.sets.a === 0 && st.sets.b === 0) {
            st.sets[st.winner] = 2;
          }
        }
      } else if (newStatus === 'scheduled') {
        st.phase = 'setup';
        st.winner = null;
        m.finished_at = null;
      } else if (newStatus === 'in_progress') {
        if (st.phase === 'finished' || st.phase === 'setup') st.phase = 'live';
        if (!st.started_at) st.started_at = nowIso();
        st.ended_at = null;
        st.winner = null;
        m.finished_at = null;
      }
      changes.push(`status=${newStatus}`);
    }
    if (patch.admin_note) {
      changes.push(`catatan="${String(patch.admin_note).trim().slice(0, 160)}"`);
    }

    if (!changes.length) throw new StoreError('Tidak ada perubahan');
    this._log(m, 'ADMIN_EDIT', `Koreksi admin: ${changes.join(', ')}`, 'admin');
    this._touch(m, prevCourt);
    if (sm.status === 'finished' && (prevStatus !== 'finished' || patch.re_export)) {
      this.emit('finished', m, this.getLogs(m.match_number));
    }
    return this.toPublic(m);
  }

  adminUnlock(matchNumber) {
    const m = this.mustGet(matchNumber);
    const dev = m.session_management.active_controller_id;
    if (!dev) throw new StoreError('Match tidak sedang dikunci');
    this._releaseLock(m, 'Kunci sesi dilepas paksa oleh Admin', 'admin');
    this.emit('kick', dev, m.match_number, `Admin melepas kunci sesi Match ${m.match_number}. Anda sekarang dalam mode pemantau.`);
    return this.toPublic(m);
  }

  adminReset(matchNumber) {
    const m = this.mustGet(matchNumber);
    const dev = m.session_management.active_controller_id;
    m.live_state = initialLiveState();
    m.session_management = { status: 'scheduled', active_controller_id: null, controller_label: null, last_heartbeat: null, locked_at: null };
    m.last_log_id = null;
    m.finished_at = null;
    m.export_status = null;
    this.undo[m.match_number] = [];
    this._log(m, 'RESET', 'Match direset oleh Admin', 'admin');
    this._touch(m);
    if (dev) this.emit('kick', dev, m.match_number, `Match ${m.match_number} direset oleh Admin.`);
    return this.toPublic(m);
  }

  adminReopen(matchNumber) {
    const m = this.mustGet(matchNumber);
    if (m.session_management.status !== 'finished') throw new StoreError('Match belum selesai');
    m.session_management.status = 'in_progress';
    m.finished_at = null;
    this._log(m, 'REOPEN', 'Match dibuka kembali oleh Admin untuk koreksi', 'admin');
    this._touch(m);
    return this.toPublic(m);
  }

  adminDelete(matchNumber) {
    const m = this.mustGet(matchNumber);
    const dev = m.session_management.active_controller_id;
    delete this.matches[m.match_number];
    delete this.undo[m.match_number];
    this.persist();
    this.emit('removed', m);
    if (dev) this.emit('kick', dev, m.match_number, `Match ${m.match_number} dihapus oleh Admin.`);
  }

  adminClearAll() {
    const all = Object.values(this.matches);
    this.matches = {};
    this.undo = {};
    this.persist();
    for (const m of all) this.emit('removed', m);
  }

  setExportStatus(matchNumber, status) {
    const m = this.get(matchNumber);
    if (!m) return;
    m.export_status = { ...status, at: nowIso() };
    this.persist();
    this.emit('change', m, m.court_number);
  }
}
