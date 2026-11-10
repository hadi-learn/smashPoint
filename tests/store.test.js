import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Store, StoreError } from '../lib/server/store.js';
import { AdminAuth } from '../lib/server/auth.js';
import { ProfileManager } from '../lib/server/profiles.js';
import { SheetsExporter, resultRow, formatLogRow, RESULT_HEADER, LOG_HEADER } from '../lib/server/sheetsExporter.js';
import { ingest } from '../lib/server/ingest.js';
import {
  breakCountdownInfo,
  BWF_INTERVAL_SECONDS,
  BWF_SET_BREAK_SECONDS,
  parseScheduleDateValue,
  parseScheduleDateToIso,
  formatIsoToIndonesianDate,
  parseScheduleTimeToPicker,
  formatPickerToScheduleTime,
} from '../lib/engine.js';

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

test('Multi-Tournament Profile System (Save, Switch & Resume Progress Across Profiles)', () => {
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  const legacyDataDir = path.join(testDir, 'data');
  fs.mkdirSync(legacyDataDir, { recursive: true });

  // 0. Create legacy root data/db.json to verify seamless auto-migration into 'default' profile
  const legacyStore = new Store({
    dataDir: legacyDataDir,
    courtCount: 15,
    lockTimeoutMs: 1000,
    masterPin: '1234',
  });
  const csvPagi = `match_number,tournament_name,category_name,discipline,scoring_method,scoring_type,win_point,interval_point,team_a_p1_name,team_a_p2_name,team_a_club,team_a_details,team_b_p1_name,team_b_p2_name,team_b_club,team_b_details,scheduled_date,court_number,scheduled_time
PAGI-01,Turnamen Pagi,Ganda Putra,MD,rally_point,sets,21,11,Fajar,Rian,SGS,1,Leo,Daniel,Djarum,2,Sabtu / 7 November 2026,1,08:00 WIB`;
  legacyStore.upsertMatches(ingest(csvPagi, { courtCount: 15 }).matches);
  legacyStore.flush();

  // 1. Initialize ProfileManager -> should migrate data/db.json into data/profiles/default/db.json
  const pm = new ProfileManager({ rootDir: testDir });
  const activeDefault = pm.activeProfile();
  assert.equal(activeDefault.id, 'default');
  assert.equal(activeDefault.name, 'Turnamen Pagi');

  const store = new Store({
    dataDir: pm.dataDirFor(activeDefault.id),
    courtCount: 15,
    lockTimeoutMs: 1000,
    masterPin: '1234',
  });
  const exporter = new SheetsExporter({
    exportDir: pm.exportDirFor(activeDefault.id),
    dataDir: pm.dataDirFor(activeDefault.id),
  });

  // Verify PAGI-01 was migrated and start scoring in Profile A (default / Turnamen Pagi)
  assert.equal(store.list().length, 1);
  pm.update('default', { name: 'Turnamen A (Pagi)', description: 'Sesi Pagi 08:00-12:00' });

  const lockA = store.lock('PAGI-01', 'dev-ref-1', 'Wasit Pagi');
  const setupA = store.action('PAGI-01', 'dev-ref-1', {
    type: 'SETUP_START',
    last_log_id: lockA.match.last_log_id,
    payload: {
      left: 'a',
      positions: { a: { even: 'a1', odd: 'a2' }, b: { even: 'b1', odd: 'b2' } },
      server_id: 'a1',
      receiver_id: 'b1',
    },
  });
  const rally1 = store.action('PAGI-01', 'dev-ref-1', {
    type: 'WIN_RALLY',
    last_log_id: setupA.match.last_log_id,
    payload: { side: 'left' },
  });
  const rally2 = store.action('PAGI-01', 'dev-ref-1', {
    type: 'WIN_RALLY',
    last_log_id: rally1.match.last_log_id,
    payload: { side: 'left' },
  });
  assert.equal(rally2.match.live_state.score.a, 2);
  assert.equal(rally2.match.live_state.score.b, 0);

  // 2. Create Tournament Profile B (Siang/Sore) & switch to it
  const profileB = pm.create({
    name: 'Turnamen B (Siang-Sore)',
    description: 'Sesi Siang 13:00-17:00',
    createdBy: 'panitia1',
  });
  pm.setActive(profileB.id);
  store.switchDataDir(pm.dataDirFor(profileB.id));
  exporter.switchProfile({
    exportDir: pm.exportDirFor(profileB.id),
    dataDir: pm.dataDirFor(profileB.id),
  });

  // Profile B starts completely clean
  assert.equal(store.list().length, 0);

  const csvSiang = `match_number,tournament_name,category_name,discipline,scoring_method,scoring_type,win_point,interval_point,team_a_p1_name,team_a_p2_name,team_a_club,team_a_details,team_b_p1_name,team_b_p2_name,team_b_club,team_b_details,scheduled_date,court_number,scheduled_time
SIANG-01,Turnamen Siang,Tunggal Putra,MS,rally_point,sets,21,11,Ginting,,SGS,1,Jonatan,,Tangkas,2,Sabtu / 7 November 2026,1,13:00 WIB
SIANG-02,Turnamen Siang,Tunggal Putri,WS,rally_point,sets,21,11,Gregoria,,Mutiara,1,Putri KW,,Exist,2,Sabtu / 7 November 2026,2,13:30 WIB`;
  store.upsertMatches(ingest(csvSiang, { courtCount: 15 }).matches);
  assert.equal(store.list().length, 2);

  // Play SIANG-01 to 0-1 in Profile B
  const lockB = store.lock('SIANG-01', 'dev-ref-2', 'Wasit Siang');
  const setupB = store.action('SIANG-01', 'dev-ref-2', {
    type: 'SETUP_START',
    last_log_id: lockB.match.last_log_id,
    payload: {
      left: 'a',
      positions: { a: { even: 'a1', odd: null }, b: { even: 'b1', odd: null } },
      server_id: 'a1',
      receiver_id: 'b1',
    },
  });
  const scoreB = store.action('SIANG-01', 'dev-ref-2', {
    type: 'WIN_RALLY',
    last_log_id: setupB.match.last_log_id,
    payload: { side: 'right' },
  });
  assert.equal(scoreB.match.live_state.score.b, 1);

  // 3. Create Tournament Profile C (Malam) & switch to it
  const profileC = pm.create({
    name: 'Turnamen C (Malam)',
    description: 'Sesi Malam 19:00-23:00',
    createdBy: 'admin',
  });
  pm.setActive(profileC.id);
  store.switchDataDir(pm.dataDirFor(profileC.id));
  assert.equal(store.list().length, 0);

  // Verify summaries across all 3 profiles
  const allProfiles = pm.list(store);
  assert.equal(allProfiles.length, 3);
  const sumA = allProfiles.find((p) => p.id === 'default');
  const sumB = allProfiles.find((p) => p.id === profileB.id);
  const sumC = allProfiles.find((p) => p.id === profileC.id);
  assert.equal(sumA.stats.total, 1);
  assert.equal(sumA.stats.live, 1);
  assert.equal(sumB.stats.total, 2);
  assert.equal(sumB.stats.live, 1);
  assert.equal(sumC.stats.total, 0);

  // 4. Switch back to Profile A (Turnamen Pagi) -> progress (score 2-0, logs, undo stack) must resume seamlessly!
  pm.setActive('default');
  store.switchDataDir(pm.dataDirFor('default'));
  assert.equal(store.list().length, 1);
  const resumedA = store.get('PAGI-01');
  assert.ok(resumedA);
  assert.equal(resumedA.live_state.phase, 'live');
  assert.equal(resumedA.live_state.score.a, 2);
  assert.equal(resumedA.live_state.score.b, 0);
  assert.ok(store.getLogs('PAGI-01').length >= 3);

  // Continue scoring in Profile A -> 3-0
  const rally3 = store.action('PAGI-01', 'dev-ref-1', {
    type: 'WIN_RALLY',
    last_log_id: resumedA.last_log_id,
    payload: { side: 'left' },
  });
  assert.equal(rally3.match.live_state.score.a, 3);

  // 5. Switch back to Profile B -> verify SIANG-01 is still at 0-1
  pm.setActive(profileB.id);
  store.switchDataDir(pm.dataDirFor(profileB.id));
  assert.equal(store.list().length, 2);
  const resumedB = store.get('SIANG-01');
  assert.equal(resumedB.live_state.score.a, 0);
  assert.equal(resumedB.live_state.score.b, 1);

  // Active profile cannot be deleted, inactive profile C can be deleted
  assert.throws(() => pm.delete(profileB.id), /sedang aktif/);
  pm.delete(profileC.id);
  assert.equal(pm.list(store).length, 2);

  store.flush();
  fs.rmSync(testDir, { recursive: true, force: true });
});


