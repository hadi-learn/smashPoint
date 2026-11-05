import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Store, StoreError } from '../lib/server/store.js';
import { AdminAuth } from '../lib/server/auth.js';
import { ingest } from '../lib/server/ingest.js';
import { breakCountdownInfo, BWF_INTERVAL_SECONDS, BWF_SET_BREAK_SECONDS, parseScheduleDateValue } from '../lib/engine.js';

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

  // 9. Test Admin full match edit (players, club, score, status -> finished due to disqualification)
  let exportedMatch = null;
  store.on('finished', (m) => {
    exportedMatch = m;
  });
  const edited = store.adminUpdate('M-101', {
    teams: {
      team_a: { p1: 'Budi Baru', p2: 'Agus Baru', club: 'PB Juara' },
    },
    score: { a: 0, b: 30 },
    set_history: [{ set: 1, a: 0, b: 30, winner: 'b' }],
    winner: 'b',
    status: 'finished',
    admin_note: 'Tim A didiskualifikasi',
  });
  assert.equal(edited.teams.team_a.p1, 'Budi Baru');
  assert.equal(edited.teams.team_a.club, 'PB Juara');
  assert.equal(edited.session_management.status, 'finished');
  assert.equal(edited.live_state.winner, 'b');
  assert.equal(edited.live_state.score.b, 30);
  assert.ok(exportedMatch);

  // Clean up
  store.flush();
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('AdminAuth RBAC (Super Admin vs Admin Operasional) & Mandatory Referee Name', () => {
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  fs.mkdirSync(testDir, { recursive: true });

  const auth = new AdminAuth({
    dataDir: testDir,
    defaultUsername: 'admin',
    defaultPassword: '1234',
  });

  // 1. Default Super Admin login
  const superSession = auth.login('admin', '1234');
  assert.equal(superSession.user.role, 'super_admin');
  assert.ok(superSession.token);

  // 2. Super Admin creates an Operational Admin ('panitia1')
  const created = auth.createUser(superSession.user, {
    username: 'panitia1',
    display_name: 'Panitia Lapangan',
    password: 'abcd',
    role: 'admin',
  });
  assert.equal(created.username, 'panitia1');
  assert.equal(created.role, 'admin');

  // 3. Operational Admin logs in & can change their own password
  const opSession = auth.login('panitia1', 'abcd');
  assert.equal(opSession.user.role, 'admin');
  auth.changeOwnPassword('panitia1', {
    currentPassword: 'abcd',
    newPassword: 'efgh',
    displayName: 'Panitia Senior',
  });
  const opReLogin = auth.login('panitia1', 'efgh');
  assert.equal(opReLogin.user.display_name, 'Panitia Senior');

  // 4. Operational Admin CANNOT create or delete users
  assert.throws(() => {
    auth.createUser(opSession.user, {
      username: 'hacker',
      password: '1234',
      role: 'super_admin',
    });
  }, /Hanya Super Admin/);

  assert.throws(() => {
    auth.deleteUser(opSession.user, 'admin');
  }, /Hanya Super Admin/);

  // 5. Mandatory Referee Name on Store.lock + BWF Break Countdown
  const store = new Store({
    dataDir: testDir,
    courtCount: 15,
    lockTimeoutMs: 1000,
    masterPin: '1234',
  });
  const sampleCsv = `match_number,tournament_name,category_name,discipline,scoring_method,scoring_type,win_point,interval_point,team_a_p1_name,team_a_p2_name,team_a_club,team_a_details,team_b_p1_name,team_b_p2_name,team_b_club,team_b_details,scheduled_date,court_number,scheduled_time
M-201,Pak Pele Cup 3,Dewasa,MS,rally_point,sets,21,11,Ginting,,SGS,1,Jonatan,,Tangkas,2,2026-10-20,1,14:00 WIB`;
  store.upsertMatches(ingest(sampleCsv, { courtCount: 15 }).matches);

  // Locking without referee name throws missing_referee_name
  assert.throws(() => {
    store.lock('M-201', 'uuid-device-ref-1', '   ');
  }, /Identitas Nama Wasit wajib diisi/);

  const lockOk = store.lock('M-201', 'uuid-device-ref-1', 'Wasit Ahmad');
  assert.equal(lockOk.match.session_management.controller_label, 'Wasit Ahmad');

  // Verify BWF Interval (60s) and Set Break (120s) constants
  assert.equal(BWF_INTERVAL_SECONDS, 60);
  assert.equal(BWF_SET_BREAK_SECONDS, 120);
  const startMs = Date.now();
  const fakeMatch = {
    live_state: {
      phase: 'interval',
      break_started_at: new Date(startMs).toISOString(),
    },
  };
  const info = breakCountdownInfo(fakeMatch, startMs + 42000);
  assert.equal(info.targetSec, 60);
  assert.equal(info.remainingSec, 18);
  assert.equal(info.callWarning, true);

  store.flush();
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('Special Character Match Numbers (A-B#1, C-D#11, E-F#7) & Natural Sorting', () => {
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  fs.mkdirSync(testDir, { recursive: true });

  const store = new Store({
    dataDir: testDir,
    courtCount: 15,
    lockTimeoutMs: 1000,
    masterPin: '1234',
  });

  const sampleCsv = `match_number,tournament_name,category_name,discipline,scoring_method,scoring_type,win_point,interval_point,team_a_p1_name,team_a_p2_name,team_a_club,team_a_details,team_b_p1_name,team_b_p2_name,team_b_club,team_b_details,scheduled_date,court_number,scheduled_time
C-D#11,Pak Pele Cup 3,Veteran U-110,MD,side_out,continuous,30,15,Budi,Agus,Djarum,Seed 1,Hendro,Rudy,Jaya Raya,Seed 2,2026-10-20,1,14:00 WIB
A-B#1,Pak Pele Cup 3,Veteran U-110,MD,side_out,continuous,30,15,Taufik,Alan,Mutiara,[3/4],Sigit,Candra,Exist,,2026-10-20,1,14:00 WIB
A-B#2,Pak Pele Cup 3,Veteran U-110,MD,side_out,continuous,30,15,Liem,Icuk,Djarum,,Rexy,Ricky,Jaya Raya,,2026-10-20,1,14:00 WIB
A-B#10,Pak Pele Cup 3,Veteran U-110,MD,side_out,continuous,30,15,Hendra,Ahsan,Djarum,,Fajar,Rian,SGS,,2026-10-20,1,14:00 WIB
E-F#7,Pak Pele Cup 3,Dewasa,MS,rally_point,sets,21,11,Ginting,,SGS,1,Jonatan,,Tangkas,2,2026-10-20,1,14:00 WIB`;

  const parsed = ingest(sampleCsv, { courtCount: 15 });
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.matches.length, 5);

  const upRes = store.upsertMatches(parsed.matches);
  assert.equal(upRes.created, 5);

  // Verify natural sorting on same court & time: A-B#1, A-B#2, A-B#10, C-D#11, E-F#7
  const list = store.list({ court: 1 });
  assert.deepEqual(
    list.map((m) => m.match_number),
    ['A-B#1', 'A-B#2', 'A-B#10', 'C-D#11', 'E-F#7']
  );

  // Verify lookup and lock with # character
  const locked = store.lock('a-b#1', 'uuid-device-tablet-X', 'Tablet 1');
  assert.equal(locked.mode, 'controller');
  assert.equal(locked.match.match_number, 'A-B#1');

  // Verify Indonesian text date parsing ("Sabtu / 7 November 2026" < "Minggu / 8 November 2026" < "Kamis / 12 November 2026")
  const d1 = parseScheduleDateValue('Sabtu / 7 November 2026');
  const d2 = parseScheduleDateValue('Minggu / 8 November 2026');
  const d3 = parseScheduleDateValue('Kamis / 12 November 2026');
  assert.equal(d1, 20261107);
  assert.equal(d2, 20261108);
  assert.equal(d3, 20261112);
  assert.ok(d1 < d2 && d2 < d3);

  store.flush();
  fs.rmSync(testDir, { recursive: true, force: true });
});
