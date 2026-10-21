/**
 * Ingest: parses flat match schedules (CSV / TSV / JSON) and validates them
 * according to PRD section 2.
 */
import { DISCIPLINES, SCORING_METHODS, SCORING_TYPES, isDoubles } from '../engine.js';

export const COLUMNS = [
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
// Optional extension column (deuce cap for "sets" games). Not required.
export const OPTIONAL_COLUMNS = ['max_point'];

/** RFC4180-ish parser with auto delimiter detection (comma, semicolon, tab). */
export function parseDelimited(text) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const counts = { '\t': 0, ',': 0, ';': 0 };
  for (const ch of firstLine) if (ch in counts) counts[ch] += 1;
  const [bestDelim, bestCount] = Object.entries(counts).sort((x, y) => y[1] - x[1])[0];
  const delim = bestCount > 0 ? bestDelim : ',';

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field === '') inQuotes = true;
    else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => r.some((v) => String(v).trim() !== ''));
  if (!nonEmpty.length) return [];
  const header = nonEmpty[0].map((h) => String(h).trim().toLowerCase().replace(/\s+/g, '_'));
  return nonEmpty.slice(1).map((r) => {
    const o = {};
    header.forEach((h, idx) => {
      o[h] = r[idx] !== undefined ? String(r[idx]).trim() : '';
    });
    return o;
  });
}

function parseDetails(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'object') return v;
  const s = String(v).trim();
  if (s.startsWith('{') || s.startsWith('[')) {
    try {
      return JSON.parse(s);
    } catch {
      return s;
    }
  }
  return s;
}

const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const nullish = (v) => {
  const s = str(v);
  return s === '' || ['null', '-', 'none', 'n/a'].includes(s.toLowerCase()) ? null : s;
};

/** Validate & normalize one raw row. Returns { match, errors[] }. */
export function normalizeRow(raw, { courtCount = 15 } = {}) {
  const errors = [];
  const r = {};
  for (const [k, v] of Object.entries(raw || {})) r[String(k).trim().toLowerCase()] = v;

  const match_number = str(r.match_number).toUpperCase();
  if (!match_number) errors.push('match_number wajib diisi');
  else if (!/^[A-Z0-9._\-/]{1,40}$/.test(match_number)) errors.push(`match_number "${match_number}" mengandung karakter tidak valid`);

  const discipline = str(r.discipline).toUpperCase();
  if (!DISCIPLINES.includes(discipline)) errors.push(`discipline "${r.discipline ?? ''}" harus salah satu dari ${DISCIPLINES.join('/')}`);

  const scoring_method = str(r.scoring_method).toLowerCase().replace(/[\s-]/g, '_');
  if (!SCORING_METHODS.includes(scoring_method)) errors.push(`scoring_method harus rally_point atau side_out`);

  const scoring_type = str(r.scoring_type).toLowerCase();
  if (!SCORING_TYPES.includes(scoring_type)) errors.push(`scoring_type harus sets atau continuous`);

  const win_point = parseInt(str(r.win_point), 10);
  if (!Number.isInteger(win_point) || win_point < 1 || win_point > 150) errors.push('win_point harus bilangan bulat 1-150');

  const intervalRaw = str(r.interval_point);
  const interval_point = intervalRaw === '' ? 0 : parseInt(intervalRaw, 10);
  if (!Number.isInteger(interval_point) || interval_point < 0) errors.push('interval_point harus bilangan bulat >= 0');
  else if (Number.isInteger(win_point) && interval_point >= win_point) errors.push('interval_point harus lebih kecil dari win_point');

  const maxRaw = str(r.max_point);
  const max_point = maxRaw === '' ? null : parseInt(maxRaw, 10);
  if (maxRaw !== '' && (!Number.isInteger(max_point) || max_point < win_point)) errors.push('max_point harus >= win_point');

  const dbl = isDoubles(discipline);
  const a1 = str(r.team_a_p1_name);
  const b1 = str(r.team_b_p1_name);
  const a2 = nullish(r.team_a_p2_name);
  const b2 = nullish(r.team_b_p2_name);
  if (!a1) errors.push('team_a_p1_name wajib diisi');
  if (!b1) errors.push('team_b_p1_name wajib diisi');
  if (dbl && !a2) errors.push('team_a_p2_name wajib untuk ganda');
  if (dbl && !b2) errors.push('team_b_p2_name wajib untuk ganda');

  const courtRaw = str(r.court_number);
  const court_number = parseInt(courtRaw, 10);
  if (!Number.isInteger(court_number) || court_number < 1 || court_number > courtCount) errors.push(`court_number harus 1-${courtCount}`);

  const match = {
    match_number,
    tournament_name: str(r.tournament_name),
    category_name: str(r.category_name),
    discipline,
    scheduled_date: str(r.scheduled_date || r.date || r.tanggal),
    scheduled_time: str(r.scheduled_time),
    court_number,
    rules: { scoring_method, scoring_type, win_point, interval_point, max_point },
    teams: {
      team_a: { id: 't_A', p1: a1, p2: dbl ? a2 : null, club: str(r.team_a_club), details: parseDetails(r.team_a_details) },
      team_b: { id: 't_B', p1: b1, p2: dbl ? b2 : null, club: str(r.team_b_club), details: parseDetails(r.team_b_details) },
    },
  };
  return { match, errors };
}

/** Parse input (string CSV/TSV/JSON text or array of objects) into normalized matches + row errors. */
export function ingest(input, opts = {}) {
  let rows;
  if (Array.isArray(input)) rows = input;
  else {
    const text = String(input || '').trim();
    if (text.startsWith('[')) {
      try {
        rows = JSON.parse(text);
      } catch (e) {
        return { matches: [], errors: [{ row: 0, match_number: '', messages: [`JSON tidak valid: ${e.message}`] }] };
      }
    } else rows = parseDelimited(text);
  }
  const matches = [];
  const errors = [];
  const seen = new Set();
  rows.forEach((raw, idx) => {
    const rowNo = idx + 2; // +1 header, +1 one-based
    const { match, errors: errs } = normalizeRow(raw, opts);
    if (match.match_number && seen.has(match.match_number)) errs.push(`match_number ${match.match_number} duplikat di file`);
    if (errs.length) errors.push({ row: rowNo, match_number: match.match_number, messages: errs });
    else {
      seen.add(match.match_number);
      matches.push(match);
    }
  });
  return { matches, errors, total: rows.length };
}

export function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header, rows) {
  return [header.join(','), ...rows.map((r) => header.map((h) => csvEscape(r[h])).join(','))].join('\r\n');
}
