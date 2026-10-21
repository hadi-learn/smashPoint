import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, initialLiveState, courtPositions } from '../lib/engine.js';

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