test('Option 2: Admin Manual Edit Override Lock & Sheet Auto-Sync Protection', () => {
  const syncTestDir = path.join(process.cwd(), 'tests', 'temp_sync_override_test');
  if (fs.existsSync(syncTestDir)) fs.rmSync(syncTestDir, { recursive: true, force: true });
  fs.mkdirSync(syncTestDir, { recursive: true });

  const store = new Store({
    dataDir: syncTestDir,
    courtCount: 15,
    lockTimeoutMs: 1000,
    masterPin: '1234',
  });

  // 1. Initial Google Sheet import data
  const sheetInitialCsv = `match_number,tournament_name,category_name,discipline,scoring_method,scoring_type,win_point,interval_point,team_a_p1_name,team_a_p2_name,team_a_club,team_a_details,team_b_p1_name,team_b_p2_name,team_b_club,team_b_details,scheduled_date,court_number,scheduled_time
M-201,Piala Walikota,Ganda Putra Open,MD,rally_point,sets,21,11,Kevin,Marcus,Djarum,,Fajar,Rian,SGS,,Sabtu / 7 November 2026,2,09:00 WIB
M-202,Piala Walikota,Tunggal Putra Open,MS,rally_point,sets,21,11,Jonatan,,Tangkas,,Ginting,,SGS,,Sabtu / 7 November 2026,3,10:00 WIB`;

  const parsed1 = ingest(sheetInitialCsv, { courtCount: 15 });
  assert.equal(parsed1.matches.length, 2);
  const upRes1 = store.upsertMatches(parsed1.matches);
  assert.equal(upRes1.created, 2);

  // Initial check
  const m201 = store.get('M-201');
  assert.equal(m201.court_number, 2);
  assert.equal(m201.scheduled_time, '09:00 WIB');
  assert.equal(m201.admin_override, null);

  // Test date & time picker helpers
  const isoDate = parseScheduleDateToIso(m201.scheduled_date);
  assert.equal(isoDate, '2026-11-07');
  assert.equal(formatIsoToIndonesianDate('2026-11-08'), 'Minggu / 8 November 2026');
  assert.equal(parseScheduleTimeToPicker(m201.scheduled_time), '09:00');
  assert.equal(formatPickerToScheduleTime('15:45', true), '15:45 WIB');

  // 2. Admin manually edits M-201 via adminUpdate (Opsi 2):
  // Panitia memindahkan ke Court 5, jam 11:30 WIB, dan tanggal 8 November 2026
  const updatedM201 = store.adminUpdate('M-201', {
    court_number: 5,
    scheduled_date: 'Minggu / 8 November 2026',
    scheduled_time: '11:30 WIB',
  }, 'Panitia Pelaksana');

  assert.equal(updatedM201.court_number, 5);
  assert.equal(updatedM201.scheduled_time, '11:30 WIB');
  assert.equal(updatedM201.scheduled_date, 'Minggu / 8 November 2026');
  assert.equal(updatedM201.admin_override.is_edited, true);
  assert.equal(updatedM201.admin_override.edited_by, 'Panitia Pelaksana');

  // 3. Auto-Sync Google Sheets fires with the original spreadsheet content (where M-201 is still Court 2, 09:00 WIB)
  const autoSyncResult = store.upsertMatches(parsed1.matches);
  // Preserved edits should include M-201
  assert.ok(autoSyncResult.preserved_edits.includes('M-201'));

  // Verify M-201 retains manual edits and was NOT overwritten by Google Sheet!
  const afterSyncM201 = store.get('M-201');
  assert.equal(afterSyncM201.court_number, 5, 'Court number must remain 5, not reset to 2');
  assert.equal(afterSyncM201.scheduled_time, '11:30 WIB', 'Time must remain 11:30 WIB, not reset to 09:00 WIB');
  assert.equal(afterSyncM201.scheduled_date, 'Minggu / 8 November 2026');
  assert.equal(afterSyncM201.admin_override.is_edited, true);
  // Sheet differences should be recorded in sheet_diff
  assert.ok(afterSyncM201.sheet_diff);
  assert.equal(afterSyncM201.sheet_diff.court_number.sheet, 2);
  assert.equal(afterSyncM201.sheet_diff.scheduled_time.sheet, '09:00 WIB');

  // Meanwhile, un-edited M-202 remains normal
  const m202 = store.get('M-202');
  assert.equal(m202.admin_override, null);

  // 4. Admin decides to reset override / release lock to follow Google Sheets again
  const unlockedM201 = store.adminResetOverride('M-201');
  assert.equal(unlockedM201.admin_override, null);
  assert.equal(unlockedM201.sheet_diff, null);

  // 5. Subsequent auto-sync now updates M-201 back to Google Sheet value
  const autoSyncResult2 = store.upsertMatches(parsed1.matches);
  assert.equal(autoSyncResult2.preserved_edits.length, 0);
  const resyncedM201 = store.get('M-201');
  assert.equal(resyncedM201.court_number, 2);
  assert.equal(resyncedM201.scheduled_time, '09:00 WIB');
  assert.equal(resyncedM201.scheduled_date, 'Sabtu / 7 November 2026');

  store.flush();
  fs.rmSync(syncTestDir, { recursive: true, force: true });
});


