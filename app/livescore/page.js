'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  breakCountdownInfo,
  DISCIPLINE_LABEL,
  isDoubles,
  matchDurationText,
  teamLabel,
  teamSeedBadge,
  teamSeedText,
} from '@/lib/engine';
import { api, emitAck, getSocket, lsGet, lsSet, useNow } from '@/lib/client';
import CourtMap from '@/components/CourtMap';
import { Shuttle } from '@/components/Icons';
import RallyHistoryStrip from '@/components/RallyHistoryStrip';

const MAX_DISPLAY_COURTS = 8;
const LS_COUNT_KEY = 'sp_livescore_count';
const LS_SLOTS_KEY = 'sp_livescore_slots';

const T = (t) => (t ? t.toUpperCase() : '');

/** Detect Game Point, Match Point, or Deuce */
function detectPointAlert(match) {
  if (!match?.live_state) return null;
  const st = match.live_state;
  if (st.phase !== 'live') return null;
  const { win_point, scoring_type, scoring_method, max_point } = match.rules;
  const cap = max_point && max_point >= win_point ? max_point : win_point + 9;

  for (const t of ['a', 'b']) {
    if (scoring_method === 'side_out' && st.service_status?.side !== t) continue;
    const my = st.score[t];
    const opp = st.score[t === 'a' ? 'b' : 'a'];
    const isWinningPoint =
      scoring_type === 'continuous'
        ? my === win_point - 1 && opp < win_point
        : (my >= win_point - 1 && my - opp >= 1) || my === cap - 1;
    if (isWinningPoint) {
      const isMatchPt = scoring_type === 'continuous' || st.sets[t] >= 1;
      return {
        team: t,
        type: isMatchPt ? 'MATCH POINT' : `GAME ${st.current_set} POINT`,
        tone: isMatchPt ? 'gold' : 'red',
      };
    }
  }
  if (scoring_type === 'sets' && st.score.a >= win_point - 1 && st.score.a === st.score.b) {
    return { team: null, type: 'DEUCE', tone: 'cyan' };
  }
  return null;
}

/**
 * Single Court Card inside the Multi-Court Venue LiveScore Grid.
 * Shows court selector dropdown, match metadata, Left vs Right scoreline,
 * animated BWF CourtMap (server, receiver, parabolic shuttlecock trajectory),
 * and phase overlays (Interval countdown, Set Break countdown, Finished result, or Idle queue).
 */
