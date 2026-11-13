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
import { applyAction, courtPositions, DISCIPLINES, DOUBLES, EngineError, formatLocalDateTime, initialLiveState, parseScheduleDateValue, playerName, SCORING_METHODS, SCORING_TYPES } from '../engine.js';

const ACTIVE_STATUSES = ['locked', 'in_progress'];
const UNDO_LIMIT = 500;

const uuid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();
const tagOf = (id) => (id ? String(id).slice(-6) : null);

const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export const compareMatchNo = (a, b) => naturalCollator.compare(String(a || ''), String(b || ''));

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
      fs.mkdirSync(this.dataDir, { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ matches: this.matches, logs: this.logs, undo: this.undo }));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[store] gagal menyimpan database:', e.message);
    }
  }

  /**
   * Switch the active storage directory to another Tournament Profile.
   * Flushes current state first, then loads `matches`, `logs`, and `undo` from the new `dataDir`.
   */
  switchDataDir(newDataDir) {
    this.flush();
    this.dataDir = newDataDir;
    this.file = path.join(newDataDir, 'db.json');
    this.matches = {};
    this.logs = {};
    this.undo = {};
    this.load();
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
    return arr.sort(
      (x, y) =>
        x.court_number - y.court_number ||
        parseScheduleDateValue(x.scheduled_date) - parseScheduleDateValue(y.scheduled_date) ||
        parseTime(x.scheduled_time) - parseTime(y.scheduled_time) ||
        compareMatchNo(x.match_number, y.match_number)
    );
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
        setup_request: s.setup_request || null,
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
      admin_override: m.admin_override || null,
      sheet_diff: m.sheet_diff || null,
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
        .filter((m) => m.session_management.status === 'finished')
        .sort((x, y) => (y.finished_at || y.updated_at || '').localeCompare(x.finished_at || x.updated_at || ''))[0];
      if (fin && Date.now() - new Date(fin.finished_at || fin.updated_at || 0).getTime() < 30 * 60 * 1000) featured = fin;
    }

    const formatFinishedSets = (m) => {
      const st = m.live_state;
      const isSets = m.rules.scoring_type === 'sets';
      if (st.set_history?.length > 0) {
        return st.set_history.map((s) => ({
          a: s.a,
          b: s.b,
          winner: s.winner || (s.a >= s.b ? 'a' : 'b'),
        }));
      }
      const sa = isSets ? st.sets.a : st.score.a;
      const sb = isSets ? st.sets.b : st.score.b;
      return [{ a: sa, b: sb, winner: st.winner || (sa >= sb ? 'a' : 'b') }];
    };

    const previous = ms
      .filter((m) => m.session_management.status === 'finished' && (!featured || m.match_number !== featured.match_number))
      .sort((x, y) => (x.finished_at || x.updated_at || '').localeCompare(y.finished_at || y.updated_at || ''))
      .slice(-4)
      .map((m) => {
        const st = m.live_state;
        const winner = st.winner || (st.score.a >= st.score.b ? 'a' : 'b');
        const scoreSets = formatFinishedSets(m);
        return {
          match_number: m.match_number,
          scheduled_date: m.scheduled_date || '',
          scheduled_time: m.scheduled_time,
          category_name: m.category_name,
          discipline: m.discipline,
          team_a: [m.teams.team_a.p1, m.teams.team_a.p2].filter(Boolean).join(' / '),
          team_a_club: m.teams.team_a.club || '',
          team_a_details: m.teams.team_a.details ?? null,
          team_b: [m.teams.team_b.p1, m.teams.team_b.p2].filter(Boolean).join(' / '),
          team_b_club: m.teams.team_b.club || '',
          team_b_details: m.teams.team_b.details ?? null,
          winner,
          score_sets: scoreSets,
          score_text: scoreSets.map((s) => `${s.a}-${s.b}`).join(', '),
          finished_at: m.finished_at || m.updated_at || null,
        };
      });

    const upcoming = ms
      .filter((m) => ['scheduled', 'locked'].includes(m.session_management.status) && (!featured || m.match_number !== featured.match_number))
      .slice(0, 5)
      .map((m) => ({
        match_number: m.match_number,
        scheduled_date: m.scheduled_date || '',
        scheduled_time: m.scheduled_time,
        category_name: m.category_name,
        discipline: m.discipline,
        team_a: [m.teams.team_a.p1, m.teams.team_a.p2].filter(Boolean).join(' / '),
        team_a_club: m.teams.team_a.club || '',
        team_a_details: m.teams.team_a.details ?? null,
        team_b: [m.teams.team_b.p1, m.teams.team_b.p2].filter(Boolean).join(' / '),
        team_b_club: m.teams.team_b.club || '',
        team_b_details: m.teams.team_b.details ?? null,
      }));
    return { court: c, match: this.toPublic(featured), previous, upcoming };
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
      timestamp: formatLocalDateTime(new Date()),
      event_type,
      details,
      actor_id: actor_id || 'system',
      referee_name: m.session_management?.controller_label || '',
      shuttlecock_count: m.live_state?.shuttlecock_count ?? 0,
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
    const preservedEdits = [];
    for (const inc of list) {
      const existing = this.matches[inc.match_number];
      if (!existing) {
        this.matches[inc.match_number] = {
          ...inc,
          session_management: { status: 'scheduled', active_controller_id: null, controller_label: null, last_heartbeat: null, locked_at: null },
          live_state: initialLiveState(),
          last_log_id: null,
          admin_override: null,
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
        const isOverridden = Boolean(existing.admin_override?.is_edited);

        if (isOverridden) {
          // OPSI 2 (Best Practice): Match ini telah diedit dan dikunci oleh panitia!
          // Catat diff jika data di Google Sheet berbeda, namun JANGAN timpa editan panitia.
          const diff = {};
          if (inc.court_number !== existing.court_number) {
            diff.court_number = { sheet: inc.court_number, local: existing.court_number };
          }
          if (inc.scheduled_time !== existing.scheduled_time) {
            diff.scheduled_time = { sheet: inc.scheduled_time, local: existing.scheduled_time };
          }
          if (inc.scheduled_date !== existing.scheduled_date) {
            diff.scheduled_date = { sheet: inc.scheduled_date, local: existing.scheduled_date };
          }
          if (inc.category_name !== existing.category_name) {
            diff.category_name = { sheet: inc.category_name, local: existing.category_name };
          }
          existing.sheet_diff = Object.keys(diff).length ? diff : null;

          // Perbarui nama turnamen jika berubah, tetapi amankan jadwal dan data yang diedit panitia
          existing.tournament_name = inc.tournament_name;
          preservedEdits.push(inc.match_number);
          this._log(
            existing,
            'IMPORT_PRESERVED',
            `Editan panitia dipertahankan (kunci auto-sync aktif): Lap ${existing.court_number}, ${existing.scheduled_time || '-'}`,
            'admin'
          );
          updated += 1;
          this._touch(existing, prevCourt);
          continue;
        }

        // Jalur normal (match belum diedit panitia secara manual)
        existing.sheet_diff = null;
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
          if (inc.teams?.team_a?.details !== undefined && inc.teams.team_a.details !== null) {
            existing.teams.team_a.details = inc.teams.team_a.details;
          }
          if (inc.teams?.team_b?.details !== undefined && inc.teams.team_b.details !== null) {
            existing.teams.team_b.details = inc.teams.team_b.details;
          }
          skipped.push(inc.match_number);
        }
        this._log(existing, 'IMPORT_UPDATE', started ? 'Metadata jadwal diperbarui (aturan & pemain dikunci karena laga sudah dimulai)' : 'Data match diperbarui via import', 'admin');
        updated += 1;
        this._touch(existing, prevCourt);
      }
    }
    return { created, updated, locked_rules: skipped, preserved_edits: preservedEdits };
  }

  /**
   * Apply remote progress from Google Sheets (`Results` tab and/or `SmashPoint_State` tab)
   * so when a user opens the app on a different laptop/PC and pulls data, matches that have
   * already been played or are in progress are restored instead of restarting from scratch!
   */
  applyRemoteProgress({ results = [], states = [], logs = [] } = {}) {
    let restoredFromState = 0;
    let restoredFromResults = 0;

    // 1. Restore full match state snapshots from `SmashPoint_State` tab (highest fidelity: includes live score, rally_history, shuttlecock, referee)
    for (const item of states) {
      const mNo = String(item?.match_number || '').trim().toUpperCase();
      if (!mNo || !this.matches[mNo]) continue;
      const local = this.matches[mNo];
      const localStarted = local.session_management?.status !== 'scheduled' || local.live_state?.phase !== 'setup';
      const localTime = new Date(local.updated_at || 0).getTime();
      const remoteTime = new Date(item.updated_at || 0).getTime();

      let remoteMatch = null;
      try {
        remoteMatch = typeof item.match_json === 'string' ? JSON.parse(item.match_json) : item.match || null;
      } catch {
        remoteMatch = null;
      }
      if (!remoteMatch || !remoteMatch.live_state || !remoteMatch.session_management) continue;

      const remoteStatus = remoteMatch.session_management.status || item.status || 'scheduled';
      const remoteHasProgress =
        remoteStatus !== 'scheduled' ||
        remoteMatch.live_state.phase !== 'setup' ||
        Boolean(remoteMatch.admin_override?.is_edited);

      if (!remoteHasProgress) continue;

      // Apply remote snapshot if local match hasn't started yet, or if remote snapshot is newer / finished while local is not finished
      if (
        !localStarted ||
        (remoteStatus === 'finished' && local.session_management?.status !== 'finished') ||
        (remoteTime > localTime && local.session_management?.status !== 'in_progress')
      ) {
        const prevCourt = local.court_number;
        local.live_state = {
          ...initialLiveState(),
          ...remoteMatch.live_state,
        };
        local.session_management = {
          status: remoteStatus,
          // Clear active_controller_id when restoring on another laptop so it isn't stuck locked to old device
          active_controller_id: null,
          controller_label: remoteMatch.session_management.controller_label || local.session_management?.controller_label || null,
          last_heartbeat: remoteMatch.session_management.last_heartbeat || null,
          locked_at: remoteMatch.session_management.locked_at || null,
        };
        if (remoteMatch.finished_at) local.finished_at = remoteMatch.finished_at;
        if (remoteMatch.admin_override) local.admin_override = remoteMatch.admin_override;
        if (remoteMatch.court_number) local.court_number = remoteMatch.court_number;
        if (remoteMatch.scheduled_date !== undefined) local.scheduled_date = remoteMatch.scheduled_date;
        if (remoteMatch.scheduled_time !== undefined) local.scheduled_time = remoteMatch.scheduled_time;
        if (remoteMatch.teams) local.teams = remoteMatch.teams;
        if (remoteMatch.rules) local.rules = remoteMatch.rules;
        restoredFromState += 1;
        this._touch(local, prevCourt);
      }
    }

    // 2. Restore finished matches from `Results` tab (works even on existing spreadsheets without `SmashPoint_State` tab!)
    for (const r of results) {
      const mNo = String(r?.match_number || r?.no_partai || '').trim().toUpperCase();
      if (!mNo || !this.matches[mNo]) continue;
      const local = this.matches[mNo];
      if (local.session_management?.status === 'finished' || local.session_management?.status === 'in_progress') {
        continue;
      }
      const winnerRaw = String(r.winner || '').trim().toLowerCase();
      const setScoresRaw = String(r.set_scores || '').trim();
      if (!winnerRaw && !setScoresRaw) continue;

      const parsedSets = [];
      if (setScoresRaw) {
        const parts = setScoresRaw.split(/\s*\|\s*|\s*,\s*/).filter(Boolean);
        parts.forEach((pt, idx) => {
          const [saStr, sbStr] = pt.split('-');
          const sa = parseInt(saStr, 10);
          const sb = parseInt(sbStr, 10);
          if (Number.isFinite(sa) && Number.isFinite(sb)) {
            parsedSets.push({
              set: idx + 1,
              a: sa,
              b: sb,
              winner: sa >= sb ? 'a' : 'b',
            });
          }
        });
      }

      const winner = winnerRaw === 'a' || winnerRaw === 'b'
        ? winnerRaw
        : parsedSets.length
        ? parsedSets[parsedSets.length - 1].winner
        : 'a';

      const setsA = Number.isFinite(parseInt(r.sets_a, 10))
        ? parseInt(r.sets_a, 10)
        : parsedSets.filter((s) => s.winner === 'a').length;
      const setsB = Number.isFinite(parseInt(r.sets_b, 10))
        ? parseInt(r.sets_b, 10)
        : parsedSets.filter((s) => s.winner === 'b').length;
      const lastSet = parsedSets[parsedSets.length - 1] || { a: setsA, b: setsB, winner };
      const cockCount = Math.max(0, parseInt(r.shuttlecock_count, 10) || 0);
      const refName = String(r.referee_name || '').trim() || null;

      local.session_management = {
        status: 'finished',
        active_controller_id: null,
        controller_label: refName,
        last_heartbeat: null,
        locked_at: null,
      };
      local.live_state = {
        ...local.live_state,
        phase: 'finished',
        current_set: Math.max(1, parsedSets.length),
        score: { a: lastSet.a, b: lastSet.b },
        sets: { a: setsA, b: setsB },
        set_history: parsedSets.length ? parsedSets : [{ set: 1, a: lastSet.a, b: lastSet.b, winner }],
        winner,
        shuttlecock_count: cockCount,
        started_at: r.started_at || local.live_state.started_at || nowIso(),
        ended_at: r.finished_at || local.live_state.ended_at || nowIso(),
      };
      local.finished_at = r.finished_at || nowIso();
      this._log(local, 'CLOUD_RESTORE', `Progres pertandingan selesai dipulihkan dari Google Sheets Results (${setScoresRaw || `${lastSet.a}-${lastSet.b}`})`, 'system');
      restoredFromResults += 1;
      this._touch(local);
    }

    // 3. Restore logs if provided and local logs are empty for that match
    if (Array.isArray(logs) && logs.length > 0) {
      const byMatch = {};
      for (const l of logs) {
        const mNo = String(l?.match_number || '').trim().toUpperCase();
        if (!mNo) continue;
        (byMatch[mNo] ||= []).push(l);
      }
      for (const [mNo, mLogs] of Object.entries(byMatch)) {
        if (!this.logs[mNo] || this.logs[mNo].length <= 1) {
          this.logs[mNo] = mLogs;
        }
      }
      this.persist();
    }

    return { restored_from_state: restoredFromState, restored_from_results: restoredFromResults };
  }

  /**
   * Export full portable tournament state bundle (matches, logs, undo) for cross-laptop backup/restore.
   */
  exportStateBundle(extraMeta = {}) {
    this.flush();
    return {
      app: 'SmashPoint',
      schema_version: 2,
      exported_at: nowIso(),
      ...extraMeta,
      matches: this.matches,
      logs: this.logs,
      undo: this.undo,
    };
  }

  /**
   * Import/restore full tournament state bundle onto this laptop/server.
   */
  importStateBundle(bundle, { merge = false } = {}) {
    if (!bundle || typeof bundle !== 'object' || typeof bundle.matches !== 'object') {
      throw new StoreError('File backup/state turnamen tidak valid (data matches tidak ditemukan).', 'bad_backup', 400);
    }
    if (!merge) {
      this.matches = bundle.matches || {};
      this.logs = bundle.logs || {};
      this.undo = bundle.undo || {};
    } else {
      for (const [k, m] of Object.entries(bundle.matches || {})) {
        this.matches[k] = m;
      }
      for (const [k, l] of Object.entries(bundle.logs || {})) {
        this.logs[k] = l;
      }
      for (const [k, u] of Object.entries(bundle.undo || {})) {
        this.undo[k] = u;
      }
    }
    // Release any active device locks from the previous laptop so referees can immediately lock if needed
    for (const m of Object.values(this.matches)) {
      if (m.session_management) {
        m.session_management.active_controller_id = null;
      }
    }
    this.flush();
    for (const m of Object.values(this.matches)) {
      this.emit('change', m, m.court_number);
    }
    return {
      restored_matches: Object.keys(bundle.matches || {}).length,
      total_matches: Object.keys(this.matches).length,
    };
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
    const cleanLabel = String(label || s.controller_label || '').trim();
    if (!cleanLabel) {
      throw new StoreError('Identitas Nama Wasit wajib diisi sebelum memulai setup pertandingan', 'missing_referee_name', 400);
    }
    s.active_controller_id = deviceId;
    s.controller_label = cleanLabel;
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
    if (s.status === 'locked' && m.live_state.phase === 'setup' && m.live_state.current_set === 1 && !m.last_log_id) {
      s.status = 'scheduled';
      s.controller_label = null;
    }
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
      const curCockCount = m.live_state?.shuttlecock_count ?? 0;
      m.live_state = top.snapshot.live_state;
      m.live_state.shuttlecock_count = curCockCount; // Preserve shuttlecock usage count across score undo
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
    } else if (type === 'SHUTTLECOCK') {
      // Shuttlecock has dedicated +/- controls; do not push onto score UNDO stack
      this._touch(m, prevCourt);
    } else {
      const stack = (this.undo[m.match_number] ||= []);
      stack.push({ log_id: entry.log_id, event_type: entry.event_type, snapshot });
      if (stack.length > UNDO_LIMIT) stack.shift();
      this._touch(m, prevCourt);
    }
    return { ok: true, log: entry, match: this.toPublic(m) };
  }

  // ---------------------------------------------------------------- admin
  adminUpdate(matchNumber, patch, userLabel = 'admin') {
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
        if (src.details !== undefined) {
          const dv = src.details;
          if (dv === null || dv === '') m.teams[key].details = null;
          else if (typeof dv === 'object') m.teams[key].details = dv;
          else {
            const s = String(dv).trim().slice(0, 120);
            if (!s) m.teams[key].details = null;
            else if (s.startsWith('{') || s.startsWith('[')) {
              try {
                m.teams[key].details = JSON.parse(s);
              } catch {
                m.teams[key].details = s;
              }
            } else m.teams[key].details = s;
          }
        }
      }
      changes.push('data pemain/club/seeded');
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
    if (patch.show_rally_history !== undefined) {
      st.show_rally_history = Boolean(patch.show_rally_history);
      changes.push(`tampilan_histori_obs=${st.show_rally_history ? 'ON' : 'OFF'}`);
    }
    if (patch.shuttlecock_count !== undefined && patch.shuttlecock_count !== null) {
      const sc = Math.max(0, Math.min(999, parseInt(patch.shuttlecock_count, 10) || 0));
      if ((st.shuttlecock_count || 0) !== sc) {
        st.shuttlecock_count = sc;
        changes.push(`shuttlecock=${sc}`);
      }
    }
    if (patch.referee_name !== undefined) {
      const rn = String(patch.referee_name || '').trim().slice(0, 60);
      if ((sm.controller_label || '') !== rn) {
        sm.controller_label = rn || null;
        changes.push(`wasit=${rn || '-'}`);
      }
    }
    if (patch.admin_note) {
      changes.push(`catatan="${String(patch.admin_note).trim().slice(0, 160)}"`);
    }

    if (!changes.length) throw new StoreError('Tidak ada perubahan');

    // Penanganan Kunci Edit Panitia (Opsi 2):
    if (patch.unlock_admin_override) {
      m.admin_override = null;
      delete m.sheet_diff;
      changes.push('kunci_auto_sync=dilepas (mengikuti sheet)');
    } else if (patch.lock_admin_override !== false) {
      m.admin_override = {
        is_edited: true,
        edited_at: nowIso(),
        edited_by: patch.edited_by || userLabel || 'admin',
        note: patch.admin_note || 'Diedit panitia via admin',
      };
      delete m.sheet_diff;
      changes.push('kunci_auto_sync=aktif (dilindungi dari penimpaan sheet)');
    }

    this._log(m, 'ADMIN_EDIT', `Koreksi admin: ${changes.join(', ')}`, userLabel || 'admin');
    if (m.session_management.setup_request) {
      m.session_management.setup_request = null;
    }
    this._touch(m, prevCourt);
    if (sm.status === 'finished' && (prevStatus !== 'finished' || patch.re_export)) {
      this.emit('finished', m, this.getLogs(m.match_number));
    }
    return this.toPublic(m);
  }

  /**
   * Referee sends a Setup / Assistance request to Admin for a match/court.
   */
  requestSetup(matchNumber, { by, note } = {}) {
    const m = this.mustGet(matchNumber);
    const requester = String(by || m.session_management.controller_label || 'Wasit').trim().slice(0, 60);
    const cleanNote = String(note || 'Mohon bantuan setup / koreksi dari Admin').trim().slice(0, 140);
    m.session_management.setup_request = {
      requested_at: nowIso(),
      by: requester,
      note: cleanNote,
    };
    this._log(m, 'SETUP_REQUEST', `Wasit (${requester}) meminta bantuan setup/koreksi Admin: ${cleanNote}`, requester);
    this._touch(m);
    return this.toPublic(m);
  }

  /**
   * Clear an active setup request on a match (either by referee cancelling or admin resolving).
   */
  clearSetupRequest(matchNumber, actor = 'admin') {
    const m = this.mustGet(matchNumber);
    if (m.session_management.setup_request) {
      m.session_management.setup_request = null;
      this._log(m, 'SETUP_REQUEST_CLEARED', 'Permintaan bantuan setup diselesaikan/dibatalkan', actor);
      this._touch(m);
    }
    return this.toPublic(m);
  }

  /**
   * Admin remotely applies an engine action (e.g. SETUP_START, OVERRIDE, SWITCH_SIDE, CONFIRM_INTERVAL, NEXT_SET, UNDO)
   * on behalf of or alongside the referee, broadcasting live to the referee tablet and display screens.
   */
  adminRemoteAction(matchNumber, { type, payload = {} }, adminLabel = 'admin') {
    const m = this.mustGet(matchNumber);
    const prevCourt = m.court_number;
    const prevStatus = m.session_management.status;
    if (type === 'UNDO') {
      const stack = this.undo[m.match_number] || [];
      if (!stack.length) throw new StoreError('Tidak ada aksi yang dapat di-undo');
      const snap = stack.pop();
      m.live_state = snap.live_state;
      m.teams = snap.teams;
      m.court_number = snap.court_number;
      m.session_management.status = snap.status;
      m.finished_at = snap.finished_at;
      m.session_management.setup_request = null;
      this._log(m, 'ADMIN_REMOTE_UNDO', `Admin (${adminLabel}) melakukan UNDO pada aksi terakhir`, adminLabel);
      this._touch(m, prevCourt);
      return { ok: true, match: this.toPublic(m) };
    }

    const res = applyAction(m, { type, payload });
    if (type !== 'SHUTTLECOCK' && type !== 'CONFIRM_FINISH') {
      this.undo[m.match_number] = this.undo[m.match_number] || [];
      this.undo[m.match_number].push({
        live_state: JSON.parse(JSON.stringify(m.live_state)),
        teams: JSON.parse(JSON.stringify(m.teams)),
        court_number: m.court_number,
        status: m.session_management.status,
        finished_at: m.finished_at,
      });
      if (this.undo[m.match_number].length > 50) this.undo[m.match_number].shift();
    }

    m.live_state = res.live_state;
    m.teams = res.teams;
    m.court_number = res.court_number;
    if (res.live_state.phase === 'live' || res.live_state.phase === 'interval' || res.live_state.phase === 'set_break') {
      m.session_management.status = 'in_progress';
    } else if (res.live_state.phase === 'finished' && (type === 'CONFIRM_FINISH' || (type === 'RETIRE' && payload?.auto_confirm))) {
      m.session_management.status = 'finished';
      if (!m.finished_at) m.finished_at = nowIso();
    } else if (res.live_state.phase === 'finished') {
      m.session_management.status = 'in_progress';
    }
    m.session_management.setup_request = null;
    this._log(m, `ADMIN_REMOTE_${res.event_type}`, `[Remote Admin: ${adminLabel}] ${res.details}`, adminLabel);
    this._touch(m, prevCourt);
    if (m.session_management.status === 'finished' && prevStatus !== 'finished') {
      this.emit('finished', m, this.getLogs(m.match_number));
    }
    return { ok: true, match: this.toPublic(m) };
  }

  adminResetOverride(matchNumber) {
    const m = this.mustGet(matchNumber);
    m.admin_override = null;
    delete m.sheet_diff;
    this._log(m, 'ADMIN_OVERRIDE_RESET', 'Kunci auto-sync dilepas, match akan kembali mengikuti Google Sheet', 'admin');
    this._touch(m);
    return this.toPublic(m);
  }

  toggleOverlayHistory(matchNumber, forceState = null) {
    const m = this.mustGet(matchNumber);
    const cur = Boolean(m.live_state.show_rally_history);
    m.live_state.show_rally_history = forceState !== null ? Boolean(forceState) : !cur;
    this._log(
      m,
      'OVERLAY_HISTORY_TOGGLE',
      `Tampilan histori reli OBS diubah: ${m.live_state.show_rally_history ? 'ON (TAMPIL)' : 'OFF (SEMBUNYI)'}`,
      'admin'
    );
    this._touch(m);
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
