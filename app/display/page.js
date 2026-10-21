'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { DISCIPLINE_LABEL, isDoubles, teamLabel } from '@/lib/engine';
import { api, emitAck, getSocket } from '@/lib/client';
import { Shuttle } from '@/components/Icons';

/** DetectSpecialPoint: Game Point, Match Point, Set Point, Deuce */
function detectPointAlert(match) {
  const st = match.live_state;
  if (st.phase !== 'live') return null;
  const { win_point, scoring_type, max_point } = match.rules;
  const cap = max_point && max_point >= win_point ? max_point : win_point + 9;
  const a = st.score.a;
  const b = st.score.b;

  const isWinningPointFor = (t) => {
    const my = st.score[t];
    const opp = st.score[t === 'a' ? 'b' : 'a'];
    if (scoring_type === 'continuous') return my === win_point - 1 && opp < win_point;
    return (my >= win_point - 1 && my - opp >= 1) || my === cap - 1;
  };

  for (const t of ['a', 'b']) {
    if (isWinningPointFor(t)) {
      const isMatchPt = scoring_type === 'continuous' || st.sets[t] >= 1;
      return {
        team: t,
        type: isMatchPt ? 'MATCH POINT' : `GAME ${st.current_set} POINT`,
        tone: isMatchPt ? 'gold' : 'red',
      };
    }
  }
  if (scoring_type === 'sets' && a >= win_point - 1 && a === b) {
    return { team: null, type: 'DEUCE', tone: 'cyan' };
  }
  return null;
}

/**
 * International Broadcast Scorebug (BWF / HSBC World Tour style).
 * Used both in the top-left of the OBS Overlay and as a live status widget.
 */