test('Operator On-Demand Toggle: OBS YouTube Rally History display control', () => {
  const toggleDir = path.join(process.cwd(), 'tests', 'temp_toggle_history_test');
  if (fs.existsSync(toggleDir)) fs.rmSync(toggleDir, { recursive: true, force: true });
  fs.mkdirSync(toggleDir, { recursive: true });

  const store = new Store({
    dataDir: toggleDir,
    courtCount: 15,
    lockTimeoutMs: 1000,
    masterPin: '1234',
  });

  const parsed = ingest(`match_number,tournament_name,category_name,discipline,scoring_method,scoring_type,win_point,interval_point,team_a_p1_name,team_a_p2_name,team_a_club,team_a_details,team_b_p1_name,team_b_p2_name,team_b_club,team_b_details,scheduled_date,court_number,scheduled_time
M-301,Kejuaraan Nasional,Ganda Putra,MD,rally_point,sets,21,11,Fajar,Rian,SGS,,Leo,Daniel,Djarum,,2026-11-07,1,08:00 WIB`, { courtCount: 15 });
  store.upsertMatches(parsed.matches);

  // Default: show_rally_history must be false (not continuously visible on YouTube)
  const m = store.get('M-301');
  assert.equal(m.live_state.show_rally_history, false);

  // Operator toggles history ON
  const on = store.toggleOverlayHistory('M-301');
  assert.equal(on.live_state.show_rally_history, true);

  // Operator toggles history OFF
  const off = store.toggleOverlayHistory('M-301');
  assert.equal(off.live_state.show_rally_history, false);

  // Operator forces state ON via adminUpdate patch
  const patched = store.adminUpdate('M-301', { show_rally_history: true });
  assert.equal(patched.live_state.show_rally_history, true);

  store.flush();
  fs.rmSync(toggleDir, { recursive: true, force: true });
});

