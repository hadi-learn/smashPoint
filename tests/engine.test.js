import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, initialLiveState, courtPositions, getRecentRallies } from '../lib/engine.js';

function mk(discipline, scoring_method, scoring_type = 'sets', win_point = 21, interval_point = 11) {
  const dbl = ['MD', 'WD', 'XD'].includes(discipline);
  return {
    match_number: 'T-1',
    discipline,
    rules: { scoring_method, scoring_type, win_point, interval_point, max_point: null },
    teams: {
      team_a: { p1: 'Budi', p2: dbl ? 'Agus' : null, club: 'A' },
      team_b: { p1: 'Hendro', p2: dbl ? 'Rudy' : null, club: 'B' },
    },
    court_number: 3,
    live_state: initialLiveState(),
  };
}
function act(m, type, payload) {
  const r = applyAction(m, { type, payload });
  m.live_state = r.live_state;
  m.teams = r.teams;
  return r;
}
const start = (m, server = 'a1', receiver = 'b1') =>
  act(m, 'SETUP_START', { left: 'a', positions: { a: { even: 'a1', odd: 'a2' }, b: { even: 'b1', odd: 'b2' } }, server_id: server, receiver_id: receiver });

test('rally point doubles: serving team wins -> server switches court', () => {
  const m = mk('MD', 'rally_point');
  start(m);
  act(m, 'WIN_RALLY', { side: 'left' });
  const st = m.live_state;
  assert.deepEqual(st.score, { a: 1, b: 0 });
  assert.equal(st.service_status.player_id, 'a1');
  assert.deepEqual(st.positions.a, { even: 'a2', odd: 'a1' });
  assert.equal(st.service_status.receiver_id, 'b2'); // diagonal odd court
});

test('rally point doubles: receiving team wins -> serve passes by parity', () => {
  const m = mk('MD', 'rally_point');
  start(m);
  act(m, 'WIN_RALLY', { team: 'b' });
  const ss = m.live_state.service_status;
  assert.equal(ss.side, 'b');
  assert.equal(ss.player_id, 'b2'); // b score 1 -> odd court -> b2
  assert.equal(ss.receiver_id, 'a2');
  assert.deepEqual(m.live_state.positions.b, { even: 'b1', odd: 'b2' });
});

test('side out doubles: opening serve starts at 2nd serve, then opponent gets 1st -> 2nd -> side-out', () => {
  const m = mk('MD', 'side_out', 'continuous', 30, 15);
  start(m);
  // Opening serve of the match starts directly at 2nd serve (turn === 2)
  assert.equal(m.live_state.service_status.turn, 2);
  assert.equal(m.live_state.service_status.player_id, 'a1');

  // Team A loses opening rally -> immediately side-out to Team B as 1st serve
  let r = act(m, 'WIN_RALLY', { team: 'b' });
  assert.equal(r.event_type, 'SIDE_OUT');
  assert.deepEqual(m.live_state.score, { a: 0, b: 0 });
  assert.equal(m.live_state.service_status.side, 'b');
  assert.equal(m.live_state.service_status.turn, 1);
  assert.equal(m.live_state.service_status.player_id, 'b1');

  // Team B wins a point on 1st serve -> stays 1st serve, switches court
  act(m, 'WIN_RALLY', { team: 'b' });
  assert.deepEqual(m.live_state.score, { a: 0, b: 1 });
  assert.equal(m.live_state.service_status.turn, 1);

  // Team B loses 1st serve -> moves to 2nd serve (partner b2)
  r = act(m, 'WIN_RALLY', { team: 'a' });
  assert.equal(r.event_type, 'SIDE_OUT_2ND');
  assert.equal(m.live_state.service_status.side, 'b');
  assert.equal(m.live_state.service_status.turn, 2);
  assert.equal(m.live_state.service_status.player_id, 'b2');

  // Team B loses 2nd serve -> side-out back to Team A as 1st serve
  r = act(m, 'WIN_RALLY', { team: 'a' });
  assert.equal(r.event_type, 'SIDE_OUT');
  assert.equal(m.live_state.service_status.side, 'a');
  assert.equal(m.live_state.service_status.turn, 1);
});

test('interval at interval_point locks scoring and swaps on continuous', () => {
  const m = mk('MS', 'rally_point', 'continuous', 30, 15);
  start(m);
  for (let i = 0; i < 15; i += 1) act(m, 'WIN_RALLY', { team: 'a' });
  assert.equal(m.live_state.phase, 'interval');
  assert.throws(() => act(m, 'WIN_RALLY', { team: 'a' }));
  act(m, 'CONFIRM_INTERVAL');
  assert.equal(m.live_state.sides.left, 'b');
  assert.equal(m.live_state.phase, 'live');
});

