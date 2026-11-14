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

/** Default scoring rule presets when external exports (e.g. Tournament Planner / PBSI) omit rule columns. */
export const SCORING_PRESETS = [
  {
    id: 'bwf_rally_21',
    label: 'BWF Standar (Rally Point · Sets · 21 · Interval 11)',
    scoring_method: 'rally_point',
    scoring_type: 'sets',
    win_point: 21,
    interval_point: 11,
    max_point: 30,
  },
  {
    id: 'veteran_rally_30',
    label: 'Rally 30 Continuous (Rally Point · Continuous · 30 · Interval 15)',
    scoring_method: 'rally_point',
    scoring_type: 'continuous',
    win_point: 30,
    interval_point: 15,
    max_point: null,
  },
  {
    id: 'legacy_sideout_15',
    label: 'Klasik Side-Out 15 (Side-Out · Sets · 15 · Interval 0)',
    scoring_method: 'side_out',
    scoring_type: 'sets',
    win_point: 15,
    interval_point: 0,
    max_point: null,
  },
  {
    id: 'sideout_continuous_30',
    label: 'Side-Out 30 Continuous (Side-Out · Continuous · 30 · Interval 15)',
    scoring_method: 'side_out',
    scoring_type: 'continuous',
    win_point: 30,
    interval_point: 15,
    max_point: null,
  },
];

export function getScoringPreset(presetId) {
  return SCORING_PRESETS.find((p) => p.id === presetId) || SCORING_PRESETS[0];
}

/** Common header aliases mapped to canonical PRD column names. */
const HEADER_ALIASES = {
  no_partai: 'match_number',
  nomor_partai: 'match_number',
  kode_partai: 'match_number',
  match_id: 'match_number',
  match_nr: 'match_number',
  match_no: 'match_number',
  match_num: 'match_number',
  nr: 'match_number',
  no: 'match_number',
  no_pertandingan: 'match_number',
  partai: 'match_number',
  nama_turnamen: 'tournament_name',
  turnamen: 'tournament_name',
  tournament: 'tournament_name',
  kategori: 'category_name',
  category: 'category_name',
  event: 'category_name',
  event_name: 'category_name',
  draw: 'category_name',
  nomor_pertandingan: 'category_name',
  round: 'round_name',
  babak: 'round_name',
  phase: 'round_name',
  stage: 'round_name',
  disiplin: 'discipline',
  nomor: 'discipline',
  metode_skor: 'scoring_method',
  sistem_skor: 'scoring_method',
  tipe_skor: 'scoring_type',
  target_poin: 'win_point',
  poin_menang: 'win_point',
  poin_interval: 'interval_point',
  interval: 'interval_point',
  tanggal: 'scheduled_date',
  date: 'scheduled_date',
  play_date: 'scheduled_date',
  match_date: 'scheduled_date',
  tgl: 'scheduled_date',
  lapangan: 'court_number',
  court: 'court_number',
  court_name: 'court_number',
  location: 'court_number',
  venue_court: 'court_number',
  no_lapangan: 'court_number',
  jam: 'scheduled_time',
  waktu: 'scheduled_time',
  time: 'scheduled_time',
  not_before: 'scheduled_time',
  start_time: 'scheduled_time',
  schedule_time: 'scheduled_time',
  scheduled_at: 'scheduled_time',
  jam_main: 'scheduled_time',
  team_1: 'team_a_raw',
  team1: 'team_a_raw',
  player_1: 'team_a_raw',
  player1: 'team_a_raw',
  home: 'team_a_raw',
  pemain_1: 'team_a_raw',
  pemain_a: 'team_a_raw',
  tim_a: 'team_a_raw',
  tim_1: 'team_a_raw',
  pihak_a: 'team_a_raw',
  team_2: 'team_b_raw',
  team2: 'team_b_raw',
  player_2: 'team_b_raw',
  player2: 'team_b_raw',
  away: 'team_b_raw',
  pemain_2: 'team_b_raw',
  pemain_b: 'team_b_raw',
  tim_b: 'team_b_raw',
  tim_2: 'team_b_raw',
  pihak_b: 'team_b_raw',
  club_1: 'team_a_club',
  club1: 'team_a_club',
  association_1: 'team_a_club',
  assoc_1: 'team_a_club',
  klub_1: 'team_a_club',
  klub_a: 'team_a_club',
  pb_a: 'team_a_club',
  asal_a: 'team_a_club',
  club_2: 'team_b_club',
  club2: 'team_b_club',
  association_2: 'team_b_club',
  assoc_2: 'team_b_club',
  klub_2: 'team_b_club',
  klub_b: 'team_b_club',
  pb_b: 'team_b_club',
  asal_b: 'team_b_club',
  team_a_detail: 'team_a_details',
  team_b_detail: 'team_b_details',
  team_a_seed: 'team_a_details',
  team_b_seed: 'team_b_details',
  team_a_seeded: 'team_a_details',
  team_b_seeded: 'team_b_details',
  seed_a: 'team_a_details',
  seed_b: 'team_b_details',
  unggulan_a: 'team_a_details',
  unggulan_b: 'team_b_details',
};

