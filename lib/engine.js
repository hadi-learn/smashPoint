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

export function validPlayerIds(match) {
  return isDoubles(match) ? ['a1', 'a2', 'b1', 'b2'] : ['a1', 'b1'];
}

export function initialLiveState() {
  return {
    phase: 'setup', // setup | live | interval | set_break | finished
    current_set: 1,
    score: { a: 0, b: 0 },
    sets: { a: 0, b: 0 },
    set_history: [],
    sides: { left: 'a', right: 'b' },
    positions: { a: { even: 'a1', odd: 'a2' }, b: { even: 'b1', odd: 'b2' } },
    service_status: { side: null, turn: 1, player_id: null, receiver_id: null },
    interval_done: false,
    interval_swap: false,
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
        st.ended_at = new Date().toISOString();
      } else {
        st.phase = 'set_break';
        st.game_winner = gw;
      }
    } else {
      st.phase = 'finished';
      st.winner = gw;
      st.ended_at = new Date().toISOString();
    }
    return gw;
  }
  const ip = Number(match.rules.interval_point) || 0;
  if (!st.interval_done && ip > 0 && ip < match.rules.win_point && (st.score.a === ip || st.score.b === ip)) {
    st.phase = 'interval';
    st.interval_done = true;
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
      if (!st.started_at) st.started_at = new Date().toISOString();
      event_type = st.current_set > 1 ? 'START_SET' : 'START_MATCH';
      const lt = st.sides.left;
      const turnNote = match.rules.scoring_method === 'side_out' && dbl ? ` (${turnLabel(initialTurn)} Serve)` : '';
      details = `${st.current_set > 1 ? `Mulai Set ${st.current_set}` : 'Mulai Laga'}. Kiri: Tim ${T(lt)}, Kanan: Tim ${T(other(lt))}. Servis: ${playerName(match, server)}${turnNote} -> Penerima: ${playerName(match, receiver)}`;
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
        }
        changes.push(`Nama: A=${teamLabel({ ...match, teams }, 'a')} (${teams.team_a.club || '-'}), B=${teamLabel({ ...match, teams }, 'b')} (${teams.team_b.club || '-'})`);
      }
      if (p.court_number !== undefined) {
        const c = parseInt(p.court_number, 10);
        if (!Number.isInteger(c) || c < 1 || c > 99) throw new EngineError('Nomor lapangan tidak valid');
        court_number = c;
        changes.push(`Lapangan: ${c}`);
      }
      const scoringEdit = p.score || p.service || p.positions;
      if (scoringEdit) {
        if (!['live', 'interval'].includes(st.phase)) throw new EngineError('Koreksi skor/servis hanya saat laga berlangsung');
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