test('sets: deuce, set break, next set, finish', () => {
  const m = mk('MS', 'rally_point', 'sets', 21, 11);
  start(m);
  const play = (t, n) => {
    for (let i = 0; i < n; i += 1) {
      if (m.live_state.phase === 'interval') act(m, 'CONFIRM_INTERVAL');
      act(m, 'WIN_RALLY', { team: t });
    }
  };
  play('a', 20);
  play('b', 20);
  assert.equal(m.live_state.phase, 'live'); // 20-20
  play('a', 1);
  assert.equal(m.live_state.phase, 'live'); // 21-20 deuce
  play('a', 1);
  assert.equal(m.live_state.phase, 'set_break');
  assert.deepEqual(m.live_state.sets, { a: 1, b: 0 });
  act(m, 'NEXT_SET');
  assert.equal(m.live_state.phase, 'setup');
  assert.equal(m.live_state.sides.left, 'b');
  act(m, 'SETUP_START', { left: 'b', server_id: 'a1' });
  play('a', 21);
  assert.equal(m.live_state.phase, 'finished');
  assert.equal(m.live_state.winner, 'a');
});

test('screen positions mapping', () => {
  const m = mk('MD', 'rally_point');
  start(m);
  const cp = courtPositions(m);
  assert.equal(cp.left_bottom, 'a1'); // left team right court = bottom
  assert.equal(cp.right_top, 'b1'); // right team right court = top
});


test('Rally & Serve History tracking: records winner, server, second serve, side out, and recent rallies', () => {
  const m = mk('MD', 'rally_point');
  start(m);

  // Initial check: empty history
  assert.deepEqual(m.live_state.rally_history, []);
  assert.deepEqual(getRecentRallies(m, 10), []);

  // 1. Serving team A wins rally -> score 1-0, server_won: true, side_out: false
  act(m, 'WIN_RALLY', { team: 'a' });
  assert.equal(m.live_state.rally_history.length, 1);
  const r1 = m.live_state.rally_history[0];
  assert.equal(r1.rally_number, 1);
  assert.equal(r1.server_side, 'a');
  assert.equal(r1.winner, 'a');
  assert.equal(r1.server_won, true);
  assert.equal(r1.side_out, false);
  assert.deepEqual(r1.score, { a: 1, b: 0 });
  assert.deepEqual(r1.point_delta, { a: 1, b: 0 });

  // 2. Receiving team B wins rally -> score 1-1, server_won: false, side_out: true (pindah servis)
  act(m, 'WIN_RALLY', { team: 'b' });
  assert.equal(m.live_state.rally_history.length, 2);
  const r2 = m.live_state.rally_history[1];
  assert.equal(r2.rally_number, 2);
  assert.equal(r2.server_side, 'a');
  assert.equal(r2.winner, 'b');
  assert.equal(r2.server_won, false);
  assert.equal(r2.side_out, true);
  assert.deepEqual(r2.score, { a: 1, b: 1 });
  assert.deepEqual(r2.point_delta, { a: 0, b: 1 });

  // 3. Team B is now serving and wins rally -> score 1-2
  act(m, 'WIN_RALLY', { team: 'b' });
  assert.equal(m.live_state.rally_history.length, 3);
  const r3 = m.live_state.rally_history[2];
  assert.equal(r3.server_side, 'b');
  assert.equal(r3.winner, 'b');
  assert.equal(r3.server_won, true);
  assert.deepEqual(r3.score, { a: 1, b: 2 });

  // Play 10 more rallies
  for (let i = 0; i < 10; i += 1) {
    act(m, 'WIN_RALLY', { team: i % 2 === 0 ? 'a' : 'b' });
  }
  assert.equal(m.live_state.rally_history.length, 13);

  // getRecentRallies(m, 10) returns only the last 10 rallies
  const last10 = getRecentRallies(m, 10);
  assert.equal(last10.length, 10);
  assert.equal(last10[0].rally_number, 4);
  assert.equal(last10[9].rally_number, 13);
});

test('Side-Out Doubles: records 2nd serve and side out correctly in rally history', () => {
  const m = mk('MD', 'side_out', 'continuous', 30, 15);
  start(m);

  // In side-out doubles opening serve, Team A starts at 2nd serve
  // Rally 1: Team A loses rally -> side-out to Team B (no score change)
  act(m, 'WIN_RALLY', { team: 'b' });
  assert.equal(m.live_state.rally_history.length, 1);
  const r1 = m.live_state.rally_history[0];
  assert.equal(r1.server_side, 'a');
  assert.equal(r1.server_turn, 2);
  assert.equal(r1.winner, 'b');
  assert.equal(r1.side_out, true);
  assert.deepEqual(r1.score, { a: 0, b: 0 });

  // Rally 2: Team B serving 1st serve, wins rally -> score 0-1
  act(m, 'WIN_RALLY', { team: 'b' });
  const r2 = m.live_state.rally_history[1];
  assert.equal(r2.server_side, 'b');
  assert.equal(r2.server_turn, 1);
  assert.equal(r2.winner, 'b');
  assert.equal(r2.server_won, true);
  assert.deepEqual(r2.score, { a: 0, b: 1 });

  // Rally 3: Team B loses rally -> moves to 2nd serve of Team B (no score change)
  act(m, 'WIN_RALLY', { team: 'a' });
  const r3 = m.live_state.rally_history[2];
  assert.equal(r3.server_side, 'b');
  assert.equal(r3.second_serve, true);
  assert.equal(r3.event, 'SIDE_OUT_2ND');
  assert.deepEqual(r3.score, { a: 0, b: 1 });
});
