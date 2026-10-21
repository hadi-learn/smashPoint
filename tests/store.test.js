import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Store, StoreError } from '../lib/server/store.js';
import { ingest } from '../lib/server/ingest.js';

const testDir = path.join(process.cwd(), 'tests', 'temp_store_test');

test('Store & Conflict Resolution Lifecycle', () => {
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  fs.mkdirSync(testDir, { recursive: true });

  const store = new Store({
    dataDir: testDir,
    courtCount: 15,
    lockTimeoutMs: 1000, // 1 sec for testing sweep
    masterPin: '1234',
  });

  const sampleCsv = `match_number,tournament_name,category_name,discipline,scoring_method,scoring_type,win_point,interval_point,team_a_p1_name,team_a_p2_name,team_a_club,team_a_details,team_b_p1_name,team_b_p2_name,team_b_club,team_b_details,scheduled_date,court_number,scheduled_time
M-101,Pak Pele Cup 3,Veteran U-110,MD,side_out,continuous,30,15,Budi,Agus,Djarum,,Hendro,Rudy,Jaya Raya,,2026-10-20,3,14:30 WIB`;

  const parsed = ingest(sampleCsv, { courtCount: 15 });
  assert.equal(parsed.matches.length, 1);
  const upRes = store.upsertMatches(parsed.matches);
  assert.equal(upRes.created, 1);

  // 1. Tablet A locks match
  const devA = 'uuid-device-tablet-A';
  const lockA = store.lock('M-101', devA, 'Tablet Lapangan 3');
  assert.equal(lockA.mode, 'controller');
  assert.equal(lockA.match.session_management.status, 'locked');

  // 2. Tablet B attempts to lock -> rejected into Spectator mode
  const devB = 'uuid-device-tablet-B';
  const lockB = store.lock('M-101', devB, 'Tablet Cadangan');
  assert.equal(lockB.mode, 'spectator');
  assert.equal(lockB.reason, 'locked_by_other');

  // 3. Tablet B attempts Takeover with wrong PIN -> fails
  assert.throws(() => {
    store.takeover('M-101', devB, 'Tablet Cadangan', '9999');
  }, /Master PIN salah/);

  // 4. Tablet B Takeover with correct PIN -> succeeds
  let kickedDev = null;
  store.on('kick', (devId) => {
    kickedDev = devId;
  });
  const toRes = store.takeover('M-101', devB, 'Tablet Cadangan', '1234');
  assert.equal(toRes.mode, 'controller');
  assert.equal(kickedDev, devA);

  // 5. Tablet B initiates game setup
  const initAct = store.action('M-101', devB, {
    type: 'SETUP_START',
    last_log_id: toRes.match.last_log_id,
    payload: {
      left: 'a',
      positions: { a: { even: 'a1', odd: 'a2' }, b: { even: 'b1', odd: 'b2' } },
      server_id: 'a1',
      receiver_id: 'b1',
    },
  });
  assert.equal(initAct.ok, true);
  assert.equal(initAct.match.live_state.phase, 'live');

  // 6. Test Idempotency: repeating same last_log_id after processed should be rejected as duplicate/stale
  const staleAct = store.action('M-101', devB, {
    type: 'WIN_RALLY',
    last_log_id: toRes.match.last_log_id, // old log ID
    payload: { side: 'left' },
  });
  assert.equal(staleAct.duplicate, true);

  // 7. Legitimate score increment
  const scoreAct = store.action('M-101', devB, {
    type: 'WIN_RALLY',
    last_log_id: initAct.match.last_log_id,
    payload: { side: 'left' },
  });
  assert.equal(scoreAct.ok, true);
  assert.equal(scoreAct.match.live_state.score.a, 1);

  // 8. Test UNDO
  const undoAct = store.action('M-101', devB, {
    type: 'UNDO',
    last_log_id: scoreAct.match.last_log_id,
  });
  assert.equal(undoAct.ok, true);
  assert.equal(undoAct.match.live_state.score.a, 0);

  // Clean up
  store.flush();
  fs.rmSync(testDir, { recursive: true, force: true });
});