function normalizeHeaderCell(h) {
  const clean = String(h || '')
    .replace(/^["']+|["']+$/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-/]+/g, '_');
  return HEADER_ALIASES[clean] || clean;
}

/** RFC4180-ish parser with auto delimiter detection (comma, semicolon, tab) and smart header-row discovery. */
export function parseDelimited(text) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  const sampleLines = src.split(/\r?\n/, 10).join('\n');
  const counts = { '\t': 0, ',': 0, ';': 0 };
  for (const ch of sampleLines) if (ch in counts) counts[ch] += 1;
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

  // Auto-detect header row within the first 15 non-empty rows (in case of title rows above header)
  let headerIdx = 0;
  for (let i = 0; i < Math.min(15, nonEmpty.length); i += 1) {
    const normalized = nonEmpty[i].map(normalizeHeaderCell);
    if (
      normalized.includes('match_number') ||
      ((normalized.includes('team_a_p1_name') || normalized.includes('team_a_raw')) && normalized.includes('court_number'))
    ) {
      headerIdx = i;
      break;
    }
  }

  const header = nonEmpty[headerIdx].map(normalizeHeaderCell);
  return nonEmpty
    .slice(headerIdx + 1)
    .filter((r) => {
      // Ignore rows where all mapped cells are empty or just a repeated header row
      const nonBlank = r.filter((v) => String(v).trim() !== '');
      if (!nonBlank.length) return false;
      const firstMapped = normalizeHeaderCell(r[header.indexOf('match_number')] || '');
      if (firstMapped === 'match_number') return false;
      return true;
    })
    .map((r) => {
      const o = {};
      header.forEach((h, idx) => {
        if (h) o[h] = r[idx] !== undefined ? String(r[idx]).trim() : '';
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

function stripClubAndSeed(text) {
  let s = str(text);
  let seed = null;
  let club = '';
  const seedMatch = s.match(/\[([^\]]+)\]/);
  if (seedMatch) {
    seed = seedMatch[1].trim();
    s = s.replace(seedMatch[0], ' ').trim();
  }
  const clubMatch = s.match(/\(([^()]+)\)\s*$/);
  if (clubMatch) {
    club = clubMatch[1].trim();
    s = s.slice(0, clubMatch.index).trim();
  }
  return { name: s.replace(/\s+/g, ' ').trim(), club, seed };
}

function parseTeamSide(rawCombined, p1Explicit, p2Explicit, clubExplicit, detailsExplicit) {
  let p1 = str(p1Explicit);
  let p2 = nullish(p2Explicit);
  let club = str(clubExplicit);
  let details = parseDetails(detailsExplicit);

  const source = !p1 ? str(rawCombined) : (!p2 && /[\/\r\n]/.test(p1) ? p1 : '');
  if (source) {
    let working = source;
    const seedMatch = working.match(/\[([^\]]+)\]/);
    if (seedMatch) {
      if (details === null) details = seedMatch[1].trim();
      working = working.replace(seedMatch[0], ' ').trim();
    }
    const parts = working
      .split(/\r?\n|\s*\/\s*/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      const first = stripClubAndSeed(parts[0]);
      const second = stripClubAndSeed(parts.slice(1).join(' / '));
      p1 = first.name;
      p2 = second.name || null;
      if (!club) {
        const clubs = [first.club, second.club].filter(Boolean);
        club = [...new Set(clubs)].join(' / ');
      }
      if (details === null && (first.seed || second.seed)) details = first.seed || second.seed;
    } else if (parts.length === 1) {
      const single = stripClubAndSeed(parts[0]);
      p1 = single.name;
      if (!club && single.club) club = single.club;
      if (details === null && single.seed) details = single.seed;
    }
  } else if (p1) {
    const cleaned = stripClubAndSeed(p1);
    p1 = cleaned.name;
    if (!club && cleaned.club) club = cleaned.club;
    if (details === null && cleaned.seed) details = cleaned.seed;
  }

  return { p1, p2, club, details, hasPair: Boolean(p2) };
}

function inferDiscipline(rawDisc, categoryName, hasPair) {
  const direct = str(rawDisc).toUpperCase();
  if (DISCIPLINES.includes(direct)) return direct;

  const text = `${str(rawDisc)} ${str(categoryName)}`.trim();
  const codeMatch = text.match(/\b(MS|WS|MD|WD|XD)\b/i);
  if (codeMatch) return codeMatch[1].toUpperCase();

  const lower = text.toLowerCase();
  if (/mixed|campuran/.test(lower)) return 'XD';
  if (/ganda\s+putri|women'?s?\s+doubles|girls'?\s+doubles/.test(lower)) return 'WD';
  if (/ganda\s+putra|men'?s?\s+doubles|boys'?\s+doubles/.test(lower)) return 'MD';
  if (/tunggal\s+putri|women'?s?\s+singles|girls'?\s+singles/.test(lower)) return 'WS';
  if (/tunggal\s+putra|men'?s?\s+singles|boys'?\s+singles/.test(lower)) return 'MS';
  if (/ganda|doubles/.test(lower)) return /putri|women|girls/.test(lower) ? 'WD' : 'MD';
  if (/tunggal|singles/.test(lower)) return /putri|women|girls/.test(lower) ? 'WS' : 'MS';
  if (hasPair) return 'MD';
  return '';
}

function parseCourtNumber(rawCourt, defaultCourt) {
  const raw = str(rawCourt);
  if (!raw && defaultCourt !== undefined && defaultCourt !== null && String(defaultCourt).trim() !== '') {
    return parseInt(String(defaultCourt), 10);
  }
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  const m = raw.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : NaN;
}

/** Validate & normalize one raw row. Returns { match, errors[] }. */
export function normalizeRow(raw, { courtCount = 15, defaults = {} } = {}) {
  const errors = [];
  const r = {};
  for (const [k, v] of Object.entries(raw || {})) {
    r[normalizeHeaderCell(k)] = v;
  }

  const preset = defaults?.scoringPreset ? getScoringPreset(defaults.scoringPreset) : null;

  const match_number = str(r.match_number).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
  if (!match_number) errors.push('match_number wajib diisi');
  else if (match_number.length > 80) errors.push(`match_number "${match_number}" terlalu panjang (maksimal 80 karakter)`);

  const baseCategory = str(r.category_name);
  const roundName = str(r.round_name);
  const category_name = baseCategory && roundName && !baseCategory.toLowerCase().includes(roundName.toLowerCase())
    ? `${baseCategory} - ${roundName}`
    : (baseCategory || roundName);

  const sideA = parseTeamSide(r.team_a_raw, r.team_a_p1_name, r.team_a_p2_name, r.team_a_club, r.team_a_details);
  const sideB = parseTeamSide(r.team_b_raw, r.team_b_p1_name, r.team_b_p2_name, r.team_b_club, r.team_b_details);

  const discipline = inferDiscipline(r.discipline, category_name, sideA.hasPair || sideB.hasPair);
  if (!DISCIPLINES.includes(discipline)) errors.push(`discipline "${r.discipline ?? ''}" harus salah satu dari ${DISCIPLINES.join('/')}`);

  const rawMethod = str(r.scoring_method).toLowerCase().replace(/[\s-]/g, '_');
  const scoring_method = rawMethod || preset?.scoring_method || '';
  if (!SCORING_METHODS.includes(scoring_method)) errors.push(`scoring_method harus rally_point atau side_out`);

  const rawType = str(r.scoring_type).toLowerCase();
  const scoring_type = rawType || preset?.scoring_type || '';
  if (!SCORING_TYPES.includes(scoring_type)) errors.push(`scoring_type harus sets atau continuous`);

  const winRaw = str(r.win_point);
  const win_point = winRaw !== '' ? parseInt(winRaw, 10) : (preset ? preset.win_point : NaN);
  if (!Number.isInteger(win_point) || win_point < 1 || win_point > 150) errors.push('win_point harus bilangan bulat 1-150');

  const intervalRaw = str(r.interval_point);
  const interval_point = intervalRaw !== '' ? parseInt(intervalRaw, 10) : (preset ? preset.interval_point : 0);
  if (!Number.isInteger(interval_point) || interval_point < 0) errors.push('interval_point harus bilangan bulat >= 0');
  else if (Number.isInteger(win_point) && interval_point >= win_point) errors.push('interval_point harus lebih kecil dari win_point');

  const maxRaw = str(r.max_point);
  const max_point = maxRaw !== '' ? parseInt(maxRaw, 10) : (preset?.max_point ?? null);
  if (maxRaw !== '' && (!Number.isInteger(max_point) || max_point < win_point)) errors.push('max_point harus >= win_point');

  const dbl = isDoubles(discipline);
  const a1 = sideA.p1;
  const b1 = sideB.p1;
  const a2 = sideA.p2;
  const b2 = sideB.p2;
  if (!a1) errors.push('team_a_p1_name wajib diisi');
  if (!b1) errors.push('team_b_p1_name wajib diisi');
  if (dbl && !a2) errors.push('team_a_p2_name wajib untuk ganda');
  if (dbl && !b2) errors.push('team_b_p2_name wajib untuk ganda');

  const court_number = parseCourtNumber(r.court_number, defaults?.courtNumber);
  if (!Number.isInteger(court_number) || court_number < 1 || court_number > courtCount) errors.push(`court_number harus 1-${courtCount}`);

  const match = {
    match_number,
    tournament_name: str(r.tournament_name) || str(defaults?.tournamentName),
    category_name,
    discipline,
    scheduled_date: str(r.scheduled_date || r.date || r.tanggal),
    scheduled_time: str(r.scheduled_time),
    court_number,
    rules: { scoring_method, scoring_type, win_point, interval_point, max_point },
    teams: {
      team_a: { id: 't_A', p1: a1, p2: dbl ? a2 : null, club: sideA.club, details: sideA.details },
      team_b: { id: 't_B', p1: b1, p2: dbl ? b2 : null, club: sideB.club, details: sideB.details },
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
