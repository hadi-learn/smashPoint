/**
 * SmashPoint Scoring Engine (pure state machine).
 *
 * Shared by the server (authoritative) and the client (for rendering helpers).
 * Never mutates the input match; always returns new objects.
 *
 * Conventions
 * - Teams are 'a' and 'b'. Player ids: 'a1','a2','b1','b2'.
 * - Team positions are stored team-relative: { even: pid, odd: pid }
 *   even = right service court, odd = left service court (from the player's view).
 * - Screen mapping (top-down view, net vertical in the middle):
 *     team on the LEFT  faces right -> right service court (even) = BOTTOM
 *     team on the RIGHT faces left  -> right service court (even) = TOP
 */

export const DISCIPLINES = ['MS', 'WS', 'MD', 'WD', 'XD'];
export const DOUBLES = ['MD', 'WD', 'XD'];
export const SCORING_METHODS = ['rally_point', 'side_out'];
export const SCORING_TYPES = ['sets', 'continuous'];

export const DISCIPLINE_LABEL = {
  MS: 'Tunggal Putra',
  WS: 'Tunggal Putri',
  MD: 'Ganda Putra',
  WD: 'Ganda Putri',
  XD: 'Ganda Campuran',
};

export class EngineError extends Error {
  constructor(message, code = 'invalid_action') {
    super(message);
    this.code = code;
  }
}

export const other = (t) => (t === 'a' ? 'b' : 'a');
export const courtFor = (n) => (n % 2 === 0 ? 'even' : 'odd');
export const isDoubles = (m) => DOUBLES.includes(typeof m === 'string' ? m : m?.discipline);
const clone = (o) => JSON.parse(JSON.stringify(o));

export function teamObj(match, t) {
  return match.teams[t === 'a' ? 'team_a' : 'team_b'];
}

export function playerName(match, pid) {
  if (!pid || !match) return '';
  const tm = teamObj(match, pid[0]);
  if (!tm) return '';
  return (pid[1] === '1' ? tm.p1 : tm.p2) || '';
}

export function teamLabel(match, t) {
  const tm = teamObj(match, t);
  if (!tm) return '';
  return [tm.p1, isDoubles(match) ? tm.p2 : null].filter(Boolean).join(' / ');
}

/**
 * Extract / format Seeded or extra team details (`teams.team_a.details` / `teams.team_b.details`)
 * for display across Admin, Referee, Arena TV, and OBS Overlay.
 *
 * Examples:
 *  - `"1"` or `1` -> `"SEED #1"`
 *  - `"[3/4]"` -> `"SEED [3/4]"`
 *  - `"Seed 2"` / `"Unggulan 1"` -> `"SEED 2"` / `"UNGGULAN 1"`
 *  - `{ seed: 1 }` -> `"SEED #1"`
 *  - `{ seed: 2, age: 55 }` -> `"SEED #2 · age: 55"`
 *  - `"Non-Seed"` -> `"Non-Seed"`
 */