test('Shuttlecock Counter, Referee Name & Local Time Format in Google Sheets Export', () => {
  const cockDir = path.join(process.cwd(), 'tests', 'temp_cock_export_test');
  if (fs.existsSync(cockDir)) fs.rmSync(cockDir, { recursive: true, force: true });
  fs.mkdirSync(cockDir, { recursive: true });

  const store = new Store({
    dataDir: cockDir,
    courtCount: 15,
    lockTimeoutMs: 1000,
    masterPin: '1234',
  });

  const parsed = ingest(`match_number,tournament_name,category_name,discipline,scoring_method,scoring_type,win_point,interval_point,team_a_p1_name,team_a_p2_name,team_a_club,team_a_details,team_b_p1_name,team_b_p2_name,team_b_club,team_b_details,scheduled_date,court_number,scheduled_time
M-401,Pak Pele Cup,Ganda Putra,MD,rally_point,continuous,2,1,Fajar,Rian,SGS,,Leo,Daniel,Djarum,,2026-11-08,1,10:00 WIB`, { courtCount: 15 });
  store.upsertMatches(parsed.matches);

  const dev = 'uuid-ref-cock-test';
  const locked = store.lock('M-401', dev, 'Wasit Budi Santoso');
  let lastId = locked.match.last_log_id;

  // Start match -> shuttlecock_count starts at 1
  const started = store.action('M-401', dev, {
    type: 'SETUP_START',
    last_log_id: lastId,
    payload: {
      left: 'a',
      positions: { a: { even: 'a1', odd: 'a2' }, b: { even: 'b1', odd: 'b2' } },
      server_id: 'a1',
      receiver_id: 'b1',
    },
  });
  lastId = started.match.last_log_id;
  assert.equal(started.match.live_state.shuttlecock_count, 1);

  // Score 1-0 -> interval
  const r1 = store.action('M-401', dev, {
    type: 'WIN_RALLY',
    last_log_id: lastId,
    payload: { side: 'left' },
  });
  lastId = r1.match.last_log_id;

  // Referee adds 2 shuttlecocks during match -> does not break score UNDO
  const c1 = store.action('M-401', dev, {
    type: 'SHUTTLECOCK',
    last_log_id: lastId,
    payload: { delta: 1 },
  });
  lastId = c1.match.last_log_id;
  const c2 = store.action('M-401', dev, {
    type: 'SHUTTLECOCK',
    last_log_id: lastId,
    payload: { delta: 1 },
  });
  lastId = c2.match.last_log_id;
  assert.equal(c2.match.live_state.shuttlecock_count, 3);

  // If referee clicks UNDO now, it undoes the rally point (back to 0-0), while preserving shuttlecock_count = 3
  const undone = store.action('M-401', dev, {
    type: 'UNDO',
    last_log_id: lastId,
  });
  lastId = undone.match.last_log_id;
  assert.equal(undone.match.live_state.score.a, 0);
  assert.equal(undone.match.live_state.shuttlecock_count, 3);

  // Finish the match: score 1-0 -> confirm interval -> score 2-0 -> confirm finish
  const p1 = store.action('M-401', dev, { type: 'WIN_RALLY', last_log_id: lastId, payload: { team: 'a' } });
  const iv = store.action('M-401', dev, { type: 'CONFIRM_INTERVAL', last_log_id: p1.match.last_log_id });
  const p2 = store.action('M-401', dev, { type: 'WIN_RALLY', last_log_id: iv.match.last_log_id, payload: { team: 'a' } });
  const fin = store.action('M-401', dev, { type: 'CONFIRM_FINISH', last_log_id: p2.match.last_log_id });
  assert.equal(fin.match.session_management.status, 'finished');

  // Check exported resultRow & logs
  const m = store.get('M-401');
  const row = resultRow(m);
  assert.ok(RESULT_HEADER.includes('referee_name'));
  assert.ok(RESULT_HEADER.includes('shuttlecock_count'));
  assert.equal(row.referee_name, 'Wasit Budi Santoso');
  assert.equal(row.shuttlecock_count, 3);
  assert.match(row.started_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.match(row.finished_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

  const logs = store.getLogs('M-401').map((l) => formatLogRow(l, m));
  assert.ok(LOG_HEADER.includes('referee_name'));
  assert.ok(LOG_HEADER.includes('shuttlecock_count'));
  const finishLog = logs[logs.length - 1];
  assert.equal(finishLog.referee_name, 'Wasit Budi Santoso');
  assert.equal(finishLog.shuttlecock_count, 3);
  assert.match(finishLog.timestamp, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

  store.flush();
  fs.rmSync(cockDir, { recursive: true, force: true });
});

test('Cross-Laptop Tournament Progress Continuation: applyRemoteProgress (Results & SmashPoint_State) and Backup Bundle', () => {
  const dirA = path.join(process.cwd(), 'tests', 'temp_store_laptopA');
  const dirB = path.join(process.cwd(), 'tests', 'temp_store_laptopB');
  const dirC = path.join(process.cwd(), 'tests', 'temp_store_laptopC');
  for (const d of [dirA, dirB, dirC]) {
    if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
    fs.mkdirSync(d, { recursive: true });
  }

  const scheduleCsv = `match_number,tournament_name,category_name,discipline,scoring_method,scoring_type,win_point,interval_point,team_a_p1_name,team_a_p2_name,team_a_club,team_a_details,team_b_p1_name,team_b_p2_name,team_b_club,team_b_details,scheduled_date,court_number,scheduled_time
M-501,Turnamen Lintas Laptop,Ganda Putra,MD,side_out,continuous,2,1,Kevin,Marcus,Jaya Raya,1,Fajar,Rian,SGS,2,Sabtu / 7 November 2026,1,10:00 WIB
M-502,Turnamen Lintas Laptop,Tunggal Putra,MS,rally_point,sets,21,11,Ginting,,SGS,1,Jonatan,,Tangkas,2,Sabtu / 7 November 2026,2,11:00 WIB`;

  // Laptop A: Imports schedule, finishes M-501, and plays M-502 to 5-3 live
  const storeA = new Store({ dataDir: dirA, courtCount: 15, lockTimeoutMs: 5000, masterPin: '9999' });
  storeA.upsertMatches(ingest(scheduleCsv, { courtCount: 15 }).matches);

  // Finish M-501 on Laptop A
  const dev1 = 'device-laptop-a-ref1';
  const l1 = storeA.lock('M-501', dev1, 'Wasit Andi');
  const s1 = storeA.action('M-501', dev1, {
    type: 'SETUP_START',
    last_log_id: l1.match.last_log_id,
    payload: {
      left: 'a',
      positions: { a: { even: 'a1', odd: 'a2' }, b: { even: 'b1', odd: 'b2' } },
      server_id: 'a1',
      receiver_id: 'b1',
    },
  });
  const r1 = storeA.action('M-501', dev1, { type: 'WIN_RALLY', last_log_id: s1.match.last_log_id, payload: { team: 'a' } });
  const iv1 = storeA.action('M-501', dev1, { type: 'CONFIRM_INTERVAL', last_log_id: r1.match.last_log_id });
  const r2 = storeA.action('M-501', dev1, { type: 'WIN_RALLY', last_log_id: iv1.match.last_log_id, payload: { team: 'a' } });
  storeA.action('M-501', dev1, { type: 'CONFIRM_FINISH', last_log_id: r2.match.last_log_id });

  // Start M-502 on Laptop A and score 1-0 live
  const dev2 = 'device-laptop-a-ref2';
  const l2 = storeA.lock('M-502', dev2, 'Wasit Budi');
  const s2 = storeA.action('M-502', dev2, {
    type: 'SETUP_START',
    last_log_id: l2.match.last_log_id,
    payload: {
      left: 'a',
      positions: { a: { even: 'a1', odd: null }, b: { even: 'b1', odd: null } },
      server_id: 'a1',
      receiver_id: 'b1',
    },
  });
  storeA.action('M-502', dev2, { type: 'WIN_RALLY', last_log_id: s2.match.last_log_id, payload: { team: 'a' } });

  // Simulate Google Sheets `Results` row + `SmashPoint_State` row generated by Laptop A
  const exportedResultRow = resultRow(storeA.get('M-501'));
  const stateRows = [
    {
      match_number: 'M-502',
      status: 'in_progress',
      updated_at: storeA.get('M-502').updated_at,
      match_json: JSON.stringify(storeA.get('M-502')),
    },
  ];

  // Laptop B: Fresh install! Pulls schedule from Google Sheets, then applies remote progress from `Results` & `SmashPoint_State`
  const storeB = new Store({ dataDir: dirB, courtCount: 15, lockTimeoutMs: 5000, masterPin: '9999' });
  storeB.upsertMatches(ingest(scheduleCsv, { courtCount: 15 }).matches);
  const progressRes = storeB.applyRemoteProgress({
    results: [exportedResultRow],
    states: stateRows,
  });

  assert.equal(progressRes.restored_from_results, 1);
  assert.equal(progressRes.restored_from_state, 1);

  // Verify M-501 is already finished on Laptop B (not restarted from scratch!)
  const m501B = storeB.get('M-501');
  assert.equal(m501B.session_management.status, 'finished');
  assert.equal(m501B.live_state.winner, 'a');
  assert.equal(m501B.session_management.controller_label, 'Wasit Andi');

  // Verify M-502 is in_progress at 1-0 on Laptop B and unlocked so Laptop B referee can continue immediately
  const m502B = storeB.get('M-502');
  assert.equal(m502B.session_management.status, 'in_progress');
  assert.equal(m502B.live_state.score.a, 1);
  assert.equal(m502B.live_state.score.b, 0);
  assert.equal(m502B.session_management.active_controller_id, null);

  // Laptop C: Restores full state bundle via exportStateBundle / importStateBundle
  const bundle = storeA.exportStateBundle();
  const storeC = new Store({ dataDir: dirC, courtCount: 15, lockTimeoutMs: 5000, masterPin: '9999' });
  const importRes = storeC.importStateBundle(bundle);
  assert.equal(importRes.restored_matches, 2);
  assert.equal(storeC.get('M-501').session_management.status, 'finished');
  assert.equal(storeC.get('M-502').live_state.score.a, 1);

  storeA.flush();
  storeB.flush();
  storeC.flush();
  fs.rmSync(dirA, { recursive: true, force: true });
  fs.rmSync(dirB, { recursive: true, force: true });
  fs.rmSync(dirC, { recursive: true, force: true });
});