function LiveScoreCourtCard({
  slotIndex,
  courtNum,
  totalSlots,
  courtCount,
  snapshot,
  now,
  onChangeCourt,
}) {
  const match = snapshot?.match || null;
  const upcoming = snapshot?.upcoming || [];
  const previous = snapshot?.previous || [];
  const compact = totalSlots >= 5; // 5..8 courts -> compact density
  const medium = totalSlots >= 3 && totalSlots <= 4;
  // History limit scales dynamically based on court card size (1 -> 40, 2 -> 25, 3-4 -> 18, 5-8 -> 12) + autoFit ResizeObserver
  const historyLimit = totalSlots === 1 ? 40 : totalSlots === 2 ? 25 : totalSlots <= 4 ? 18 : 12;

  // Render Court Selector Header
  const renderCardHeader = () => {
    const st = match?.live_state;
    const sm = match?.session_management;
    const finished = sm?.status === 'finished' || st?.phase === 'finished';
    const isLive = st?.phase === 'live' && !finished;
    const isBreak = st?.phase === 'interval' || st?.phase === 'set_break';
    const isSetup = st?.phase === 'setup' && !finished;
    const duration = match ? matchDurationText(match, now) : null;
    const alert = match ? detectPointAlert(match) : null;

    return (
      <div className="ls-card-header">
        <div className="ls-card-header-left">
          <label className="ls-court-picker-wrap" title="Klik untuk mengganti nomor lapangan pada kartu ini">
            <span className="ls-court-icon">🏟️</span>
            <select
              className="ls-court-select"
              value={courtNum}
              onChange={(e) => onChangeCourt(slotIndex, parseInt(e.target.value, 10))}
            >
              {Array.from({ length: courtCount }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  LAPANGAN {i + 1}
                </option>
              ))}
            </select>
          </label>

          {match ? (
            <div className="ls-match-meta">
              <span className="ls-match-no">{match.match_number}</span>
              <span className="ls-match-cat">
                {match.category_name} · {match.discipline}
                {!compact && DISCIPLINE_LABEL[match.discipline] ? ` (${DISCIPLINE_LABEL[match.discipline]})` : ''}
              </span>
            </div>
          ) : (
            <span className="ls-idle-tag">STANDBY · MENUNGGU MATCH</span>
          )}
        </div>

        <div className="ls-card-header-right">
          {alert && <span className={`ls-alert-pill ${alert.tone}`}>{alert.type}</span>}
          {duration && <span className="ls-dur-pill mono">⏱ {duration}</span>}
          {isLive && (
            <span className="ls-status-pill live">
              <span className="ls-pulse-dot" /> LIVE
            </span>
          )}
          {isBreak && (
            <span className="ls-status-pill break">
              ⏸ {st.phase === 'interval' ? 'INTERVAL' : 'SET BREAK'}
            </span>
          )}
          {isSetup && <span className="ls-status-pill setup">⚙ PERSIAPAN</span>}
          {finished && <span className="ls-status-pill finished">✔ SELESAI</span>}
          <Link
            href={`/display?court=${courtNum}`}
            className="ls-tv-link"
            title={`Buka tampilan TV layar penuh khusus Lapangan ${courtNum}`}
          >
            📺
          </Link>
        </div>
      </div>
    );
  };

  // If no active match on this court -> show idle court card with upcoming/previous summary
  if (!match) {
    const nextUp = upcoming[0] || null;
    const lastPrev = previous[previous.length - 1] || null;
    return (
      <div className={`ls-card idle ${compact ? 'compact' : medium ? 'medium' : 'large'}`}>
        {renderCardHeader()}
        <div className="ls-idle-body">
          <div className="ls-idle-court-watermark">COURT {courtNum}</div>
          {nextUp ? (
            <div className="ls-idle-box next">
              <div className="ls-idle-kicker">🔥 PERTANDINGAN BERIKUTNYA ({nextUp.match_number})</div>
              <div className="ls-idle-versus">
                <span className="team-a">
                  {nextUp.team_a}
                  {teamSeedText(nextUp.team_a_details) && (
                    <span className="seed-pill">{teamSeedText(nextUp.team_a_details)}</span>
                  )}
                </span>
                <span className="vs">VS</span>
                <span className="team-b">
                  {nextUp.team_b}
                  {teamSeedText(nextUp.team_b_details) && (
                    <span className="seed-pill">{teamSeedText(nextUp.team_b_details)}</span>
                  )}
                </span>
              </div>
              <div className="ls-idle-sub">
                {nextUp.category_name} · {nextUp.discipline}
                {nextUp.scheduled_time ? ` · 🕒 ${nextUp.scheduled_time}` : ''}
                {upcoming.length > 1 ? ` · (+${upcoming.length - 1} antrean lagi)` : ''}
              </div>
            </div>
          ) : (
            <div className="ls-idle-empty">Belum ada jadwal pertandingan aktif di Lapangan {courtNum}</div>
          )}

          {lastPrev && !compact && (
            <div className="ls-idle-box prev">
              <span className="ls-prev-label">⏮ Terakhir Selesai ({lastPrev.match_number}):</span>
              <span className="ls-prev-detail">
                <b style={{ color: lastPrev.winner === 'a' ? 'var(--gold)' : '#cbd5e1' }}>
                  {lastPrev.winner === 'a' ? '🏆 ' : ''}
                  {lastPrev.team_a}
                </b>{' '}
                vs{' '}
                <b style={{ color: lastPrev.winner === 'b' ? 'var(--gold)' : '#cbd5e1' }}>
                  {lastPrev.winner === 'b' ? '🏆 ' : ''}
                  {lastPrev.team_b}
                </b>{' '}
                <span className="mono" style={{ color: 'var(--cyan)' }}>
                  ({lastPrev.score_text})
                </span>
              </span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Active Match Rendering
  const st = match.live_state;
  const ss = st.service_status;
  const L = st.sides.left;
  const R = st.sides.right;
  const sideOutDbl = match.rules.scoring_method === 'side_out' && isDoubles(match);
  const isSets = match.rules.scoring_type === 'sets';
  const finished = match.session_management.status === 'finished' || st.phase === 'finished';
  const duration = matchDurationText(match, now);
  const breakTimer = breakCountdownInfo(match, now);

  const renderTeamSide = (t, side) => {
    const tm = match.teams[`team_${t}`];
    const seed = teamSeedBadge(match, t);
    const isServing = ss.side === t && !['setup', 'finished'].includes(st.phase);
    const isSecondServe = isServing && sideOutDbl && ss.turn === 2;
    const isWinner = finished && st.winner === t;

    return (
      <div className={`ls-team-box ${side} team-${t} ${isServing ? 'serving' : ''} ${isWinner ? 'winner' : ''}`}>
        <div className="ls-team-info">
          <div className="ls-team-top">
            <span className={`ls-side-tag ${side}`}>{side === 'left' ? '◀ KIRI' : 'KANAN ▶'}</span>
            {tm.club && <span className="ls-club-tag">{tm.club}</span>}
            {seed && <span className="seed-pill">{seed}</span>}
          </div>
          <div className="ls-team-names">
            {isWinner && '🏆 '}
            {teamLabel(match, t)}
          </div>
        </div>
        <div className={`ls-team-score ${isServing ? (isSecondServe ? 'serve-2' : 'serve-1') : ''}`}>
          {st.score[t]}
        </div>
      </div>
    );
  };

  // Phase overlays inside CourtMap (Interval, Set Break, Setup, Finished)
  let overlay = null;
  if (finished) {
    const winSide = st.winner || (st.score[L] >= st.score[R] ? L : R);
    overlay = (
      <div className="phase-overlay ls-phase-overlay">
        <div className="ls-overlay-badge gold">PERTANDINGAN SELESAI</div>
        <div className="ls-overlay-title">🏆 {teamLabel(match, winSide)}</div>
        {match.teams[`team_${winSide}`]?.club && (
          <div className="ls-overlay-club">{match.teams[`team_${winSide}`].club}</div>
        )}
        <div className="ls-overlay-sub">
          {st.set_history.length > 0
            ? st.set_history.map((s) => `${s.a}-${s.b}`).join('  ·  ')
            : `${st.score.a}-${st.score.b}`}
          {duration ? `  ·  ⏱ ${duration}` : ''}
        </div>
      </div>
    );
  } else if (st.phase === 'interval') {
    overlay = (
      <div className="phase-overlay ls-phase-overlay">
        <div className="ls-overlay-badge cyan">
          {st.interval_swap ? 'INTERVAL · TUKAR LAPANGAN' : 'INTERVAL ISTIRAHAT'}
        </div>
        <div className="ls-overlay-title">
          {st.score[L]} — {st.score[R]}
        </div>
        {breakTimer && (
          <div className={`ls-break-countdown mono ${breakTimer.isOvertime ? 'overtime' : breakTimer.callWarning ? 'warning' : ''}`}>
            ⏱ {breakTimer.isOvertime ? `00:00 (${breakTimer.overtimeFormatted})` : breakTimer.formatted}
          </div>
        )}
      </div>
    );
  } else if (st.phase === 'set_break') {
    const last = st.set_history[st.set_history.length - 1];
    overlay = (
      <div className="phase-overlay ls-phase-overlay">
        <div className="ls-overlay-badge cyan">SET {st.current_set} SELESAI · JEDA ANTAR SET</div>
        <div className="ls-overlay-title">
          Set {st.current_set}: {teamLabel(match, st.game_winner)} ({last?.a}-{last?.b})
        </div>
        {breakTimer && (
          <div className={`ls-break-countdown mono ${breakTimer.isOvertime ? 'overtime' : breakTimer.callWarning ? 'warning' : ''}`}>
            ⏱ {breakTimer.isOvertime ? `00:00 (${breakTimer.overtimeFormatted})` : breakTimer.formatted}
          </div>
        )}
      </div>
    );
  } else if (st.phase === 'setup') {
    overlay = (
      <div className="phase-overlay ls-phase-overlay">
        <div className="ls-overlay-badge blue">PERSIAPAN PERTANDINGAN</div>
        <div className="ls-overlay-sub">
          Wasit ({match.session_management?.controller_label || 'Meja Lapangan'}) sedang melakukan undian &amp; posisi pemain
        </div>
      </div>
    );
  }

  return (
    <div className={`ls-card active ${compact ? 'compact' : medium ? 'medium' : 'large'}`}>
      {renderCardHeader()}

      {/* Scoreboard Bar above the animated CourtMap */}
      <div className="ls-scorebar">
        {renderTeamSide(L, 'left')}

        <div className="ls-scorebar-mid">
          <div className="ls-mid-rule">
            <span>{isSets ? `SET ${st.current_set}` : 'GAME'}</span>
            {isSets && (
              <span className="ls-mid-sets">
                ({st.sets[L]} - {st.sets[R]})
              </span>
            )}
            <span>
              · {match.rules.scoring_method === 'side_out' ? 'SIDE-OUT' : 'RALLY'} {match.rules.win_point}
            </span>
          </div>

          {ss.side && st.phase !== 'setup' && !finished && (
            <div className={`ls-serve-banner ${sideOutDbl && ss.turn === 2 ? 'serve-2' : 'serve-1'}`}>
              <Shuttle size={compact ? 12 : 14} />
              {sideOutDbl && ss.turn === 2 ? <Shuttle size={compact ? 12 : 14} /> : null}
              <span>
                <b>{ss.player_name}</b>
                {sideOutDbl ? (ss.turn === 2 ? ' (2nd)' : ' (1st)') : ''}
              </span>
            </div>
          )}

          {st.set_history.length > 0 && (
            <div className="ls-set-chips">
              {st.set_history.map((s) => (
                <span key={s.set} className="ls-set-chip">
                  S{s.set}: {s[L]}-{s[R]}
                </span>
              ))}
            </div>
          )}
        </div>

        {renderTeamSide(R, 'right')}
      </div>

      {/* Dynamic Rally/Serve History Strip between Scorebar and CourtMap */}
      {st.rally_history?.length > 0 && (
        <div className="ls-history-container">
          <RallyHistoryStrip
            match={match}
            limit={historyLimit}
            autoFit
            topSide={L}
            bottomSide={R}
            compact={compact}
            showTeamNames={!compact}
          />
        </div>
      )}

      {/* Animated Badminton Court (same visual CourtMap as Referee page, without odd/even box tags) */}
      <div className="ls-court-wrap">
        <CourtMap
          match={match}
          positions={st.court_positions}
          serverId={st.phase === 'setup' || finished ? null : ss.player_id}
          receiverId={st.phase === 'setup' || finished ? null : ss.receiver_id}
          serveTurn={ss.turn}
          spinKey={L}
          overlay={overlay}
          showTags={false}
        />
      </div>

      {/* Ramping & Bersih: Sederhana agar gambar lapangan lebih dominan */}
      <div className="ls-card-footer simple">
        <span className="ls-footer-item">🏟️ Lapangan {courtNum}</span>
        {match.session_management?.controller_label && !compact && (
          <span className="ls-footer-item">👤 Wasit: {match.session_management.controller_label}</span>
        )}
        {upcoming.length > 0 && (
          <span className="ls-footer-next" title="Pertandingan berikutnya di lapangan ini">
            ⏭ Next ({upcoming[0].match_number}): <b>{upcoming[0].team_a}</b> vs <b>{upcoming[0].team_b}</b>
          </span>
        )}
      </div>
    </div>
  );
}

function LiveScoreContent() {
  const router = useRouter();
  const params = useSearchParams();

  const [courtCount, setCourtCount] = useState(15);
  const [activeProfile, setActiveProfile] = useState(null);
  const [snapshots, setSnapshots] = useState({});
  const [connected, setConnected] = useState(false);
  const [ready, setReady] = useState(false);

  // Number of court cards displayed simultaneously on screen (1 .. maxDisplayCourts)
  const [displayCount, setDisplayCount] = useState(4);
  // Array of court numbers assigned to each slot [1, 2, 3, 4, 5, 6, 7, 8]
  const [selectedCourts, setSelectedCourts] = useState([1, 2, 3, 4, 5, 6, 7, 8]);
  const [configOpen, setConfigOpen] = useState(false);

  const now = useNow(1000);
  const maxDisplayCourts = Math.min(MAX_DISPLAY_COURTS, Math.max(1, courtCount));

  // 1. Restore saved layout preferences or URL query params (`?count=4&courts=1,2,3,4`)
  useEffect(() => {
    const urlCount = parseInt(params.get('count') || '', 10);
    const urlCourts = (params.get('courts') || '')
      .split(',')
      .map((x) => parseInt(x.trim(), 10))
      .filter((n) => Number.isFinite(n) && n >= 1);

    const savedCount = parseInt(lsGet(LS_COUNT_KEY, 4), 10);
    const savedSlots = lsGet(LS_SLOTS_KEY, [1, 2, 3, 4, 5, 6, 7, 8]);

    const initialCount = Number.isFinite(urlCount) && urlCount >= 1 && urlCount <= MAX_DISPLAY_COURTS
      ? urlCount
      : Number.isFinite(savedCount) && savedCount >= 1 && savedCount <= MAX_DISPLAY_COURTS
      ? savedCount
      : 4;

    setDisplayCount(initialCount);

    if (urlCourts.length > 0) {
      const merged = Array.from({ length: MAX_DISPLAY_COURTS }, (_, i) => urlCourts[i] || savedSlots?.[i] || i + 1);
      setSelectedCourts(merged);
    } else if (Array.isArray(savedSlots) && savedSlots.length > 0) {
      const merged = Array.from({ length: MAX_DISPLAY_COURTS }, (_, i) => savedSlots[i] || i + 1);
      setSelectedCourts(merged);
    }
    setReady(true);
  }, [params]);

  // 2. Fetch server config & subscribe to all courts in real-time via Socket.io
  useEffect(() => {
    api('/api/config').then((c) => {
      if (c?.court_count) setCourtCount(c.court_count);
      if (c?.active_profile) setActiveProfile(c.active_profile);
    });
    api('/api/courts').then((r) => {
      if (Array.isArray(r?.courts)) {
        const map = {};
        for (const snap of r.courts) map[snap.court] = snap;
        setSnapshots(map);
      }
    });

    const s = getSocket();
    const subscribeAll = async () => {
      setConnected(true);
      const r = await emitAck('courts:watch_all', {});
      if (r?.ok) {
        if (r.court_count) setCourtCount(r.court_count);
        if (r.active_profile) setActiveProfile(r.active_profile);
        if (r.snapshots) setSnapshots(r.snapshots);
      }
    };
    const onCourtState = (snap) => {
      if (!snap?.court) return;
      setSnapshots((prev) => ({ ...prev, [snap.court]: snap }));
    };
    const onProfileSwitched = ({ active_profile }) => {
      if (active_profile) setActiveProfile(active_profile);
      subscribeAll();
    };
    const onDisconnect = () => setConnected(false);

    s.on('connect', subscribeAll);
    s.on('disconnect', onDisconnect);
    s.on('court:state', onCourtState);
    s.on('profile:switched', onProfileSwitched);
    if (s.connected) subscribeAll();

    return () => {
      s.off('connect', subscribeAll);
      s.off('disconnect', onDisconnect);
      s.off('court:state', onCourtState);
      s.off('profile:switched', onProfileSwitched);
    };
  }, []);

  // Clamp displayCount if admin courtCount is smaller than current selection
  const effectiveCount = Math.min(displayCount, maxDisplayCourts);

  const changeDisplayCount = (n) => {
    const clamped = Math.max(1, Math.min(maxDisplayCourts, Number(n) || 1));
    setDisplayCount(clamped);
    lsSet(LS_COUNT_KEY, clamped);
  };

  const changeSlotCourt = (slotIdx, newCourtNum) => {
    setSelectedCourts((prev) => {
      const next = [...prev];
      next[slotIdx] = newCourtNum;
      lsSet(LS_SLOTS_KEY, next);
      return next;
    });
  };

  // Auto-fill slots with courts that currently have active/live matches
  const autoSelectActiveCourts = () => {
    const activeCourtNums = [];
    const scheduledCourtNums = [];
    for (let c = 1; c <= courtCount; c += 1) {
      const snap = snapshots[c];
      if (snap?.match && snap.match.session_management?.status !== 'finished') {
        activeCourtNums.push(c);
      } else if (snap?.match || (snap?.upcoming && snap.upcoming.length > 0)) {
        scheduledCourtNums.push(c);
      }
    }
    const ordered = [...activeCourtNums, ...scheduledCourtNums];
    for (let c = 1; c <= courtCount; c += 1) {
      if (!ordered.includes(c)) ordered.push(c);
    }
    const nextSlots = Array.from({ length: MAX_DISPLAY_COURTS }, (_, i) => ordered[i] || (i % courtCount) + 1);
    setSelectedCourts(nextSlots);
    lsSet(LS_SLOTS_KEY, nextSlots);
    if (activeCourtNums.length >= 1 && activeCourtNums.length <= maxDisplayCourts) {
      changeDisplayCount(activeCourtNums.length);
    }
  };

  // Reset sequential courts 1, 2, 3...
  const resetSequentialCourts = () => {
    const nextSlots = Array.from({ length: MAX_DISPLAY_COURTS }, (_, i) => ((i % courtCount) + 1));
    setSelectedCourts(nextSlots);
    lsSet(LS_SLOTS_KEY, nextSlots);
  };

  // Count how many courts are currently live across the venue
  const liveCountSummary = useMemo(() => {
    let live = 0;
    let active = 0;
    for (let c = 1; c <= courtCount; c += 1) {
      const m = snapshots[c]?.match;
      if (m && m.session_management?.status !== 'finished') {
        active += 1;
        if (m.live_state?.phase === 'live') live += 1;
      }
    }
    return { live, active };
  }, [snapshots, courtCount]);

  if (!ready) return null;

  return (
    <div className="ls-shell">
      {/* Top Venue Control Bar */}
      <header className="ls-topbar">
        <div className="ls-topbar-left">
          <Link href="/" className="ls-brand">
            🏸 Smash<span>Point</span> <small>VENUE LIVESCORE</small>
          </Link>
          {activeProfile && (
            <span className="badge blue" title={activeProfile.description || 'Profil Turnamen Aktif'}>
              🏆 {activeProfile.name}
            </span>
          )}
          <span className="badge green">
            ● {liveCountSummary.live} Live / {liveCountSummary.active} Aktif
          </span>
        </div>

        {/* Quick Layout Count Buttons: 1 .. maxDisplayCourts (up to 8) */}
        <div className="ls-topbar-center">
          <span className="ls-layout-lbl">Jumlah Lapangan:</span>
          <div className="ls-count-group">
            {Array.from({ length: maxDisplayCourts }, (_, i) => {
              const n = i + 1;
              return (
                <button
                  key={n}
                  type="button"
                  className={`ls-count-btn ${effectiveCount === n ? 'active' : ''}`}
                  onClick={() => changeDisplayCount(n)}
                  title={`Tampilkan ${n} Lapangan dalam 1 layar`}
                >
                  {n} <span className="ls-count-sub">Lap</span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="btn btn-sm btn-blue"
            onClick={autoSelectActiveCourts}
            title="Otomatis tampilkan lapangan yang sedang bertanding (Live)"
          >
            ⚡ Auto Pilih Lapangan Aktif
          </button>
          <button
            type="button"
            className={`btn btn-sm ${configOpen ? 'btn-yellow' : 'btn-ghost'}`}
            onClick={() => setConfigOpen((v) => !v)}
          >
            ⚙️ Atur Slot ({effectiveCount})
          </button>
        </div>

        <div className="ls-topbar-right">
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              if (document.fullscreenElement) document.exitFullscreen();
              else document.documentElement.requestFullscreen?.();
            }}
            title="Layar Penuh (Fullscreen Monitor GOR/Venue)"
          >
            ⛶ Fullscreen
          </button>
          <span className="row small" style={{ gap: '.35rem' }}>
            <span className={`dot ${connected ? 'on' : ''}`} />
            <span className="muted">{connected ? 'LIVE' : 'Offline'}</span>
          </span>
        </div>
      </header>

      {/* Optional Expandable Slot Configuration Drawer */}
      {configOpen && (
        <div className="ls-config-drawer">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="row" style={{ gap: '.5rem' }}>
              <strong style={{ color: 'var(--gold)' }}>🎛️ Pengaturan Kartu Lapangan yang Ditampilkan ({effectiveCount} Kartu)</strong>
              <span className="small muted">
                Anda juga dapat langsung memilih nomor lapangan dari dropdown di pojok kiri atas setiap kartu.
              </span>
            </div>
            <div className="row" style={{ gap: '.4rem' }}>
              <button type="button" className="btn btn-sm" onClick={resetSequentialCourts}>
                🔢 Urutkan Lapangan 1..{effectiveCount}
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfigOpen(false)}>
                ✕ Tutup
              </button>
            </div>
          </div>
          <div className="ls-slot-config-grid">
            {Array.from({ length: effectiveCount }, (_, idx) => {
              const cNum = Math.min(courtCount, Math.max(1, selectedCourts[idx] || idx + 1));
              return (
                <label key={idx} className="ls-slot-config-item">
                  <span className="small muted">Kartu Posisi #{idx + 1}</span>
                  <select
                    className="input"
                    value={cNum}
                    onChange={(e) => changeSlotCourt(idx, parseInt(e.target.value, 10))}
                  >
                    {Array.from({ length: courtCount }, (__, cIdx) => {
                      const num = cIdx + 1;
                      const m = snapshots[num]?.match;
                      const statusTxt = m
                        ? m.session_management?.status === 'finished'
                          ? `Selesai (${m.match_number})`
                          : `LIVE: ${m.match_number}`
                        : 'Kosong / Standby';
                      return (
                        <option key={num} value={num}>
                          Lapangan {num} — {statusTxt}
                        </option>
                      );
                    })}
                  </select>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* Multi-Court Adaptive Grid (1 to 8 Courts) */}
      <main className={`ls-grid count-${effectiveCount}`}>
        {Array.from({ length: effectiveCount }, (_, idx) => {
          const courtNum = Math.min(courtCount, Math.max(1, selectedCourts[idx] || idx + 1));
          return (
            <LiveScoreCourtCard
              key={`slot-${idx}-court-${courtNum}`}
              slotIndex={idx}
              courtNum={courtNum}
              totalSlots={effectiveCount}
              courtCount={courtCount}
              snapshot={snapshots[courtNum]}
              now={now}
              onChangeCourt={changeSlotCourt}
            />
          );
        })}
      </main>
    </div>
  );
}

export default function LiveScorePage() {
  return (
    <Suspense fallback={null}>
      <LiveScoreContent />
    </Suspense>
  );
}