export function teamSeedText(details) {
  if (details === undefined || details === null || details === '') return null;
  if (typeof details === 'number') return `SEED #${details}`;
  if (typeof details === 'string') {
    const s = details.trim();
    if (!s || ['null', '-', 'none', 'n/a', '0', 'false'].includes(s.toLowerCase())) return null;
    if (/^\d+$/.test(s)) return `SEED #${s}`;
    if (/^#\d+$/.test(s)) return `SEED ${s}`;
    if (/^\[\d+(?:[/-]\d+)?\]$/.test(s)) return `SEED ${s}`;
    if (/^\d+\/\d+$/.test(s)) return `SEED [${s}]`;
    return s;
  }
  if (typeof details === 'object') {
    const parts = [];
    const seedVal = details.seed ?? details.seeded ?? details.unggulan;
    if (seedVal !== undefined && seedVal !== null && String(seedVal).trim() !== '') {
      const sv = String(seedVal).trim();
      parts.push(/^\d+$/.test(sv) ? `SEED #${sv}` : `SEED ${sv}`);
    }
    for (const [k, v] of Object.entries(details)) {
      if (['seed', 'seeded', 'unggulan'].includes(k.toLowerCase())) continue;
      if (v === undefined || v === null || v === '') continue;
      parts.push(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
    }
    return parts.length ? parts.join(' · ') : null;
  }
  return null;
}

/** Short seed tag (e.g. `[1]` or `[Seed 2]`) for compact inline rows. */
export function teamSeedBadge(matchOrDetails, t) {
  const details =
    t && matchOrDetails?.teams
      ? matchOrDetails.teams[t === 'a' ? 'team_a' : 'team_b']?.details
      : matchOrDetails;
  return teamSeedText(details);
}

/** Editable string representation of team.details for forms. */
export function detailsToInput(details) {
  if (details === undefined || details === null) return '';
  if (typeof details === 'string' || typeof details === 'number') return String(details);
  try {
    return JSON.stringify(details);
  } catch {
    return '';
  }
}

export function validPlayerIds(match) {
  return isDoubles(match) ? ['a1', 'a2', 'b1', 'b2'] : ['a1', 'b1'];
}

const MONTH_MAP = {
  januari: 1, jan: 1, january: 1,
  februari: 2, pebruari: 2, feb: 2, february: 2,
  maret: 3, mar: 3, march: 3,
  april: 4, apr: 4,
  mei: 5, may: 5,
  juni: 6, jun: 6, june: 6,
  juli: 7, jul: 7, july: 7,
  agustus: 8, agu: 8, ags: 8, agt: 8, aug: 8, august: 8,
  september: 9, sep: 9, sept: 9,
  oktober: 10, okt: 10, oct: 10, october: 10,
  november: 11, nopember: 11, nov: 11, nop: 11,
  desember: 12, des: 12, dec: 12, december: 12,
};

/**
 * Parse any Indonesian or standard date string into a numeric YYYYMMDD sort key.
 * Handles:
 *  - "Sabtu / 7 November 2026", "Minggu, 8 Nov 2026", "Kamis - 12 November 2026"
 *  - "2026-11-07", "2026/11/07"
 *  - "07/11/2026", "7-11-2026"
 * Returns 99999999 for empty/unparseable strings so empty dates sort last in Ascending.
 */
export function parseScheduleDateValue(raw) {
  const s = String(raw || '').trim();
  if (!s) return 99999999;

  // 1. ISO format: YYYY-MM-DD or YYYY/MM/DD
  const iso = s.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (iso) {
    const y = parseInt(iso[1], 10);
    const m = parseInt(iso[2], 10);
    const d = parseInt(iso[3], 10);
    return y * 10000 + m * 100 + d;
  }

  // 2. Indonesian / English text with month name: e.g. "Sabtu / 7 November 2026" or "12 Nov 2026"
  const named = s.toLowerCase().match(/(\d{1,2})\s+([a-z]+)(?:\s+(\d{2,4}))?/);
  if (named) {
    const d = parseInt(named[1], 10);
    const mon = MONTH_MAP[named[2]];
    if (mon && d >= 1 && d <= 31) {
      let y = named[3] ? parseInt(named[3], 10) : new Date().getFullYear();
      if (y < 100) y += 2000;
      return y * 10000 + mon * 100 + d;
    }
  }

  // 3. DD/MM/YYYY or DD-MM-YYYY
  const dmy = s.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (dmy) {
    const d = parseInt(dmy[1], 10);
    const m = parseInt(dmy[2], 10);
    let y = parseInt(dmy[3], 10);
    if (y < 100) y += 2000;
    return y * 10000 + m * 100 + d;
  }

  return 99999999;
}

const ID_DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const ID_MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

/**
 * Format a numeric date (YYYY-MM-DD or DD/MM/YYYY) into "Hari / D Bulan YYYY"
 * if it doesn't already contain a day/month name. If the input already has text
 * like "Sabtu / 7 November 2026", returns it as-is.
 */
export function formatScheduleDateDisplay(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/[a-zA-Z]{3,}/.test(s)) return s; // Already formatted with day/month text
  const val = parseScheduleDateValue(s);
  if (val === 99999999) return s;
  const y = Math.floor(val / 10000);
  const m = Math.floor((val % 10000) / 100);
  const d = val % 100;
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime()) || dt.getMonth() !== m - 1) return s;
  return `${ID_DAYS[dt.getDay()]} / ${d} ${ID_MONTHS[m - 1]} ${y}`;
}

/**
 * Convert any date string (e.g. "Sabtu / 7 November 2026", "07/11/2026")
 * into standard HTML date picker format: "YYYY-MM-DD".
 */
