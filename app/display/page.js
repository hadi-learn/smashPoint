'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { breakCountdownInfo, DISCIPLINE_LABEL, isDoubles, matchDurationText, teamLabel, teamSeedBadge, teamSeedText } from '@/lib/engine';
import { api, emitAck, getSocket, useNow } from '@/lib/client';
import { Shuttle } from '@/components/Icons';
import RallyHistoryStrip from '@/components/RallyHistoryStrip';

/** DetectSpecialPoint: Game Point, Match Point, Set Point, Deuce */
function getTeamPointAlert(match, t) {
  const st = match.live_state;
  if (st.phase !== 'live') return null;
  const { win_point, scoring_type, scoring_method, max_point } = match.rules;

  // In Side-Out (pindah bola) scoring, a team can only score a point when they hold the serve (1st or 2nd serve).
  // If serve moves to the opponent, this team cannot win the game/match on the next rally.
  if (scoring_method === 'side_out' && st.service_status?.side !== t) {
    return null;
  }

  const cap = max_point && max_point >= win_point ? max_point : win_point + 9;
  const my = st.score[t];
  const opp = st.score[t === 'a' ? 'b' : 'a'];

  const isWinningPoint =
    scoring_type === 'continuous'
      ? my === win_point - 1 && opp < win_point
      : (my >= win_point - 1 && my - opp >= 1) || my === cap - 1;

  if (!isWinningPoint) return null;
  const isMatchPt = scoring_type === 'continuous' || st.sets[t] >= 1;
  return {
    team: t,
    type: isMatchPt ? 'MATCH POINT' : `GAME ${st.current_set} POINT`,
    tone: isMatchPt ? 'gold' : 'red',
  };
}

function detectPointAlert(match) {
  const st = match.live_state;
  if (st.phase !== 'live') return null;
  for (const t of ['a', 'b']) {
    const teamAlert = getTeamPointAlert(match, t);
    if (teamAlert) return teamAlert;
  }
  const { win_point, scoring_type } = match.rules;
  if (scoring_type === 'sets' && st.score.a >= win_point - 1 && st.score.a === st.score.b) {
    return { team: null, type: 'DEUCE', tone: 'cyan' };
  }
  return null;
}

/**
 * International Broadcast Scorebug (BWF / HSBC World Tour style).
 * Used both in the top-left of the OBS Overlay and as a live status widget.
 */
function BroadcastScorebug({ match, now, compact = false, showHistory = null }) {
  const st = match.live_state;
  const ss = st.service_status;
  const dbl = isDoubles(match);
  const sideOut = match.rules.scoring_method === 'side_out';
  const isSets = match.rules.scoring_type === 'sets';
  const finished = match.session_management.status === 'finished' || st.phase === 'finished';
  const alert = detectPointAlert(match);
  const footerAlert = alert && !alert.team ? alert : null;
  const duration = matchDurationText(match, now);
  // Show history ONLY if triggered/enabled by operator or panitia
  const isHistoryVisible = showHistory !== null ? Boolean(showHistory) : Boolean(st?.show_rally_history);
  const ralliesCount = Math.min(10, st?.rally_history?.length || 0);

  // Order rows consistently: top = Team A (or left side), bottom = Team B (or right side)
  const rows = ['a', 'b'];

  return (
    <div className={`bwf-bug ${compact ? 'compact' : ''}`}>
      {/* Top Broadcast Meta Ribbon */}
      <div className="bwf-bug-meta">
        <span className="bwf-tourney">{match.tournament_name}</span>
        <span className="bwf-sep">•</span>
        <span className="bwf-cat">{match.category_name}</span>
        <span className="bwf-disc">{match.discipline}</span>
        <span className="bwf-court-tag">COURT {match.court_number}</span>
        {st.phase === 'live' && <span className="bwf-live-pill"><span className="bwf-live-dot" />LIVE</span>}
        {isHistoryVisible && ralliesCount > 0 && (
          <span className="bwf-history-header-pill">
            📊 {ralliesCount} RALLY TERAKHIR
          </span>
        )}
      </div>

      {/* Main 2-Row Score Table + 10 Serves History Strip */}
      <div className="bwf-bug-body">
        <div className="bwf-bug-table">
          {rows.map((t) => {
            const tm = match.teams[`team_${t}`];
            const serving = ss.side === t && !['setup', 'finished'].includes(st.phase);
            const isSecond = serving && sideOut && ss.turn === 2;
            const serveCls = isSecond ? 'serve-2' : 'serve-1';
            const isWinner = finished && st.winner === t;
            const p1Serving = serving && ss.player_id === `${t}1`;
            const p2Serving = serving && ss.player_id === `${t}2`;
            const seed = teamSeedText(tm.details);

            return (
              <div key={t} className={`bwf-row team-${t} ${serving ? `is-serving ${serveCls}` : ''} ${isWinner ? 'is-winner' : ''}`}>
                {/* Team color bar */}
                <div className={`bwf-accent team-${t}`} />

                {/* Player Names + Club Name + Seeded stacked underneath */}
                <div className="bwf-identity">
                  <div className="bwf-players">
                    <span className={`bwf-pname ${p1Serving ? `srv ${serveCls}` : serving ? 'partner' : 'neutral'}`}>
                      {tm.p1}
                    </span>
                    {dbl && tm.p2 && (
                      <>
                        <span className="bwf-slash">/</span>
                        <span className={`bwf-pname ${p2Serving ? `srv ${serveCls}` : serving ? 'partner' : 'neutral'}`}>
                          {tm.p2}
                        </span>
                      </>
                    )}
                    {seed && <span className="bwf-seed-badge">{seed}</span>}
                  </div>
                  {(tm.club || seed) && (
                    <div className="bwf-club-sub">
                      {tm.club || '-'}
                    </div>
                  )}
                </div>

                {/* Service Shuttlecock Indicator (1 for 1st serve, 2 for 2nd serve) */}
                <div className="bwf-serve-slot">
                  {serving && (
                    <div key={`bug-sh-${ss.side}-${ss.turn}-${ss.player_id}`} className={`bwf-shuttles ${serveCls}`}>
                      <Shuttle className="bwf-shuttle-svg" size={16} />
                      {isSecond && <Shuttle className="bwf-shuttle-svg" size={16} />}
                    </div>
                  )}
                  {isWinner && <span className="bwf-win-check">★</span>}
                </div>

                {/* Previous Completed Sets */}
                {isSets && st.set_history.map((s) => (
                  <div key={s.set} className={`bwf-prev-set ${s.winner === t ? 'won' : ''}`}>
                    {s[t]}
                  </div>
                ))}

                {/* Sets Won Counter (if Sets mode) */}
                {isSets && (
                  <div className="bwf-sets-won" title="Sets Won">
                    {st.sets[t]}
                  </div>
                )}

                {/* Active Game Points */}
                <div className={`bwf-points ${serving ? `serving ${serveCls}` : ''}`}>
                  {st.score[t]}
                </div>
              </div>
            );
          })}
        </div>

        {/* Dynamic Rally History Strip: EXACT height & vertical alignment with bwf-points (no redundant names/labels) */}
        {!compact && isHistoryVisible && (
          <RallyHistoryStrip
            match={match}
            limit={10}
            topSide="a"
            bottomSide="b"
            showLabel={false}
            showTeamNames={false}
          />
        )}

        {/* External Right-Side Match Point / Game Point Callout (placed after history strip) */}
        {rows.map((t) => {
          const teamPointAlert = getTeamPointAlert(match, t);
          if (!teamPointAlert) return null;
          return (
            <div
              key={`callout-${t}`}
              className={`bwf-point-callout ${teamPointAlert.tone}`}
              style={{
                top: t === 'a' ? '25%' : '75%',
                left: 'calc(100% + 12px)',
              }}
            >
              <span className="bwf-callout-arrow">◀</span>
              <span>{teamPointAlert.type}</span>
            </div>
          );
        })}
      </div>

      {/* Bottom Dynamic Status / Point Alert Sub-bar */}
      <div className="bwf-bug-footer">
        <span className="bwf-match-id">{match.match_number}</span>
        {duration && (
          <span className="bwf-duration">
            ⏱ DURASI: <strong>{duration}</strong>
          </span>
        )}
        <span className="bwf-rule-tag">
          {isSets ? `SET ${st.current_set}` : `TARGET ${match.rules.win_point}`} · {sideOut ? 'SIDE-OUT' : 'RALLY'}
        </span>
        {servingSideBadge(match)}
        {footerAlert && (
          <span className={`bwf-alert-badge ${footerAlert.tone}`}>
            {footerAlert.type}
          </span>
        )}
        {st.phase === 'interval' && <span className="bwf-alert-badge gold">INTERVAL</span>}
        {st.phase === 'set_break' && <span className="bwf-alert-badge cyan">SET BREAK</span>}
        {finished && <span className="bwf-alert-badge green">FINAL</span>}
      </div>
    </div>
  );
}