function BroadcastScorebug({ match, compact = false }) {
  const st = match.live_state;
  const ss = st.service_status;
  const dbl = isDoubles(match);
  const sideOut = match.rules.scoring_method === 'side_out';
  const isSets = match.rules.scoring_type === 'sets';
  const finished = match.session_management.status === 'finished' || st.phase === 'finished';
  const alert = detectPointAlert(match);

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
      </div>

      {/* Main 2-Row Score Table */}
      <div className="bwf-bug-table">
        {rows.map((t) => {
          const tm = match.teams[`team_${t}`];
          const serving = ss.side === t && !['setup', 'finished'].includes(st.phase);
          const isSecond = serving && sideOut && ss.turn === 2;
          const serveCls = isSecond ? 'serve-2' : 'serve-1';
          const isWinner = finished && st.winner === t;
          const p1Serving = serving && ss.player_id === `${t}1`;
          const p2Serving = serving && ss.player_id === `${t}2`;

          return (
            <div key={t} className={`bwf-row team-${t} ${serving ? `is-serving ${serveCls}` : ''} ${isWinner ? 'is-winner' : ''}`}>
              {/* Team color bar */}
              <div className={`bwf-accent team-${t}`} />

              {/* Player Names + Club Name stacked underneath */}
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
                </div>
                {tm.club && (
                  <div className="bwf-club-sub">
                    {tm.club}
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

      {/* Bottom Dynamic Status / Point Alert Sub-bar */}
      <div className="bwf-bug-footer">
        <span className="bwf-match-id">{match.match_number}</span>
        <span className="bwf-rule-tag">
          {isSets ? `GAME ${st.current_set} OF 3` : `RACE TO ${match.rules.win_point}`} · {sideOut ? 'SIDE-OUT' : 'RALLY POINT'}
        </span>
        {servingSideBadge(match)}
        {alert && (
          <span className={`bwf-alert-badge ${alert.tone}`}>
            {alert.type}
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

/**
 * Full-Screen Arena LED Scoreboard (for Courtside Smart TV / Big Monitor).
 * Redesigned with broadcast-grade horizontal rows + massive court-side split panels.
 */
function ArenaBoard({ match }) {
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

  let overlay = null;
  if (finished) {
    overlay = (
      <div className="tv-overlay">
        <div className="tv-overlay-badge">OFFICIAL RESULT · PERTANDINGAN SELESAI</div>
        <h1>{teamLabel(match, st.winner)}</h1>
        <h2>{match.teams[`team_${st.winner}`]?.club}</h2>
        <div className="tv-overlay-scores">
          {st.set_history.map((s) => (
            <span key={s.set} className="tv-overlay-set">
              SET {s.set}: <strong>{s.a} - {s.b}</strong>
            </span>
          ))}
        </div>
      </div>
    );
  } else if (st.phase === 'interval') {
    overlay = (
      <div className="tv-overlay">
        <div className="tv-overlay-badge">MATCH INTERVAL</div>
        <h1>{st.interval_swap ? 'INTERVAL · TUKAR SISI LAPANGAN' : 'INTERVAL BREAK'}</h1>
        <h2>
          {st.score[L]} — {st.score[R]}
        </h2>
      </div>
    );
  } else if (st.phase === 'set_break') {
    const last = st.set_history[st.set_history.length - 1];
    overlay = (
      <div className="tv-overlay">
        <div className="tv-overlay-badge">END OF GAME {st.current_set}</div>
        <h1>{teamLabel(match, st.game_winner)}</h1>
        <h2>
          Skor Set: {last?.a} - {last?.b} · Kedudukan Set {st.sets.a} - {st.sets.b}
        </h2>
        <p>Pemain bertukar sisi lapangan</p>
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
          <span className="arena-match-badge">{match.match_number}</span>
        </div>
      </header>

      {/* Main Split Arena Cards (Left Court Side vs Right Court Side) */}
      <div className={`arena-body ${anim ? 'tv-swap' : ''}`}>
        <ArenaTeamCard match={match} t={L} screen="left" />
        <div className="arena-center-divider">
          <div className="arena-vs-circle">VS</div>
          {isSets && (
            <div className="arena-set-summary">
              <div className="arena-set-label">SET {st.current_set}</div>
              <div className="arena-set-digits">
                <span>{st.sets[L]}</span>
                <span>:</span>
                <span>{st.sets[R]}</span>
              </div>
            </div>
          )}
        </div>
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

  return (
    <div className={`arena-half ${screen} team-${t} ${serving ? `serving-panel ${serveClass}` : ''}`}>
      {/* Top Club Header */}
      {tm.club && (
        <div className="arena-half-top">
          <span className="arena-club-badge">{tm.club}</span>
        </div>
      )}

      {/* Player Roster with Individual Server Highlight */}
      <div className="arena-roster">
        {players.map((pid) => {
          const isServer = serving && ss.player_id === pid;
          const name = pid[1] === '1' ? tm.p1 : tm.p2;
          return (
            <div key={pid} className={`arena-player-row ${isServer ? `active-server ${serveClass}` : 'neutral'}`}>
              <div className="arena-player-name-wrap">
                <span className={`arena-player-name ${dbl ? 'doubles' : 'singles'} ${isServer ? `server ${serveClass}` : 'neutral'}`}>
                  {name}
                </span>
                {isServer && (
                  <span className={`tv-serve-label ${serveClass}`}>
                    {sideOut ? (isSecondServe ? '2ND SERVE' : '1ST SERVE') : 'SERVE'}
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
function ObsOverlayView({ match, bgMode }) {
  const st = match.live_state;
  const finished = match.session_management.status === 'finished' || st.phase === 'finished';

  return (
    <div className={`obs-canvas bg-${bgMode}`}>
      {/* Top-Left Corner Broadcast Scorebug */}
      <div className="obs-top-left">
        <BroadcastScorebug match={match} />
      </div>

      {/* Optional Lower-Third Banner when Match Finished or Interval */}
      {(finished || st.phase === 'interval' || st.phase === 'set_break') && (
        <div className="obs-lower-third">
          <div className="obs-lt-accent" />
          <div className="obs-lt-body">
            <div className="obs-lt-kicker">
              {finished
                ? `OFFICIAL WINNER · ${match.tournament_name}`
                : st.phase === 'interval'
                ? 'MATCH INTERVAL'
                : `END OF GAME ${st.current_set}`}
            </div>
            <div className="obs-lt-headline">
              {finished
                ? `${teamLabel(match, st.winner)} (${match.teams[`team_${st.winner}`]?.club || ''})`
                : `${teamLabel(match, 'a')}  vs  ${teamLabel(match, 'b')}`}
            </div>
          </div>
          <div className="obs-lt-score">
            {st.set_history.length > 0
              ? st.set_history.map((s) => `${s.a}-${s.b}`).join('  ·  ')
              : `${st.score.a} - ${st.score.b}`}
          </div>
        </div>
      )}
    </div>
  );
}

function Idle({ court, upcoming, isObs, bgMode }) {
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
  return (
    <div className="tv-idle">
      <div className="big">COURT {court}</div>
      {upcoming?.length ? (
        <>
          <div style={{ fontSize: '2.2vw', color: '#cbd5e1', fontWeight: 700 }}>JADWAL PERTANDINGAN BERIKUTNYA</div>
          <table>
            <tbody>
              {upcoming.map((u) => (
                <tr key={u.match_number}>
                  <td style={{ color: 'var(--gold)', fontWeight: 900 }}>{u.match_number}</td>
                  <td>{[u.scheduled_date, u.scheduled_time].filter(Boolean).join(' · ')}</td>
                  <td>
                    {u.team_a} <span style={{ color: '#64748b' }}>vs</span> {u.team_b}
                  </td>
                  <td style={{ color: '#94a3b8' }}>{u.category_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
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
  const params = useSearchParams();
  const court = params.get('court');
  const matchId = params.get('match');
  const initialMode = params.get('mode') === 'obs' ? 'obs' : 'arena';
  const initialBg = params.get('bg') || 'transparent'; // transparent | green | dark

  const [mode, setMode] = useState(initialMode);
  const [bgMode, setBgMode] = useState(initialBg);
  const [match, setMatch] = useState(null);
  const [upcoming, setUpcoming] = useState([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setMode(params.get('mode') === 'obs' ? 'obs' : 'arena');
    if (params.get('bg')) setBgMode(params.get('bg'));
  }, [params]);

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
          setUpcoming(r.snapshot.upcoming);
          setError(null);
        } else setError(r.error);
      } else {
        const r = await emitAck('match:watch', { match_number: matchId });
        if (r.ok) {
          setMatch(r.match);
          setError(null);
        } else setError(r.error);
      }
    };
    const onCourt = (snap) => {
      if (String(snap.court) !== String(court)) return;
      setMatch(snap.match);
      setUpcoming(snap.upcoming);
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

  return (
    <div className={`tv ${isObs ? `obs-mode bg-${bgMode}` : 'arena-mode'}`}>
      {/* Hover Control Toolbar (Auto-hidden during broadcast / fullscreen unless hovered at top-right) */}
      <div className="tv-toolbar">
        <button
          type="button"
          className={`btn btn-sm ${!isObs ? 'btn-primary' : ''}`}
          onClick={() => setMode('arena')}
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
          }}
          title="Pratinjau Simulasi Kamera Livestream"
        >
          👁️ Preview Kamera
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            if (document.fullscreenElement) document.exitFullscreen();
            else document.documentElement.requestFullscreen?.();
          }}
        >
          ⛶ Fullscreen
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
            <ObsOverlayView match={match} bgMode={bgMode} />
          ) : (
            <ArenaBoard match={match} />
          )
        ) : (
          <Idle court={court || '-'} upcoming={upcoming} isObs={isObs} bgMode={bgMode} />
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