export function parseScheduleDateToIso(raw) {
  const val = parseScheduleDateValue(raw);
  if (val === 99999999) return '';
  const y = Math.floor(val / 10000);
  const m = Math.floor((val % 10000) / 100);
  const d = val % 100;
  if (y < 1970 || m < 1 || m > 12 || d < 1 || d > 31) return '';
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Convert standard ISO date "YYYY-MM-DD" into Indonesian textual format: "Hari / D Bulan YYYY"
 */
export function formatIsoToIndonesianDate(isoStr) {
  const s = String(isoStr || '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s;
  const y = parseInt(m[1], 10);
  const mon = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  const dt = new Date(y, mon - 1, d);
  if (Number.isNaN(dt.getTime())) return s;
  return `${ID_DAYS[dt.getDay()]} / ${d} ${ID_MONTHS[mon - 1]} ${y}`;
}

/**
 * Extract HH:mm for HTML time picker from string like "14:30 WIB" or "14:30"
 */
export function parseScheduleTimeToPicker(raw) {
  const m = String(raw || '').match(/(\d{1,2})[:.](\d{2})/);
  if (!m) return '';
  const hh = String(parseInt(m[1], 10)).padStart(2, '0');
  const mm = m[2];
  return `${hh}:${mm}`;
}

/**
 * Format HH:mm from HTML time picker to display string with optional WIB
 */
export function formatPickerToScheduleTime(pickerVal, withWib = true) {
  const s = String(pickerVal || '').trim();
  if (!s) return '';
  return withWib ? `${s} WIB` : s;
}

/**
 * Compute match duration in seconds from started_at to ended_at/finished_at (or current `now` ms).
 * Returns null if match has not started yet.
 */
export function matchDurationSec(match, now = Date.now()) {
  const st = match?.live_state;
  if (!st?.started_at) return null;
  const startMs = new Date(st.started_at).getTime();
  if (!Number.isFinite(startMs)) return null;
  const endIso = st.ended_at || match?.finished_at || null;
  const endMs = endIso ? new Date(endIso).getTime() : now;
  return Math.max(0, Math.floor(((Number.isFinite(endMs) ? endMs : now) - startMs) / 1000));
}

/** Format duration seconds as MM:SS or H:MM:SS (e.g. "14:05" or "1:04:22"). */
export function formatDuration(sec) {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return null;
  const s = Math.max(0, Math.floor(sec));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  const mm = String(mins).padStart(2, '0');
  const ss = String(rem).padStart(2, '0');
  return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Convenience helper: formatted duration string for a match at timestamp `now`. */
export function matchDurationText(match, now = Date.now()) {
  return formatDuration(matchDurationSec(match, now));
}

/**
 * Format an ISO timestamp (or Date/number) into computer's standard local date & time:
 * "YYYY-MM-DD HH:mm:ss" (e.g. "2026-11-08 14:35:09").
 * Returns empty string if input is empty or invalid.
 */
export function formatLocalDateTime(isoOrDate) {
  if (!isoOrDate) return '';
  const dt = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(dt.getTime())) return String(isoOrDate);
  const pad = (n) => String(n).padStart(2, '0');
  const y = dt.getFullYear();
  const m = pad(dt.getMonth() + 1);
  const d = pad(dt.getDate());
  const hh = pad(dt.getHours());
  const mm = pad(dt.getMinutes());
  const ss = pad(dt.getSeconds());
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

/**
 * Break / Interval Duration Rules:
 *  - Sets mode mid-game interval (when leading score reaches 11 in 21-pt): 60 seconds (1:00).
 *  - Continuous mode mid-game interval (with change of ends): 120 seconds (2:00).
 *  - Between 1st & 2nd game, and between 2nd & 3rd game (set break + change of ends): 120 seconds (2:00).
 */
export const BWF_INTERVAL_SECONDS = 60;
export const BWF_CONTINUOUS_INTERVAL_SECONDS = 120;
export const BWF_SET_BREAK_SECONDS = 120;

/**
 * Official BWF Laws of Badminton (Clause 16.6 & 16.7) & PBSI Misconduct Card Reasons.
 */
export const BWF_CARD_REASONS = [
  'Memperlambat / Menunda Permainan (BWF Law 16.4 - Delay of Play)',
  'Perilaku Tidak Sportif / Membanting Raket (BWF Law 16.6.4 - Misconduct)',
  'Mengubah / Merusak Bentuk Shuttlecock (BWF Law 16.5.2)',
  'Pelanggaran Instruksi Pelatih / Coaching Saat Reli (BWF Law 16.5.1)',
  'Meninggalkan Lapangan Tanpa Izin Wasit (BWF Law 16.4.2)',
  'Ucapan Kasar / Menghina Wasit atau Lawan (BWF Law 16.6.3)',
  'Pelanggaran Regulasi Lainnya (Keputusan Wasit / Referee)',
];

/**
 * Official BWF / PBSI Card Type Definitions & Consequences.
 */
export const BWF_CARD_TYPES = {
  yellow: {
    code: 'yellow',
    label: 'Kartu Kuning (Peringatan)',
    shortLabel: 'Kuning',
    law: 'BWF Law 16.7.1.1 — Warning for Misconduct',
    consequence: 'Peringatan resmi pertama kepada pemain/pasangan. Dicatat pada lembar skor & log pertandingan tanpa mengubah skor maupun hak servis.',
    icon: '🟨',
  },
  red: {
    code: 'red',
    label: 'Kartu Merah (Fault / Poin Lawan)',
    shortLabel: 'Merah',
    law: 'BWF Law 16.7.1.2 — Fault for Misconduct',
    consequence: 'Pelanggaran berulang setelah Kartu Kuning atau pelanggaran berat. Dihitung sebagai FAULT: pada mode Rally Point lawan otomatis mendapat +1 Poin & hak servis; pada mode Side-Out terjadi Pindah Servis / +1 Poin untuk lawan.',
    icon: '🟥',
  },
  black: {
    code: 'black',
    label: 'Kartu Hitam (Diskualifikasi)',
    shortLabel: 'Hitam (DSQ)',
    law: 'BWF Law 16.7.2 — Disqualification by Referee',
    consequence: 'Pelanggaran sangat berat atas keputusan Referee. Pemain/pasangan didiskualifikasi dan pertandingan langsung dimenangkan oleh pihak lawan.',
    icon: '⬛',
  },
};

export const BWF_RETIRE_REASONS = [
  'Cedera / Masalah Medis Saat Bertanding (Retired / RET)',
  'Sakit / Kram / Kelelahan Fisik (Retired / RET)',
  'Pasangan / Tim Mengundurkan Diri (Retired / RET)',
  'Walkover (WO) — Pemain / Pasangan Tidak Hadir di Lapangan',
  'Keputusan Medis / Referee Turnamen',
];

/**
 * Compute BWF break countdown info for `interval` or `set_break` phase.
 * Returns null if not in a timed break phase, or:
 * `{ targetSec, elapsedSec, remainingSec, isOvertime, ruleLabel, callWarning }`
 */
export function breakCountdownInfo(match, now = Date.now()) {
  const st = match?.live_state;
  if (!st || (st.phase !== 'interval' && st.phase !== 'set_break')) return null;
  const isContinuous = match?.rules?.scoring_type === 'continuous';
  const targetSec =
    st.phase === 'set_break'
      ? BWF_SET_BREAK_SECONDS
      : isContinuous
      ? BWF_CONTINUOUS_INTERVAL_SECONDS
      : BWF_INTERVAL_SECONDS;
  const startIso = st.break_started_at || match?.updated_at || null;
  const startMs = startIso ? new Date(startIso).getTime() : now;
  const elapsedSec = Math.max(0, Math.floor(((Number.isFinite(startMs) ? now - startMs : 0)) / 1000));
  const remainingSec = Math.max(0, targetSec - elapsedSec);
  const overtimeSec = Math.max(0, elapsedSec - targetSec);
  const isOvertime = elapsedSec >= targetSec;
  // BWF Umpire standard call at 20 seconds remaining ("Court X, 20 seconds!")
  const callWarning = remainingSec > 0 && remainingSec <= 20;
  const ruleLabel =
    st.phase === 'set_break'
      ? 'BWF Rule 16.2.2 · Jeda Antar Set & Pindah Lapangan (120 Detik / 2 Menit)'
      : isContinuous
      ? 'Interval Tengah Laga Continuous · Pindah Lapangan (120 Detik / 2 Menit)'
      : 'BWF Rule 16.2.1 · Interval Tengah Gim (60 Detik / 1 Menit)';
  return {
    targetSec,
    elapsedSec,
    remainingSec,
    overtimeSec,
    isOvertime,
    callWarning,
    formatted: formatDuration(remainingSec) || '00:00',
    overtimeFormatted: overtimeSec > 0 ? `+${formatDuration(overtimeSec)}` : null,
    ruleLabel,
  };
}

export function initialLiveState() {
  return {
    phase: 'setup', // setup | live | interval | set_break | finished
    current_set: 1,
    score: { a: 0, b: 0 },
    sets: { a: 0, b: 0 },
    set_history: [],
    rally_history: [], // recent rally/serve tracking (PRD BWF overlay & livescore)
    show_rally_history: false, // controlled by operator / panitia on-demand for YouTube overlay
    shuttlecock_count: 0, // total shuttlecocks used during match, controlled by referee
    cards: [], // BWF Law 16 penalty cards issued during the match (yellow, red, black)
    sides: { left: 'a', right: 'b' },
    positions: { a: { even: 'a1', odd: 'a2' }, b: { even: 'b1', odd: 'b2' } },
    service_status: { side: null, turn: 1, player_id: null, receiver_id: null },
    interval_done: false,
    interval_swap: false,
    break_started_at: null,
    game_winner: null,
    winner: null,
    started_at: null,
    ended_at: null,
  };
}

/** Screen positions of players -> { left_top, left_bottom, right_top, right_bottom } (player ids or null). */
export function courtPositions(match, st = match.live_state) {
  const res = { left_top: null, left_bottom: null, right_top: null, right_bottom: null };
  const dbl = isDoubles(match);
  for (const screen of ['left', 'right']) {
    const t = st.sides[screen];
    let even;
    let odd;
    if (dbl) {
      even = st.positions?.[t]?.even ?? null;
      odd = st.positions?.[t]?.odd ?? null;
    } else {
      // Singles: both players stand in the court matching the server's score parity.
      const srv = st.service_status?.side || 'a';
      const parity = courtFor(st.score[srv] || 0);
      even = parity === 'even' ? `${t}1` : null;
      odd = parity === 'odd' ? `${t}1` : null;
    }
    if (screen === 'left') {
      res.left_top = odd;
      res.left_bottom = even;
    } else {
      res.right_top = even;
      res.right_bottom = odd;
    }
  }
  return res;
}

function keyOf(pos, pid) {
  if (!pos) return null;
  if (pos.even === pid) return 'even';
  if (pos.odd === pid) return 'odd';
  return null;
}

/** Receiver = opponent standing diagonally (same service court name). */
export function receiverFor(match, st, srvTeam, serverId) {
  const opp = other(srvTeam);
  if (!isDoubles(match)) return `${opp}1`;
  const court = keyOf(st.positions[srvTeam], serverId) || courtFor(st.score[srvTeam]);
  return st.positions[opp][court];
}

export function gameWinner(match, score) {
  const { win_point, scoring_type, max_point } = match.rules;
  const { a, b } = score;
  if (scoring_type === 'continuous') {
    if (a >= win_point) return 'a';
    if (b >= win_point) return 'b';
    return null;
  }
  const cap = max_point && max_point >= win_point ? max_point : win_point + 9;
  if ((a >= win_point && a - b >= 2) || a >= cap) return 'a';
  if ((b >= win_point && b - a >= 2) || b >= cap) return 'b';
  return null;
}

const T = (t) => (t === 'a' ? 'A' : 'B');
const turnLabel = (turn) => (turn === 2 ? '2nd' : '1st');

export function describeState(match, st) {
  const ss = st.service_status;
  const parts = [`Poin: ${st.score.a}-${st.score.b}`];
  if (match.rules.scoring_type === 'sets') parts.push(`Set: ${st.sets.a}-${st.sets.b}`);
  if (ss.side) {
    const turn = match.rules.scoring_method === 'side_out' && isDoubles(match) ? ` (${turnLabel(ss.turn)})` : '';
    parts.push(`Servis: Tim ${T(ss.side)}${turn} - ${playerName(match, ss.player_id)}`);
  }
  return parts.join('. ');
}

function validatePositions(match, positions) {
  const out = {};
  for (const t of ['a', 'b']) {
    const p = positions?.[t];
    const set = [p?.even, p?.odd].sort().join(',');
    if (set !== `${t}1,${t}2`) throw new EngineError(`Posisi pemain Tim ${T(t)} tidak valid`);
    out[t] = { even: p.even, odd: p.odd };
  }
  return out;
}

function afterPoint(match, st) {
  const gw = gameWinner(match, st.score);
  if (gw) {
    st.set_history.push({ set: st.current_set, a: st.score.a, b: st.score.b, winner: gw });
    if (match.rules.scoring_type === 'sets') {
      st.sets[gw] += 1;
      if (st.sets[gw] >= 2) {
        st.phase = 'finished';
        st.winner = gw;
        st.break_started_at = null;
        st.ended_at = new Date().toISOString();
      } else {
        st.phase = 'set_break';
        st.game_winner = gw;
        st.break_started_at = new Date().toISOString();
      }
    } else {
      st.phase = 'finished';
      st.winner = gw;
      st.break_started_at = null;
      st.ended_at = new Date().toISOString();
    }
    return gw;
  }
  const ip = Number(match.rules.interval_point) || 0;
  if (!st.interval_done && ip > 0 && ip < match.rules.win_point && (st.score.a === ip || st.score.b === ip)) {
    st.phase = 'interval';
    st.interval_done = true;
    st.break_started_at = new Date().toISOString();
    const deciding = match.rules.scoring_type === 'sets' && st.sets.a === 1 && st.sets.b === 1;
    // Continuous games and the deciding set switch ends at the interval (BWF style).
    st.interval_swap = match.rules.scoring_type === 'continuous' || deciding;
  }
  return null;
}

function applyRally(match, st, winner) {
  const dbl = isDoubles(match);
  const ss = st.service_status;
  const srv = ss.side;
  const srvTurn = ss.turn || 1;
  const scoreBefore = { a: st.score.a, b: st.score.b };
  const method = match.rules.scoring_method;
  let event = 'WIN_RALLY';
  let note = '';

  if (winner === srv) {
    st.score[winner] += 1;
    if (dbl) {
      const p = st.positions[srv];
      st.positions[srv] = { even: p.odd, odd: p.even };
    }
    ss.receiver_id = receiverFor(match, st, srv, ss.player_id);
  } else if (method === 'rally_point') {
    st.score[winner] += 1;
    const court = courtFor(st.score[winner]);
    ss.side = winner;
    ss.turn = 1;
    ss.player_id = dbl ? st.positions[winner][court] : `${winner}1`;
    ss.receiver_id = dbl ? st.positions[srv][court] : `${srv}1`;
    note = ' Pindah servis.';
  } else if (dbl && ss.turn === 1) {
    // Side-out doubles: first hand lost -> partner serves (2nd serve). No point.
    const p = st.positions[srv];
    const partner = p.even === ss.player_id ? p.odd : p.even;
    ss.turn = 2;
    ss.player_id = partner;
    ss.receiver_id = receiverFor(match, st, srv, partner);
    event = 'SIDE_OUT_2ND';
  } else {
    // Side-out: service moves to the opponent, starting from 1st serve. No point.
    ss.side = winner;
    ss.turn = 1;
    if (dbl) {
      ss.player_id = st.positions[winner].even;
      ss.receiver_id = st.positions[srv].even;
    } else {
      ss.player_id = `${winner}1`;
      ss.receiver_id = `${srv}1`;
    }
    event = 'SIDE_OUT';
  }

  const isSideOut = event === 'SIDE_OUT' || (method === 'rally_point' && winner !== srv);
  const isSecondServe = event === 'SIDE_OUT_2ND' || (srvTurn === 2 && winner === srv);
  const pointDeltaA = st.score.a - scoreBefore.a;
  const pointDeltaB = st.score.b - scoreBefore.b;

  // Catat riwayat servis/reli ke rally_history
  const rallyEntry = {
    rally_number: ((st.rally_history && st.rally_history.length) || 0) + 1,
    set: st.current_set,
    server_side: srv,
    server_turn: srvTurn,
    receiver_side: other(srv),
    winner,
    event,
    side_out: isSideOut,
    second_serve: isSecondServe,
    server_won: winner === srv,
    score: { a: st.score.a, b: st.score.b },
    score_before: scoreBefore,
    point_delta: { a: pointDeltaA, b: pointDeltaB },
  };
  st.rally_history = st.rally_history || [];
  st.rally_history.push(rallyEntry);

  const gw = afterPoint(match, st);
  let details;
  if (event === 'WIN_RALLY') details = `Tim ${T(winner)} Menang Reli.${note} ${describeState(match, st)}`;
  else if (event === 'SIDE_OUT_2ND') details = `Tim ${T(winner)} Menang Reli. Servis Ke-2 Tim ${T(srv)}. ${describeState(match, st)}`;
  else details = `Tim ${T(winner)} Menang Reli. Pindah Bola (Side-out). ${describeState(match, st)}`;
  if (gw) {
    details += st.phase === 'finished' ? ` | PERTANDINGAN SELESAI - Pemenang Tim ${T(gw)}` : ` | Set ${st.current_set} dimenangkan Tim ${T(gw)}`;
  } else if (st.phase === 'interval') {
    details += st.interval_swap ? ' | INTERVAL - TUKAR LAPANGAN' : ' | INTERVAL';
  }
  return { event, details };
}

function sanitizeName(v, max = 80) {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Apply a controller action. Returns { live_state, teams, court_number, event_type, details }.
 * Throws EngineError on invalid action.
 * UNDO and CONFIRM_FINISH bookkeeping is handled by the store; the engine validates only.
 */
export function applyAction(match, action) {
  const type = action?.type;
  const p = action?.payload || {};
  const st = clone(match.live_state);
  let teams = match.teams;
  let court_number = match.court_number;
  const dbl = isDoubles(match);
  let event_type = type;
  let details = '';

  switch (type) {
    case 'SETUP_START': {
      if (st.phase !== 'setup') throw new EngineError('Pertandingan tidak dalam tahap setup');
      const left = p.left === 'b' ? 'b' : 'a';
      st.sides = { left, right: other(left) };
      const server = p.server_id;
      if (!validPlayerIds(match).includes(server)) throw new EngineError('Pilih pemain yang melakukan servis pertama');
      const srvTeam = server[0];
      const rcvTeam = other(srvTeam);
      let receiver = p.receiver_id;
      if (dbl) {
        st.positions = validatePositions(match, p.positions);
        if (!validPlayerIds(match).includes(receiver) || receiver[0] !== rcvTeam) {
          throw new EngineError('Pilih pemain lawan yang menerima servis pertama');
        }
        // At 0 the server and receiver must stand in the right (even) service court.
        if (st.positions[srvTeam].odd === server) st.positions[srvTeam] = { even: server, odd: st.positions[srvTeam].even };
        if (st.positions[rcvTeam].odd === receiver) st.positions[rcvTeam] = { even: receiver, odd: st.positions[rcvTeam].even };
      } else {
        receiver = `${rcvTeam}1`;
        st.positions = { a: { even: 'a1', odd: null }, b: { even: 'b1', odd: null } };
      }
      const isFirstGameStart = st.current_set === 1 && !st.started_at;
      const initialTurn = match.rules.scoring_method === 'side_out' && dbl && isFirstGameStart ? 2 : 1;
      st.service_status = { side: srvTeam, turn: initialTurn, player_id: server, receiver_id: receiver };
      st.phase = 'live';
      st.game_winner = null;
      st.break_started_at = null;
      if (!st.started_at) st.started_at = new Date().toISOString();
      if (!st.shuttlecock_count || st.shuttlecock_count < 1) st.shuttlecock_count = 1;
      event_type = st.current_set > 1 ? 'START_SET' : 'START_MATCH';
      const lt = st.sides.left;
      const turnNote = match.rules.scoring_method === 'side_out' && dbl ? ` (${turnLabel(initialTurn)} Serve)` : '';
      details = `${st.current_set > 1 ? `Mulai Set ${st.current_set}` : 'Mulai Laga'}. Kiri: Tim ${T(lt)}, Kanan: Tim ${T(other(lt))}. Servis: ${playerName(match, server)}${turnNote} -> Penerima: ${playerName(match, receiver)}. Cock: ${st.shuttlecock_count}`;
      break;
    }
    case 'SHUTTLECOCK': {
      const cur = Number.isInteger(st.shuttlecock_count) ? st.shuttlecock_count : 0;
      let next = cur;
      if (p.count !== undefined && p.count !== null) {
        const parsed = parseInt(p.count, 10);
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > 999) {
          throw new EngineError('Jumlah shuttlecock tidak valid');
        }
        next = parsed;
      } else {
        const delta = parseInt(p.delta, 10) || 1;
        next = Math.max(0, Math.min(999, cur + delta));
      }
      if (next === cur) {
        throw new EngineError('Jumlah shuttlecock tidak berubah');
      }
      st.shuttlecock_count = next;
      const diff = next - cur;
      event_type = diff > 0 ? 'SHUTTLECOCK_ADD' : 'SHUTTLECOCK_SUB';
      details = `Penggunaan shuttlecock ${diff > 0 ? `ditambah (+${diff})` : `dikurangi (${diff})`}: Total ${next} cock`;
      break;
    }
    case 'WIN_RALLY': {
      if (st.phase !== 'live') throw new EngineError('Skor terkunci. Selesaikan interval/konfirmasi terlebih dahulu', 'locked_phase');
      let team = p.team;
      if (!team && (p.side === 'left' || p.side === 'right')) team = st.sides[p.side];
      if (team !== 'a' && team !== 'b') throw new EngineError('Tim pemenang reli tidak valid');
      const r = applyRally(match, st, team);
      event_type = r.event;
      details = r.details;
      break;
    }
    case 'ISSUE_CARD': {
      if (st.phase === 'finished') {
        throw new EngineError('Pertandingan sudah selesai, kartu pelanggaran tidak dapat diberikan');
      }
      const cardType = String(p.card_type || p.type || 'yellow').toLowerCase();
      if (!['yellow', 'red', 'black'].includes(cardType)) {
        throw new EngineError('Jenis kartu pelanggaran tidak valid (pilih Kuning, Merah, atau Hitam)');
      }
      let team = p.team;
      const validIds = validPlayerIds(match);
      let playerId = p.player_id;
      if (playerId && validIds.includes(playerId)) {
        team = playerId[0];
      } else if (team === 'a' || team === 'b') {
        playerId = `${team}1`;
      } else {
        throw new EngineError('Pilih tim atau pemain yang dikenai kartu pelanggaran');
      }
      const pName = playerName(match, playerId) || teamLabel(match, team);
      const tName = teamLabel(match, team);
      const club = match.teams?.[`team_${team}`]?.club || '';
      const reason = sanitizeName(p.reason || 'Pelanggaran perilaku / penundaan permainan (BWF Law 16)', 160);
      const scoreBefore = { a: st.score.a, b: st.score.b };
      const opp = other(team);
      st.cards = Array.isArray(st.cards) ? st.cards : [];

      let consequenceNote = '';
      if (cardType === 'yellow') {
        event_type = 'YELLOW_CARD';
        consequenceNote = 'Peringatan Resmi (BWF Law 16.7.1.1 — Skor & Servis Tetap)';
        details = `🟨 KARTU KUNING: ${pName} (Tim ${T(team)}${club ? ` · ${club}` : ''}) — Alasan: ${reason}. ${consequenceNote}. ${describeState(match, st)}`;
      } else if (cardType === 'red') {
        if (st.phase !== 'live') {
          throw new EngineError('Kartu Merah (Fault / Poin Lawan) hanya dapat diberikan saat permainan aktif (Live). Selesaikan setup/interval terlebih dahulu.');
        }
        event_type = 'RED_CARD';
        const r = applyRally(match, st, opp);
        const lastRally = st.rally_history?.[st.rally_history.length - 1];
        if (lastRally) {
          lastRally.penalty_card = 'red';
          lastRally.offender_team = team;
          lastRally.offender_player_id = playerId;
          lastRally.offender_name = pName;
          lastRally.reason = reason;
        }
        consequenceNote =
          match.rules.scoring_method === 'side_out'
            ? `Fault Pelanggaran (BWF Law 16.7.1.2) -> Reli/Poin untuk Tim ${T(opp)}`
            : `Fault Pelanggaran (BWF Law 16.7.1.2) -> +1 Poin & Servis untuk Tim ${T(opp)} (${teamLabel(match, opp)})`;
        details = `🟥 KARTU MERAH: ${pName} (Tim ${T(team)}${club ? ` · ${club}` : ''}) — Alasan: ${reason}. ${consequenceNote}. ${r.details}`;
      } else {
        // black card (Disqualification by Referee)
        event_type = 'BLACK_CARD';
        st.set_history = Array.isArray(st.set_history) ? st.set_history : [];
        st.set_history.push({
          set: st.current_set,
          a: st.score.a,
          b: st.score.b,
          winner: opp,
          note: 'DSQ',
        });
        if (match.rules.scoring_type === 'sets') {
          st.sets[opp] = Math.max(2, (st.sets[opp] || 0) + 1);
        }
        st.phase = 'finished';
        st.winner = opp;
        st.break_started_at = null;
        if (!st.started_at) st.started_at = new Date().toISOString();
        st.ended_at = new Date().toISOString();
        consequenceNote = `Diskualifikasi Referee (BWF Law 16.7.2) -> Pertandingan dimenangkan Tim ${T(opp)} (${teamLabel(match, opp)})`;
        details = `⬛ KARTU HITAM (DISKUALIFIKASI): ${pName} (Tim ${T(team)}${club ? ` · ${club}` : ''}) — Alasan: ${reason}. ${consequenceNote}.`;
      }

      const cardEntry = {
        card_id: st.cards.length + 1,
        type: cardType,
        team,
        player_id: playerId,
        player_name: pName,
        team_name: tName,
        club,
        reason,
        set: st.current_set,
        score_before: scoreBefore,
        score_after: { a: st.score.a, b: st.score.b },
        consequence: consequenceNote,
        timestamp: formatLocalDateTime(new Date()),
      };
      st.cards.push(cardEntry);
      break;
    }
    case 'RETIRE': {
      if (st.phase === 'finished') throw new EngineError('Pertandingan sudah selesai');
      const team = p.team === 'b' ? 'b' : p.team === 'a' ? 'a' : null;
      if (!team) throw new EngineError('Pilih tim yang tidak dapat melanjutkan pertandingan');
      const opp = other(team);
      const mode = p.mode === 'walkover' ? 'walkover' : 'retired';
      const noteTag = mode === 'walkover' ? 'WO' : 'RET';
      let playerId = p.player_id;
      if (!dbl || !validPlayerIds(match).includes(playerId) || playerId[0] !== team) {
        playerId = `${team}1`;
      }
      const pName = playerName(match, playerId) || teamLabel(match, team);
      const tName = teamLabel(match, team);
      const club = teamObj(match, team)?.club || '';
      const reason = sanitizeName(p.reason || BWF_RETIRE_REASONS[0], 160) || BWF_RETIRE_REASONS[0];
      const scoreBefore = { a: st.score.a, b: st.score.b };

      st.set_history = Array.isArray(st.set_history) ? st.set_history : [];
      st.set_history.push({
        set: st.current_set,
        a: st.score.a,
        b: st.score.b,
        winner: opp,
        note: noteTag,
      });
      if (match.rules.scoring_type === 'sets') {
        st.sets[opp] = Math.max(2, (st.sets[opp] || 0) + 1);
      }
      st.phase = 'finished';
      st.winner = opp;
      st.break_started_at = null;
      if (!st.started_at) st.started_at = new Date().toISOString();
      st.ended_at = new Date().toISOString();
      st.retirement = {
        type: mode,
        tag: noteTag,
        team,
        winner: opp,
        player_id: playerId,
        player_name: pName,
        team_name: tName,
        club,
        reason,
        set: st.current_set,
        score_at_stop: scoreBefore,
        timestamp: formatLocalDateTime(new Date()),
      };
      event_type = mode === 'walkover' ? 'WALKOVER' : 'RETIRED';
      const labelMode = mode === 'walkover' ? 'WALKOVER (WO)' : 'RETIRED (CEDERA / MUNDUR)';
      details = `🚑 ${labelMode}: ${pName} (Tim ${T(team)}${club ? ` · ${club}` : ''}) — Alasan: ${reason}. Skor saat berhenti: ${scoreBefore.a}-${scoreBefore.b} (Set ${st.current_set}). Pemenang: Tim ${T(opp)} (${teamLabel(match, opp)}).`;
      break;
    }
    case 'CONFIRM_INTERVAL': {
      if (st.phase !== 'interval') throw new EngineError('Tidak sedang interval');
      if (st.interval_swap) {
        st.sides = { left: st.sides.right, right: st.sides.left };
        event_type = 'SWITCH_SIDE';
        details = `Interval - Tukar Lapangan dikonfirmasi. Kiri: Tim ${T(st.sides.left)}. ${describeState(match, st)}`;
      } else {
        event_type = 'INTERVAL_END';
        details = `Interval selesai. ${describeState(match, st)}`;
      }
      st.phase = 'live';
      st.break_started_at = null;
      break;
    }
    case 'SWITCH_SIDE': {
      if (!['live', 'setup'].includes(st.phase)) throw new EngineError('Tukar sisi tidak tersedia pada tahap ini');
      st.sides = { left: st.sides.right, right: st.sides.left };
      details = `Tukar sisi manual. Kiri: Tim ${T(st.sides.left)}. ${describeState(match, st)}`;
      break;
    }
    case 'NEXT_SET': {
      if (st.phase !== 'set_break') throw new EngineError('Set belum selesai');
      const prevWinner = st.game_winner;
      st.current_set += 1;
      st.score = { a: 0, b: 0 };
      st.sides = { left: st.sides.right, right: st.sides.left };
      st.interval_done = false;
      st.interval_swap = false;
      st.break_started_at = null;
      st.service_status = { side: prevWinner, turn: 1, player_id: null, receiver_id: null };
      st.phase = 'setup';
      details = `Persiapan Set ${st.current_set}. Ganti tempat (Kiri: Tim ${T(st.sides.left)}). Pemenang set sebelumnya (Tim ${T(prevWinner)}) servis pertama.`;
      break;
    }
    case 'CONFIRM_FINISH': {
      if (st.phase !== 'finished') throw new EngineError('Pertandingan belum selesai');
      const hist = st.set_history.map((s) => `${s.a}-${s.b}`).join(', ');
      details = `Hasil dikonfirmasi. Pemenang: Tim ${T(st.winner)} (${teamLabel(match, st.winner)}). Skor: ${hist}`;
      break;
    }
    case 'OVERRIDE': {
      const changes = [];
      if (p.names) {
        teams = clone(match.teams);
        for (const key of ['team_a', 'team_b']) {
          const src = p.names[key];
          if (!src) continue;
          const t = teams[key];
          if (src.p1 !== undefined) {
            const v = sanitizeName(src.p1);
            if (!v) throw new EngineError('Nama pemain 1 tidak boleh kosong');
            t.p1 = v;
          }
          if (src.p2 !== undefined && dbl) {
            const v = sanitizeName(src.p2);
            if (!v) throw new EngineError('Nama pemain 2 tidak boleh kosong');
            t.p2 = v;
          }
          if (src.club !== undefined) t.club = sanitizeName(src.club);
          if (src.details !== undefined) {
            const dv = src.details;
            if (dv === null || dv === '') t.details = null;
            else if (typeof dv === 'object') t.details = dv;
            else {
              const s = sanitizeName(dv, 120);
              t.details = s || null;
            }
          }
        }
        changes.push(`Nama: A=${teamLabel({ ...match, teams }, 'a')} (${teams.team_a.club || '-'}), B=${teamLabel({ ...match, teams }, 'b')} (${teams.team_b.club || '-'})`);
      }
      if (p.court_number !== undefined) {
        const c = parseInt(p.court_number, 10);
        if (!Number.isInteger(c) || c < 1 || c > 99) throw new EngineError('Nomor lapangan tidak valid');
        court_number = c;
        changes.push(`Lapangan: ${c}`);
      }
      if (p.shuttlecock_count !== undefined && p.shuttlecock_count !== null) {
        const sc = Math.max(0, Math.min(999, parseInt(p.shuttlecock_count, 10) || 0));
        st.shuttlecock_count = sc;
        changes.push(`Cock: ${sc}`);
      }
      const scoringEdit = p.score || p.service || p.positions || p.sides;
      if (scoringEdit) {
        if (!['live', 'interval'].includes(st.phase)) throw new EngineError('Koreksi skor/servis hanya saat laga berlangsung');
        if (p.sides && (p.sides.left === 'a' || p.sides.left === 'b')) {
          st.sides = { left: p.sides.left, right: other(p.sides.left) };
          changes.push(`Sisi Kiri: Tim ${T(st.sides.left)}`);
        }
        if (p.score) {
          const a = parseInt(p.score.a, 10);
          const b = parseInt(p.score.b, 10);
          if (!(a >= 0 && b >= 0 && a < 200 && b < 200)) throw new EngineError('Skor tidak valid');
          st.score = { a, b };
          const ip = Number(match.rules.interval_point) || 0;
          st.interval_done = ip > 0 && Math.max(a, b) >= ip;
          changes.push(`Skor: ${a}-${b}`);
        }
        if (p.positions && dbl) {
          st.positions = validatePositions(match, p.positions);
          changes.push('Posisi pemain dikoreksi');
        }
        if (p.service) {
          const side = p.service.side;
          if (side !== 'a' && side !== 'b') throw new EngineError('Tim servis tidak valid');
          let pid = p.service.player_id;
          if (!dbl) pid = `${side}1`;
          if (!validPlayerIds(match).includes(pid) || pid[0] !== side) throw new EngineError('Pemain servis tidak valid');
          const turn = match.rules.scoring_method === 'side_out' && dbl && p.service.turn === 2 ? 2 : 1;
          st.service_status = { side, turn, player_id: pid, receiver_id: null };
        }
        const ss = st.service_status;
        if (ss.side && ss.player_id) ss.receiver_id = receiverFor(match, st, ss.side, ss.player_id);
        changes.push(describeState(match, st));
      }
      if (!changes.length) throw new EngineError('Tidak ada perubahan');
      details = `Override: ${changes.join(' | ')}`;
      break;
    }
    default:
      throw new EngineError(`Aksi tidak dikenal: ${type}`);
  }

  return { live_state: st, teams, court_number, event_type, details };
}

/**
 * Returns recent rallies (up to `limit`, default 10) for display in OBS overlay or LiveScore.
 * If `filterCurrentSet` is true and rallies exist in the current set, returns rallies within that set.
 */
export function getRecentRallies(match, limit = 10, filterCurrentSet = false) {
  const all = match?.live_state?.rally_history || [];
  if (!all.length) return [];
  if (filterCurrentSet && match?.live_state?.current_set) {
    const curSet = match.live_state.current_set;
    const inSet = all.filter((r) => r.set === curSet);
    if (inSet.length > 0) return inSet.slice(-limit);
  }
  return all.slice(-limit);
}