function servingSideBadge(match) {
  const st = match.live_state;
  const ss = st.service_status;
  if (!ss.side || st.phase !== 'live') return null;
  if (match.rules.scoring_method !== 'side_out') return null;
  const isSecond = ss.turn === 2;
  return (
    <span className={`bwf-serve-pill ${isSecond ? 'serve-2' : 'serve-1'}`}>
      {isSecond ? '2ND SERVE' : '1ST SERVE'}
    </span>
  );
}

function renderPreviousScore(p) {
  if (Array.isArray(p.score_sets) && p.score_sets.length > 0) {
    return (
      <span className="tv-prev-score">
        {p.score_sets.map((s, idx) => {
          const aWonSet = (s.winner || (s.a >= s.b ? 'a' : 'b')) === 'a';
          return (
            <span key={idx} className="tv-prev-set-item">
              {idx > 0 && <span className="tv-prev-set-comma">, </span>}
              <span className={aWonSet ? 'score-won' : 'score-lost'}>{s.a}</span>
              <span className="tv-prev-score-sep">-</span>
              <span className={!aWonSet ? 'score-won' : 'score-lost'}>{s.b}</span>
            </span>
          );
        })}
      </span>
    );
  }
  // Fallback if score_sets is not present: parse from score_text
  const parts = String(p.score_text || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (parts.length > 0) {
    return (
      <span className="tv-prev-score">
        {parts.map((pt, idx) => {
          const [saRaw, sbRaw] = pt.split('-');
          const sa = parseInt(saRaw, 10);
          const sb = parseInt(sbRaw, 10);
          const aWonSet = Number.isFinite(sa) && Number.isFinite(sb) ? sa >= sb : p.winner === 'a';
          return (
            <span key={idx} className="tv-prev-set-item">
              {idx > 0 && <span className="tv-prev-set-comma">, </span>}
              <span className={aWonSet ? 'score-won' : 'score-lost'}>{saRaw}</span>
              <span className="tv-prev-score-sep">-</span>
              <span className={!aWonSet ? 'score-won' : 'score-lost'}>{sbRaw}</span>
            </span>
          );
        })}
      </span>
    );
  }
  return <span className="tv-prev-score">{p.score_text}</span>;
}

/**
 * Full-Screen Arena LED Scoreboard (for Courtside Smart TV / Big Monitor).
 * Redesigned with broadcast-grade horizontal rows + massive court-side split panels.
 */
function ArenaBoard({ match, now, previous = [], upcoming = [] }) {
  const st = match.live_state;
  const ss = st.service_status;
  const L = st.sides.left;
  const R = st.sides.right;
  const [anim, setAnim] = useState(false);
  const prevLeft = useRef(L);

  useEffect(() => {
    if (prevLeft.current !== L) {
      prevLeft.current = L;
      setAnim(true);
      const t = setTimeout(() => setAnim(false), 950);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [L]);

  const finished = match.session_management.status === 'finished' || st.phase === 'finished';
  const isSets = match.rules.scoring_type === 'sets';
  const sideOut = match.rules.scoring_method === 'side_out';
  const alert = detectPointAlert(match);
  const duration = matchDurationText(match, now);

  let overlay = null;
  if (finished) {
    const winSide = st.winner || (st.score[L] >= st.score[R] ? L : R);
    const loseSide = winSide === 'a' ? 'b' : 'a';
    const winTeam = match.teams[`team_${winSide}`];
    const loseTeam = match.teams[`team_${loseSide}`];
    const lastSet = st.set_history[st.set_history.length - 1];
    const winScore = isSets ? st.sets[winSide] : (lastSet ? lastSet[winSide] : st.score[winSide]);
    const loseScore = isSets ? st.sets[loseSide] : (lastSet ? lastSet[loseSide] : st.score[loseSide]);
    const prevList = (previous || []).filter((p) => p.match_number !== match.match_number).slice(-4);
    const nextList = (upcoming || []).filter((u) => u.match_number !== match.match_number).slice(0, 5);

    overlay = (
      <div className="tv-overlay tv-finished-overlay">
        {/* 1. TOP SECTION: Up to 4 Previous Matches on this Court (smaller) */}
        {prevList.length > 0 && (
          <div className="tv-sched-section prev-section">
            <div className="tv-sched-header">
              <span>⏮ RIWAYAT PERTANDINGAN SEBELUMNYA (LAPANGAN {match.court_number})</span>
              <span className="tv-sched-count">{prevList.length} SELESAI</span>
            </div>
            <div className="tv-prev-list">
              {prevList.map((p) => {
                const aWon = p.winner === 'a';
                const bWon = p.winner === 'b';
                const seedA = teamSeedText(p.team_a_details);
                const seedB = teamSeedText(p.team_b_details);
                return (
                  <div key={p.match_number} className="tv-prev-row">
                    <span className="tv-prev-id">{p.match_number}</span>
                    <span className="tv-prev-cat">{p.category_name} · {p.discipline}</span>
                    <span className="tv-prev-teams">
                      <span className={aWon ? 'won' : 'lost'}>
                        {aWon && '🏆 '}
                        {p.team_a}
                        {seedA ? <span className="tv-inline-seed">{seedA}</span> : null}
                        {p.team_a_club ? <small> ({p.team_a_club})</small> : ''}
                      </span>
                      <span className="tv-prev-vs">vs</span>
                      <span className={bWon ? 'won' : 'lost'}>
                        {bWon && '🏆 '}
                        {p.team_b}
                        {seedB ? <span className="tv-inline-seed">{seedB}</span> : null}
                        {p.team_b_club ? <small> ({p.team_b_club})</small> : ''}
                      </span>
                    </span>
                    {renderPreviousScore(p)}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 2. CENTER SECTION: Just Finished Match Result (Winner + Opponent + Scores) */}
        <div className="tv-just-finished-box">
          <div className="tv-just-finished-header">
            <span className="tv-overlay-badge">
              ✅ BARU SAJA SELESAI · {match.match_number} · {match.category_name} ({match.discipline}){duration ? ` · ⏱ ${duration}` : ''}
            </span>
            {st.set_history.length > 0 && (
              <div className="tv-overlay-scores">
                {st.set_history.map((s) => (
                  <span key={s.set} className="tv-overlay-set">
                    {isSets ? `SET ${s.set}` : 'SKOR'}:{' '}
                    <strong style={{ color: 'var(--gold)' }}>{s[winSide]}</strong>
                    {' - '}
                    <strong>{s[loseSide]}</strong>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="tv-result-grid">
            <div className="tv-result-card winner">
              <div className="tv-result-card-left">
                <div className="row" style={{ gap: '0.5vw' }}>
                  <div className="tv-result-role">🏆 PEMENANG (WINNER)</div>
                  {teamSeedBadge(match, winSide) && (
                    <span className="tv-seed-badge">{teamSeedBadge(match, winSide)}</span>
                  )}
                </div>
                <div className="tv-result-names">{teamLabel(match, winSide)}</div>
                {winTeam?.club && <div className="tv-result-club">{winTeam.club}</div>}
              </div>
              <div className="tv-result-card-right">
                <div className="tv-result-main-score">{winScore}</div>
                {isSets && <div className="tv-result-score-label">SET</div>}
              </div>
            </div>

            <div className="tv-result-card opponent">
              <div className="tv-result-card-left">
                <div className="row" style={{ gap: '0.5vw' }}>
                  <div className="tv-result-role">LAWAN</div>
                  {teamSeedBadge(match, loseSide) && (
                    <span className="tv-seed-badge">{teamSeedBadge(match, loseSide)}</span>
                  )}
                </div>
                <div className="tv-result-names">{teamLabel(match, loseSide)}</div>
                {loseTeam?.club && <div className="tv-result-club">{loseTeam.club}</div>}
              </div>
              <div className="tv-result-card-right">
                <div className="tv-result-main-score">{loseScore}</div>
                {isSets && <div className="tv-result-score-label">SET</div>}
              </div>
            </div>
          </div>
        </div>

        {/* 3. BOTTOM SECTION: Up to 5 Upcoming Matches on this Court (1st match highlighted) */}
        <div className="tv-sched-section next-section">
          <div className="tv-sched-header next">
            <span>⏭ JADWAL PERTANDINGAN BERIKUTNYA DI LAPANGAN {match.court_number}</span>
            <span className="tv-sched-count">{nextList.length ? `${nextList.length} ANTREAN` : 'SELESAI'}</span>
          </div>
          {nextList.length > 0 ? (
            <div className="tv-next-list">
              {nextList.map((u, idx) => {
                const isNextUp = idx === 0;
                const seedA = teamSeedText(u.team_a_details);
                const seedB = teamSeedText(u.team_b_details);
                return (
                  <div key={u.match_number} className={`tv-next-row ${isNextUp ? 'highlight-next' : ''}`}>
                    <div className="tv-next-left">
                      {isNextUp ? (
                        <span className="tv-next-badge">🔥 SELANJUTNYA · HARAP BERSIAP</span>
                      ) : (
                        <span className="tv-next-queue">ANTREAN #{idx + 1}</span>
                      )}
                      <span className="tv-next-id">{u.match_number}</span>
                      <span className="tv-next-cat">{u.category_name} · {u.discipline}</span>
                    </div>
                    <div className="tv-next-teams">
                      <span className="tv-next-team-a">
                        {u.team_a}
                        {seedA ? <span className="tv-inline-seed">{seedA}</span> : null}
                        {u.team_a_club ? <small> ({u.team_a_club})</small> : ''}
                      </span>
                      <span className="tv-next-vs">VS</span>
                      <span className="tv-next-team-b">
                        {u.team_b}
                        {seedB ? <span className="tv-inline-seed">{seedB}</span> : null}
                        {u.team_b_club ? <small> ({u.team_b_club})</small> : ''}
                      </span>
                    </div>
                    <div className="tv-next-time">
                      {[u.scheduled_date, u.scheduled_time].filter(Boolean).join(' · ') || 'Segera'}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="tv-next-empty">Tidak ada jadwal pertandingan berikutnya di lapangan ini.</div>
          )}
        </div>
      </div>
    );
  } else if (st.phase === 'interval') {
    const bt = breakCountdownInfo(match, now);
    const isCont = match.rules.scoring_type === 'continuous';
    overlay = (
      <div className="tv-overlay">
        <div className="tv-overlay-badge">
          MATCH INTERVAL ({isCont ? '2 MENIT / 120s' : 'BWF 60s'})
        </div>
        <h1>{st.interval_swap ? 'INTERVAL · TUKAR SISI LAPANGAN' : 'INTERVAL BREAK'}</h1>
        <h2>
          {st.score[L]} — {st.score[R]}
        </h2>
        {ss.player_name && (
          <div className="tv-break-serve-info">
            <span className="tv-break-srv-chip">🏸 Servis: <strong>{ss.player_name}</strong></span>
            {ss.receiver_name && (
              <>
                <span className="tv-break-arrow">➔</span>
                <span className="tv-break-rcv-chip">🎯 Penerima: <strong>{ss.receiver_name}</strong></span>
              </>
            )}
          </div>
        )}
        {bt && (
          <div className={`tv-break-timer mono ${bt.isOvertime ? 'overtime' : bt.callWarning ? 'warning' : ''}`}>
            ⏱ {bt.isOvertime ? '00:00 · MULAI' : bt.formatted}
          </div>
        )}
      </div>
    );
  } else if (st.phase === 'set_break') {
    const last = st.set_history[st.set_history.length - 1];
    const bt = breakCountdownInfo(match, now);
    overlay = (
      <div className="tv-overlay">
        <div className="tv-overlay-badge">END OF GAME {st.current_set} (BWF 120s / 2 MENIT)</div>
        <h1>{teamLabel(match, st.game_winner)}</h1>
        <h2>
          Skor Set: {last?.a} - {last?.b} · Kedudukan Set {st.sets.a} - {st.sets.b}
        </h2>
        <p>Pemain bertukar sisi lapangan · Servis pertama Set {st.current_set + 1}: <strong>{teamLabel(match, st.game_winner)}</strong></p>
        {bt && (
          <div className={`tv-break-timer mono ${bt.isOvertime ? 'overtime' : bt.callWarning ? 'warning' : ''}`}>
            ⏱ {bt.isOvertime ? '00:00 · MULAI' : bt.formatted}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="arena-tv">
      {/* Top Broadcast Header Bar (Clean: Tournament & Match Identity Only) */}
      <header className="arena-header">
        <div className="arena-header-left">
          <span className="arena-court-badge">COURT {match.court_number}</span>
          <div className="arena-title-stack">
            <div className="arena-tourney">{match.tournament_name}</div>
            <div className="arena-sub">
              <span>{match.category_name}</span>
              <span>•</span>
              <span>{DISCIPLINE_LABEL[match.discipline] || match.discipline}</span>
            </div>
          </div>
        </div>

        <div className="arena-header-right">
          {alert && <span className={`arena-alert-pill ${alert.tone}`}>{alert.type}</span>}
          {duration && (
            <div className="arena-duration-badge" title="Durasi Pertandingan">
              <div className="arena-duration-meta">
                <span className="arena-duration-icon">⏱</span>
                <span className="arena-duration-label">DURASI</span>
              </div>
              <span className="arena-duration-time mono">{duration}</span>
            </div>
          )}
          <span className="arena-match-badge">{match.match_number}</span>
        </div>
      </header>

      {/* Main Split Arena Cards (Left Court Side vs Right Court Side) */}
      <div className={`arena-body ${!isSets ? 'no-center' : ''} ${anim ? 'tv-swap' : ''}`}>
        <ArenaTeamCard match={match} t={L} screen="left" />
        {isSets && (
          <div className="arena-center-divider">
            <div className="arena-set-summary">
              <div className="arena-set-label">SET {st.current_set}</div>
              <div className="arena-set-digits">
                <span>{st.sets[L]}</span>
                <span>:</span>
                <span>{st.sets[R]}</span>
              </div>
            </div>
          </div>
        )}
        <ArenaTeamCard match={match} t={R} screen="right" />

        {overlay}
        {st.phase === 'setup' && !finished && (
          <div className="tv-overlay setup-banner">
            <div className="tv-overlay-badge">PERSIAPAN PERTANDINGAN</div>
            <p>{[match.scheduled_date, match.scheduled_time].filter(Boolean).join(' · ')}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ArenaTeamCard({ match, t, screen }) {
  const st = match.live_state;
  const ss = st.service_status;
  const tm = match.teams[`team_${t}`];
  const dbl = isDoubles(match);
  const serving = ss.side === t && !['setup', 'finished'].includes(st.phase);
  const sideOut = match.rules.scoring_method === 'side_out';
  const isSecondServe = serving && sideOut && ss.turn === 2;
  const serveClass = isSecondServe ? 'serve-2' : 'serve-1';
  const players = dbl ? [`${t}1`, `${t}2`] : [`${t}1`];
  const isSets = match.rules.scoring_type === 'sets';
  const seed = teamSeedText(tm.details);

  return (
    <div className={`arena-half ${screen} team-${t} ${serving ? `serving-panel ${serveClass}` : ''}`}>
      {/* Top Club + Seeded Header */}
      {(tm.club || seed) && (
        <div className="arena-half-top">
          {seed && <span className="arena-seed-badge">{seed}</span>}
          {tm.club && <span className="arena-club-badge">{tm.club}</span>}
        </div>
      )}

      {/* Player Roster with Individual Server AND Receiver Highlight */}
      <div className="arena-roster">
        {players.map((pid) => {
          const activePhase = !['setup', 'finished'].includes(st.phase);
          const isServer = serving && ss.player_id === pid;
          const isReceiver = activePhase && !serving && ss.receiver_id === pid;
          const name = pid[1] === '1' ? tm.p1 : tm.p2;
          const rowStateCls = isServer
            ? `active-server ${serveClass}`
            : isReceiver
            ? 'active-receiver'
            : 'neutral';
          const nameStateCls = isServer
            ? `server ${serveClass}`
            : isReceiver
            ? 'receiver'
            : 'neutral';
          return (
            <div key={pid} className={`arena-player-row ${rowStateCls}`}>
              <div className="arena-player-name-wrap">
                <span className={`arena-player-name ${dbl ? 'doubles' : 'singles'} ${nameStateCls}`}>
                  {name}
                </span>
                {isServer && (
                  <span className={`tv-serve-label ${serveClass}`}>
                    {sideOut ? (isSecondServe ? '2ND SERVE' : '1ST SERVE') : 'SERVE'}
                  </span>
                )}
                {isReceiver && (
                  <span className="tv-rcv-label">
                    PENERIMA
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Giant Score Digits + Synchronized Shuttlecock Indicator */}
      <div className="arena-score-zone">
        <div className={`arena-score-num ${serving ? `serving ${serveClass}` : ''}`}>
          {st.score[t]}
        </div>

        {serving && (
          <div key={`shuttle-${ss.side}-${ss.turn}-${ss.player_id}`} className={`tv-shuttles ${serveClass}`}>
            <Shuttle className="tv-shuttle-icon" size="100%" />
            {isSecondServe && <Shuttle className="tv-shuttle-icon" size="100%" />}
          </div>
        )}
      </div>

      {/* Bottom Set Pips (only shown when match uses Sets) */}
      {isSets && (
        <div className="arena-half-bottom">
          <div className="tv-sets">
            <span className={`pip ${st.sets[t] >= 1 ? 'won' : ''}`} />
            <span className={`pip ${st.sets[t] >= 2 ? 'won' : ''}`} />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * OBS / YouTube Livestream Overlay View.
 * Places the BWF broadcast scorebug strictly at the top-left corner (`top: 28px; left: 36px`)
 * on a transparent (or chroma key green/blue) canvas so OBS Browser Source or Window Capture works out of the box.
 */
function ObsOverlayView({ match, now, bgMode, showHistory = null }) {
  const st = match.live_state;
  const finished = match.session_management.status === 'finished' || st.phase === 'finished';
  const duration = matchDurationText(match, now);

  return (
    <div className={`obs-canvas bg-${bgMode}`}>
      {/* Top-Left Corner Broadcast Scorebug */}
      <div className="obs-top-left">
        <BroadcastScorebug match={match} now={now} showHistory={showHistory} />
      </div>

      {/* Optional Lower-Third Banner when Match Finished or Interval */}
      {(finished || st.phase === 'interval' || st.phase === 'set_break') && (
        <div className="obs-lower-third">
          <div className="obs-lt-accent" />
          <div className="obs-lt-body">
            <div className="obs-lt-kicker">
              {finished
                ? `OFFICIAL RESULT · ${match.tournament_name}${duration ? ` · ⏱ ${duration}` : ''}`
                : st.phase === 'interval'
                ? 'MATCH INTERVAL'
                : `END OF GAME ${st.current_set}`}
            </div>
            <div className="obs-lt-headline">
              {finished ? (
                (() => {
                  const winSide = st.winner || (st.score.a >= st.score.b ? 'a' : 'b');
                  const loseSide = winSide === 'a' ? 'b' : 'a';
                  const winSeed = teamSeedBadge(match, winSide);
                  const loseSeed = teamSeedBadge(match, loseSide);
                  return (
                    <>
                      <span style={{ color: 'var(--gold)' }}>🏆 {teamLabel(match, winSide)}</span>
                      {winSeed ? ` [${winSeed}]` : ''}
                      {match.teams[`team_${winSide}`]?.club ? ` (${match.teams[`team_${winSide}`].club})` : ''}
                      <span style={{ color: '#94a3b8', fontWeight: 700, margin: '0 10px' }}>def.</span>
                      <span style={{ color: '#cbd5e1' }}>{teamLabel(match, loseSide)}</span>
                      {loseSeed ? ` [${loseSeed}]` : ''}
                      {match.teams[`team_${loseSide}`]?.club ? ` (${match.teams[`team_${loseSide}`].club})` : ''}
                    </>
                  );
                })()
              ) : (
                `${teamLabel(match, 'a')}${teamSeedBadge(match, 'a') ? ` [${teamSeedBadge(match, 'a')}]` : ''}  vs  ${teamLabel(match, 'b')}${teamSeedBadge(match, 'b') ? ` [${teamSeedBadge(match, 'b')}]` : ''}`
              )}
            </div>
          </div>
          <div className="obs-lt-score">
            {st.set_history.length > 0
              ? st.set_history
                  .map((s) => {
                    const winSide = st.winner || 'a';
                    const loseSide = winSide === 'a' ? 'b' : 'a';
                    return finished ? `${s[winSide]}-${s[loseSide]}` : `${s.a}-${s.b}`;
                  })
                  .join('  ·  ')
              : `${st.score.a} - ${st.score.b}`}
          </div>
        </div>
      )}
    </div>
  );
}

function Idle({ court, previous = [], upcoming = [], isObs, bgMode }) {
  if (isObs) {
    return (
      <div className={`obs-canvas bg-${bgMode}`}>
        <div className="obs-top-left">
          <div className="bwf-bug">
            <div className="bwf-bug-meta">
              <span className="bwf-tourney">SMASHPOINT LIVE</span>
              <span className="bwf-court-tag">COURT {court}</span>
            </div>
            <div style={{ padding: '12px 18px', color: '#cbd5e1', fontWeight: 700, fontSize: 14 }}>
              {upcoming?.[0]
                ? `NEXT: ${upcoming[0].match_number} · ${upcoming[0].team_a} vs ${upcoming[0].team_b}`
                : 'MENUNGGU PERTANDINGAN BERIKUTNYA...'}
            </div>
          </div>
        </div>
      </div>
    );
  }
  const prevList = (previous || []).slice(-4);
  const nextList = (upcoming || []).slice(0, 5);

  return (
    <div className="tv-idle">
      <div className="big">COURT {court}</div>
      {prevList.length > 0 && (
        <div className="tv-sched-section prev-section" style={{ width: '92vw', maxWidth: '92vw' }}>
          <div className="tv-sched-header">
            <span>⏮ RIWAYAT PERTANDINGAN SEBELUMNYA</span>
            <span className="tv-sched-count">{prevList.length} SELESAI</span>
          </div>
          <div className="tv-prev-list">
            {prevList.map((p) => {
              const aWon = p.winner === 'a';
              const bWon = p.winner === 'b';
              const seedA = teamSeedText(p.team_a_details);
              const seedB = teamSeedText(p.team_b_details);
              return (
                <div key={p.match_number} className="tv-prev-row">
                  <span className="tv-prev-id">{p.match_number}</span>
                  <span className="tv-prev-cat">{p.category_name} · {p.discipline}</span>
                  <span className="tv-prev-teams">
                    <span className={aWon ? 'won' : 'lost'}>
                      {aWon && '🏆 '}
                      {p.team_a}
                      {seedA ? <span className="tv-inline-seed">{seedA}</span> : null}
                    </span>
                    <span className="tv-prev-vs">vs</span>
                    <span className={bWon ? 'won' : 'lost'}>
                      {bWon && '🏆 '}
                      {p.team_b}
                      {seedB ? <span className="tv-inline-seed">{seedB}</span> : null}
                    </span>
                  </span>
                  {renderPreviousScore(p)}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {nextList.length ? (
        <div className="tv-sched-section next-section" style={{ width: '92vw', maxWidth: '92vw' }}>
          <div className="tv-sched-header next">
            <span>⏭ JADWAL PERTANDINGAN BERIKUTNYA DI LAPANGAN {court}</span>
            <span className="tv-sched-count">{nextList.length} ANTREAN</span>
          </div>
          <div className="tv-next-list">
            {nextList.map((u, idx) => {
              const isNextUp = idx === 0;
              const seedA = teamSeedText(u.team_a_details);
              const seedB = teamSeedText(u.team_b_details);
              return (
                <div key={u.match_number} className={`tv-next-row ${isNextUp ? 'highlight-next' : ''}`}>
                  <div className="tv-next-left">
                    {isNextUp ? (
                      <span className="tv-next-badge">🔥 SELANJUTNYA · HARAP BERSIAP</span>
                    ) : (
                      <span className="tv-next-queue">ANTREAN #{idx + 1}</span>
                    )}
                    <span className="tv-next-id">{u.match_number}</span>
                    <span className="tv-next-cat">{u.category_name} · {u.discipline}</span>
                  </div>
                  <div className="tv-next-teams">
                    <span className="tv-next-team-a">
                      {u.team_a}
                      {seedA ? <span className="tv-inline-seed">{seedA}</span> : null}
                      {u.team_a_club ? <small> ({u.team_a_club})</small> : ''}
                    </span>
                    <span className="tv-next-vs">VS</span>
                    <span className="tv-next-team-b">
                      {u.team_b}
                      {seedB ? <span className="tv-inline-seed">{seedB}</span> : null}
                      {u.team_b_club ? <small> ({u.team_b_club})</small> : ''}
                    </span>
                  </div>
                  <div className="tv-next-time">
                    {[u.scheduled_date, u.scheduled_time].filter(Boolean).join(' · ') || 'Segera'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: '2.2vw', color: '#64748b' }}>Menunggu pertandingan aktif di lapangan ini…</div>
      )}
    </div>
  );
}

function Picker() {
  const [count, setCount] = useState(15);
  const [code, setCode] = useState('');
  const [viewMode, setViewMode] = useState('arena'); // arena | obs | chroma
  useEffect(() => {
    api('/api/config').then((c) => c.court_count && setCount(c.court_count));
  }, []);

  const suffix = viewMode === 'obs' ? '&mode=obs' : viewMode === 'chroma' ? '&mode=obs&bg=green' : '';

  return (
    <main className="container col" style={{ maxWidth: 820 }}>
      <h1>Court Display & YouTube OBS Overlay</h1>
      <p className="muted">
        Pilih mode tampilan untuk layar TV besar di pinggir lapangan atau mode <strong>YouTube / OBS Scorebug Overlay</strong> (pojok kiri atas).
      </p>

      <div className="card col">
        <h3>1. Pilih Mode Desain Tampilan</h3>
        <div className="row">
          <button
            type="button"
            className={`btn ${viewMode === 'arena' ? 'btn-primary' : ''}`}
            onClick={() => setViewMode('arena')}
          >
            📺 Arena TV Monitor (Layar Penuh Lapangan)
          </button>
          <button
            type="button"
            className={`btn ${viewMode === 'obs' ? 'btn-green' : ''}`}
            onClick={() => setViewMode('obs')}
          >
            🎥 OBS / YouTube Overlay (Transparan Pojok Kiri Atas)
          </button>
          <button
            type="button"
            className={`btn ${viewMode === 'chroma' ? 'btn-yellow' : ''}`}
            onClick={() => setViewMode('chroma')}
          >
            🟩 OBS Chroma Key (Green Screen Capture)
          </button>
        </div>
        <div className="small muted">
          {viewMode === 'arena' && 'Tampilan papan skor raksasa kontras tinggi untuk Smart TV / LED Monitor di lapangan.'}
          {viewMode === 'obs' && 'Tampilan Scorebug turnamen internasional BWF di pojok kiri atas dengan latar transparan (cocok untuk OBS Browser Source 1920x1080).'}
          {viewMode === 'chroma' && 'Tampilan Scorebug di pojok kiri atas dengan latar hijau (#00FF00) untuk tangkapan layar Window Capture + Filter Chroma Key di OBS.'}
        </div>
      </div>

      <div className="card col">
        <h3>2. Buka berdasarkan Nomor Lapangan (Auto-Sync)</h3>
        <div className="court-links">
          {Array.from({ length: count }, (_, i) => (
            <Link key={i} href={`/display?court=${i + 1}${suffix}`}>
              Court {i + 1}
            </Link>
          ))}
        </div>
      </div>

      <form
        className="card col"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) window.location.href = `/display?match=${encodeURIComponent(code.trim().toUpperCase())}${suffix}`;
        }}
      >
        <h3>Atau berdasarkan Match ID</h3>
        <div className="row">
          <input className="input" style={{ flex: 1 }} value={code} onChange={(e) => setCode(e.target.value)} placeholder="Contoh: M-101" />
          <button className="btn btn-primary">Buka Display</button>
        </div>
      </form>
    </main>
  );
}

function Display() {
  const router = useRouter();
  const params = useSearchParams();
  const court = params.get('court');
  const matchId = params.get('match');
  const initialMode = params.get('mode') === 'obs' ? 'obs' : 'arena';
  const initialBg = params.get('bg') || 'transparent'; // transparent | green | dark

  const [mode, setMode] = useState(initialMode);
  const [bgMode, setBgMode] = useState(initialBg);
  const [showHistoryLocal, setShowHistoryLocal] = useState(false);
  const [courtCount, setCourtCount] = useState(15);
  const [menuOpen, setMenuOpen] = useState(false);
  const [match, setMatch] = useState(null);
  const [previous, setPrevious] = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const now = useNow(1000);

  // Shortcut keyboard 'H' untuk toggle on-demand tampilan 10 servis terakhir di overlay YouTube
  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target?.tagName)) return;
      if (e.key === 'h' || e.key === 'H') {
        setShowHistoryLocal((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    api('/api/config').then((c) => c?.court_count && setCourtCount(c.court_count));
  }, []);

  useEffect(() => {
    setMode(params.get('mode') === 'obs' ? 'obs' : 'arena');
    if (params.get('bg')) setBgMode(params.get('bg'));
  }, [params]);

  const switchCourt = (nextCourt) => {
    if (!nextCourt) {
      router.push('/display');
      setMenuOpen(false);
      return;
    }
    const q = new URLSearchParams();
    q.set('court', String(nextCourt));
    if (mode === 'obs') {
      q.set('mode', 'obs');
      if (bgMode && bgMode !== 'transparent') q.set('bg', bgMode);
    }
    router.push(`/display?${q.toString()}`);
    setMenuOpen(false);
  };

  // Make body background transparent when in OBS transparent mode so OBS Browser Source composites cleanly
  useEffect(() => {
    if (mode === 'obs' && bgMode === 'transparent') {
      document.documentElement.style.background = 'transparent';
      document.body.style.background = 'transparent';
    } else {
      document.documentElement.style.background = '';
      document.body.style.background = '';
    }
    return () => {
      document.documentElement.style.background = '';
      document.body.style.background = '';
    };
  }, [mode, bgMode]);

  useEffect(() => {
    if (!court && !matchId) return undefined;
    const s = getSocket();
    const subscribe = async () => {
      setConnected(true);
      if (court) {
        const r = await emitAck('court:watch', { court });
        if (r.ok) {
          setMatch(r.snapshot.match);
          setPrevious(r.snapshot.previous || []);
          setUpcoming(r.snapshot.upcoming || []);
          setError(null);
        } else setError(r.error);
      } else {
        const r = await emitAck('match:watch', { match_number: matchId });
        if (r.ok) {
          setMatch(r.match);
          setPrevious(r.previous || []);
          setUpcoming(r.upcoming || []);
          setError(null);
        } else setError(r.error);
      }
    };
    const onCourt = (snap) => {
      if (court && String(snap.court) !== String(court)) return;
      if (court) {
        setMatch(snap.match);
      }
      setPrevious(snap.previous || []);
      setUpcoming(snap.upcoming || []);
    };
    const onMatch = (m) => {
      if (matchId && m.match_number === matchId.toUpperCase()) setMatch(m);
    };
    const onDisconnect = () => setConnected(false);
    s.on('connect', subscribe);
    s.on('disconnect', onDisconnect);
    s.on('court:state', onCourt);
    s.on('match:state', onMatch);
    if (s.connected) subscribe();
    return () => {
      s.off('connect', subscribe);
      s.off('disconnect', onDisconnect);
      s.off('court:state', onCourt);
      s.off('match:state', onMatch);
    };
  }, [court, matchId]);

  if (!court && !matchId) return <Picker />;

  const isObs = mode === 'obs';
  const activeCourtNum = Number(court || match?.court_number || 0);

  return (
    <div className={`tv ${isObs ? `obs-mode bg-${bgMode}` : 'arena-mode'}`}>
      {/* Bottom-Right Docked Control Trigger & Drawer (Out of OBS top-left scorebug crop area; only opens on click, never on accidental mouse hover) */}
      <div className={`tv-dock ${menuOpen ? 'open' : ''}`}>
        {menuOpen && (
          <div className="tv-toolbar-panel">
            {/* 1. Court Switcher Row */}
            <div className="tv-toolbar-section">
              <span className="tv-toolbar-lbl">🏟️ Pindah Lapangan:</span>
              <select
                className="tv-court-select"
                value={activeCourtNum || ''}
                onChange={(e) => switchCourt(e.target.value)}
                title="Pindah langsung ke lapangan lain tanpa tombol Back"
              >
                {!activeCourtNum && <option value="">-- Pilih Court --</option>}
                {Array.from({ length: courtCount }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    Court {i + 1}
                  </option>
                ))}
              </select>
              <div className="tv-court-Matrix">
                {Array.from({ length: courtCount }, (_, i) => {
                  const cNum = i + 1;
                  return (
                    <button
                      key={cNum}
                      type="button"
                      className={`tv-court-chip ${activeCourtNum === cNum ? 'active' : ''}`}
                      onClick={() => switchCourt(cNum)}
                    >
                      C{cNum}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => switchCourt('')}
                title="Kembali ke Menu Utama Pemilihan Display"
              >
                🏠 Menu Display
              </button>
            </div>

            {/* 2. Display / OBS Mode Switcher Row */}
            <div className="tv-toolbar-section">
              <span className="tv-toolbar-lbl">🎛️ Mode Layar:</span>
              <button
                type="button"
                className={`btn btn-sm ${!isObs ? 'btn-primary' : ''}`}
                onClick={() => {
                  setMode('arena');
                  setMenuOpen(false);
                }}
                title="Mode Monitor TV Lapangan (Full Screen)"
              >
                📺 Arena TV
              </button>
              <button
                type="button"
                className={`btn btn-sm ${isObs && bgMode === 'transparent' ? 'btn-green' : ''}`}
                onClick={() => {
                  setMode('obs');
                  setBgMode('transparent');
                  setMenuOpen(false);
                }}
                title="Mode Overlay OBS Browser Source (Latar Transparan Pojok Kiri Atas)"
              >
                🎥 OBS Transparan
              </button>
              <button
                type="button"
                className={`btn btn-sm ${isObs && bgMode === 'green' ? 'btn-yellow' : ''}`}
                onClick={() => {
                  setMode('obs');
                  setBgMode('green');
                  setMenuOpen(false);
                }}
                title="Mode Tangkapan Layar OBS Chroma Key (Green Screen Pojok Kiri Atas)"
              >
                🟩 OBS Green Screen
              </button>
              <button
                type="button"
                className={`btn btn-sm ${isObs && bgMode === 'dark' ? 'btn-blue' : ''}`}
                onClick={() => {
                  setMode('obs');
                  setBgMode('dark');
                  setMenuOpen(false);
                }}
                title="Pratinjau Simulasi Kamera Livestream"
              >
                👁️ Preview Kamera
              </button>
              <button
                type="button"
                className={`btn btn-sm ${showHistoryLocal || match?.live_state?.show_rally_history ? 'btn-yellow' : ''}`}
                onClick={async () => {
                  const nextVal = !(showHistoryLocal || match?.live_state?.show_rally_history);
                  setShowHistoryLocal(nextVal);
                  if (match?.match_number) {
                    await api(`/api/matches/${encodeURIComponent(match.match_number)}/toggle_history`, {
                      method: 'POST',
                      body: { show: nextVal },
                    });
                  }
                }}
                title="Tekan H pada keyboard atau klik di sini untuk menampilkan/menyembunyikan 10 reli terakhir di overlay YouTube"
              >
                📊 Histori Reli: {showHistoryLocal || match?.live_state?.show_rally_history ? 'ON (Tampil)' : 'OFF (Sembunyi)'}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  if (document.fullscreenElement) document.exitFullscreen();
                  else document.documentElement.requestFullscreen?.();
                  setMenuOpen(false);
                }}
              >
                ⛶ Fullscreen
              </button>
            </div>
          </div>
        )}

        <button
          type="button"
          className={`tv-dock-trigger ${isObs ? 'obs-stealth' : ''} ${menuOpen ? 'active' : ''}`}
          onClick={() => setMenuOpen((v) => !v)}
          title="Klik untuk membuka pengaturan Lapangan (Court) & Mode Layar"
        >
          {menuOpen ? '✕ Tutup Panel' : `⚙️ Court ${activeCourtNum || '-'} · Pengaturan`}
        </button>
      </div>

      {error && (
        <div className="tv-idle" style={{ fontSize: '2.5vw', color: '#f87171' }}>
          {error}
        </div>
      )}

      {!error &&
        (match ? (
          isObs ? (
            <ObsOverlayView
              match={match}
              now={now}
              bgMode={bgMode}
              showHistory={showHistoryLocal || Boolean(match?.live_state?.show_rally_history)}
            />
          ) : (
            <ArenaBoard match={match} now={now} previous={previous} upcoming={upcoming} />
          )
        ) : (
          <Idle court={court || '-'} previous={previous} upcoming={upcoming} isObs={isObs} bgMode={bgMode} />
        ))}

      {!isObs && (
        <div className="tv-conn">
          <span className={`dot ${connected ? 'on' : ''}`} />
        </div>
      )}
    </div>
  );
}

export default function DisplayPage() {
  return (
    <Suspense fallback={null}>
      <Display />
    </Suspense>
  );
}
