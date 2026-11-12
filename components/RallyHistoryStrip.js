'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getRecentRallies, teamLabel } from '@/lib/engine';

/**
 * RallyHistoryStrip
 * Displays dynamic recent rally/serve history boxes (up to N rallies).
 *
 * Requirements:
 *  - Dynamic count: if there are 5 rallies, renders exactly 5 columns.
 *    If 7 rallies, renders exactly 7 columns. Up to max `effectiveLimit`.
 *    NO empty placeholder/dashed boxes! If 0 rallies, renders nothing.
 *  - Auto-fit width (`autoFit={true}` for LiveScore multi-court):
 *    Dynamically measures the available container width via ResizeObserver
 *    so 1-court view can fit ~40+ rallies, 2-court view ~25+ rallies, etc.,
 *    automatically adjusting when reaching max allowed card width.
 *  - Strict vertical alignment (Top vs Bottom):
 *    Top row corresponds to Top Team (e.g. Team A / Left Side).
 *    Bottom row corresponds to Bottom Team (e.g. Team B / Right Side).
 *  - Symbols for serves:
 *    Serve 1: single dot '●'
 *    Serve 2: double dot '● ●'
 *    Side-out / Break: transfer arrow '⇄'
 *    No text letters like S1/S2!
 *  - Dynamic single header (no redundant counters):
 *    Real-time: `${rallies.length} RALLY TERAKHIR`
 */
export default function RallyHistoryStrip({
  match,
  limit = 10,
  autoFit = false,
  multiRow = false,
  perRow = 20,
  groupBySet = false,
  topSide = 'a',
  bottomSide = 'b',
  compact = false,
  showLabel = true,
  showTeamNames = false,
  title = null,
  className = '',
}) {
  const wrapRef = useRef(null);
  const [measuredLimit, setMeasuredLimit] = useState(null);

  const hasRallies = Boolean(match?.live_state?.rally_history?.length);

  useEffect(() => {
    if (!autoFit || multiRow || !hasRallies) {
      setMeasuredLimit(null);
      return undefined;
    }
    const el = wrapRef.current;
    if (!el) return undefined;
    const host = el.parentElement || el;

    const computeFit = () => {
      const hostWidth = host.clientWidth || el.clientWidth || 0;
      if (!hostWidth) return;

      // Measure actual horizontal padding of host + wrapper if available
      const hostStyle = typeof window !== 'undefined' ? window.getComputedStyle(host) : null;
      const hostPadX = hostStyle
        ? (parseFloat(hostStyle.paddingLeft) || 0) + (parseFloat(hostStyle.paddingRight) || 0)
        : 18;
      const innerWidth = Math.max(0, hostWidth - Math.max(18, hostPadX));

      // Measure actual rendered left team label column width (e.g. 11vw on Arena TV dock)
      const labelEl = el.querySelector('.rhs-team-labels');
      const teamLabelWidth = showTeamNames
        ? (labelEl?.offsetWidth ? labelEl.offsetWidth + 8 : compact ? 56 : 75)
        : 0;
      const availableWidth = Math.max(0, innerWidth - teamLabelWidth);

      // Measure actual rendered cell width & column gap (e.g. 2.35vw on Arena TV dock)
      const sampleCell = el.querySelector('.rhs-cell');
      const scrollEl = el.querySelector('.rhs-cols-scroll');
      const scrollStyle = scrollEl && typeof window !== 'undefined' ? window.getComputedStyle(scrollEl) : null;
      const colWidth = sampleCell?.offsetWidth || (compact ? 21 : 27);
      const colGap = scrollStyle ? parseFloat(scrollStyle.columnGap || scrollStyle.gap) || 3 : 3;

      const cols = Math.floor((availableWidth + colGap) / (colWidth + colGap));
      const clamped = Math.max(4, Math.min(60, cols));
      setMeasuredLimit((prev) => (prev === clamped ? prev : clamped));
    };

    computeFit();

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(computeFit);
      ro.observe(host);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', computeFit);
    return () => window.removeEventListener('resize', computeFit);
  }, [autoFit, multiRow, hasRallies, compact, showTeamNames]);

  const effectiveLimit = multiRow ? 99999 : autoFit && measuredLimit ? measuredLimit : limit;

  const rallies = useMemo(() => {
    if (multiRow) {
      return match?.live_state?.rally_history || [];
    }
    return getRecentRallies(match, effectiveLimit, false);
  }, [match?.live_state?.rally_history, effectiveLimit, multiRow]);

  if (!rallies || rallies.length === 0) {
    return null; // Do not render if no rallies yet
  }

  const topName = teamLabel(match, topSide);
  const bottomName = teamLabel(match, bottomSide);
  const dynamicTitle = title || (multiRow ? `HISTORI RELI LENGKAP (${rallies.length} RELI)` : `${rallies.length} RALLY TERAKHIR`);
  const isSideOutMode = match?.rules?.scoring_method === 'side_out';

  const renderCell = (r, team, isTopRow) => {
    const winner = r.winner;
    const srv = r.server_side;
    const isServer = srv === team;
    const isWinner = winner === team;
    const scoreVal = r.score ? r.score[team] : '-';
    const isSecondServe = r.second_serve || (isServer && r.server_turn === 2);
    const isSideOut = r.side_out;
    const isPenaltyRed = r.penalty_card === 'red';
    const isOffender = isPenaltyRed && r.offender_team === team;

    // Determine visual style tone
    let tone = 'loser-receiver'; // Default neutral/grayed out
    if (isOffender) {
      tone = 'penalty-offender';
    } else if (isWinner && isServer) {
      tone = 'winner-server'; // High-contrast gold / yellow
    } else if (isWinner && !isServer) {
      tone = 'winner-receiver'; // High-contrast green (break / side-out + point)
    } else if (isServer && !isWinner) {
      tone = 'loser-server'; // Server that lost the rally
    }

    // Pure symbols for serves: ONLY shown in side_out mode (never in rally_point mode), OR penalty card indicator
    let symbol = null;
    if (isOffender) {
      symbol = (
        <span className="rhs-dot-sym penalty-red" title={`Kartu Merah (${r.offender_name || ''}): ${r.reason || ''}`}>
          🟥
        </span>
      );
    } else if (isSideOutMode) {
      if (isServer) {
        if (isSecondServe) {
          symbol = (
            <span className="rhs-dot-sym serve-2" title="Servis ke-2">
              ● ●
            </span>
          );
        } else {
          symbol = (
            <span className="rhs-dot-sym serve-1" title="Servis ke-1">
              ●
            </span>
          );
        }
      } else if (isWinner && isSideOut) {
        symbol = (
          <span className="rhs-dot-sym sideout" title="Pindah Servis">
            ⇄
          </span>
        );
      }
    }

    const showSymbolSlot = isSideOutMode || isPenaltyRed;

    return (
      <div
        className={`rhs-cell ${tone} ${compact ? 'compact' : ''} ${showSymbolSlot ? 'with-symbols' : 'no-symbols'} ${isWinner ? 'is-winner' : 'is-loser'}`}
        title={`Reli #${r.rally_number} (Set ${r.set}): ${team.toUpperCase()} Skor ${scoreVal}${isOffender ? ` · 🟥 Kartu Merah (${r.offender_name}): ${r.reason}` : isSideOutMode ? (isServer ? (isSecondServe ? ' · Servis ke-2' : ' · Servis ke-1') : isWinner ? ' · Pindah Servis' : '') : ''}`}
      >
        <span className="rhs-score">{scoreVal}</span>
        {showSymbolSlot && (
          <div className="rhs-symbol-slot">
            {symbol || <span className="rhs-symbol-spacer" />}
          </div>
        )}
      </div>
    );
  };

  if (multiRow) {
    const chunkSize = Math.max(8, Number(perRow) || 20);
    // Group by set if groupBySet is enabled (or if multiple sets exist)
    const setMap = new Map();
    for (const r of rallies) {
      const sNo = groupBySet ? (r.set || 1) : 1;
      if (!setMap.has(sNo)) setMap.set(sNo, []);
      setMap.get(sNo).push(r);
    }
    const setGroups = Array.from(setMap.entries()).map(([setNo, list]) => {
      const rows = [];
      for (let i = 0; i < list.length; i += chunkSize) {
        rows.push({
          startIdx: i + 1,
          endIdx: Math.min(i + chunkSize, list.length),
          items: list.slice(i, i + chunkSize),
        });
      }
      const setMeta = match?.live_state?.set_history?.find((sh) => sh.set === setNo);
      return { setNo, totalInSet: list.length, rows, setMeta };
    });

    return (
      <div ref={wrapRef} className={`rhs-wrap multi-row ${compact ? 'compact' : ''} ${className}`}>
        {showLabel && (
          <div className="rhs-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem' }}>
            <span className="rhs-title">📊 {dynamicTitle}</span>
            <div className="row small muted" style={{ gap: '.65rem', fontSize: '.74rem' }}>
              <span><b style={{ color: '#fde047' }}>■ Kuning</b>: Servis &amp; Poin</span>
              <span><b style={{ color: '#4ade80' }}>■ Hijau</b>: Pindah Servis / Break Poin</span>
              {isSideOutMode && <span><b>● / ●●</b>: Servis 1 / 2 · <b>⇄</b>: Pindah Bola</span>}
              <span><b>🟥</b>: Poin Penalti Kartu Merah</span>
            </div>
          </div>
        )}
        <div className="rhs-multirow-stack">
          {setGroups.map((sg) => (
            <div key={`set-group-${sg.setNo}`} className="rhs-set-block">
              {(groupBySet || setGroups.length > 1) && (
                <div className="rhs-set-banner">
                  <span className="rhs-set-badge">SET {sg.setNo}</span>
                  {sg.setMeta && (
                    <span className="rhs-set-score">
                      Skor Akhir Set {sg.setNo}: <b>{sg.setMeta.a} - {sg.setMeta.b}</b>
                      {sg.setMeta.winner && (
                        <span className="rhs-set-winner">
                          {' '}· 🏆 {teamLabel(match, sg.setMeta.winner)}
                        </span>
                      )}
                    </span>
                  )}
                  <span className="rhs-set-count">{sg.totalInSet} Reli</span>
                </div>
              )}
              <div className="rhs-rows-container">
                {sg.rows.map((rowChunk, rIdx) => (
                  <div key={`set-${sg.setNo}-row-${rIdx}`} className="rhs-row-line">
                    <div className="rhs-row-meta">
                      <span className="rhs-row-range">Reli #{rowChunk.items[0]?.rally_number}–#{rowChunk.items[rowChunk.items.length - 1]?.rally_number}</span>
                    </div>
                    <div className="rhs-body-layout">
                      {showTeamNames && (
                        <div className="rhs-team-labels">
                          <div className={`rhs-team-tag top team-${topSide}`} title={topName}>
                            <span className="rhs-team-dot" />
                            <span className="rhs-team-txt">{topName}</span>
                          </div>
                          <div className={`rhs-team-tag bottom team-${bottomSide}`} title={bottomName}>
                            <span className="rhs-team-dot" />
                            <span className="rhs-team-txt">{bottomName}</span>
                          </div>
                        </div>
                      )}
                      <div className="rhs-cols-scroll" style={{ flexWrap: 'nowrap', overflowX: 'auto' }}>
                        {rowChunk.items.map((r, idx) => (
                          <div key={`rally-col-${r.rally_number || idx}`} className="rhs-vertical-col">
                            <span className="rhs-rally-num">#{r.rally_number}</span>
                            {renderCell(r, topSide, true)}
                            {renderCell(r, bottomSide, false)}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className={`rhs-wrap ${compact ? 'compact' : ''} ${autoFit ? 'auto-fit' : ''} ${className}`}>
      {showLabel && (
        <div className="rhs-header">
          <span className="rhs-title">📊 {dynamicTitle}</span>
        </div>
      )}

      <div className="rhs-body-layout">
        {/* Optional Team Name Labels on the Left (disabled for OBS scorebug to prevent clutter) */}
        {showTeamNames && (
          <div className="rhs-team-labels">
            <div className={`rhs-team-tag top team-${topSide}`} title={topName}>
              <span className="rhs-team-dot" />
              <span className="rhs-team-txt">{topName}</span>
            </div>
            <div className={`rhs-team-tag bottom team-${bottomSide}`} title={bottomName}>
              <span className="rhs-team-dot" />
              <span className="rhs-team-txt">{bottomName}</span>
            </div>
          </div>
        )}

        {/* Dynamic Rally Columns (Only exact number of rallies, up to limit) */}
        <div className="rhs-cols-scroll">
          {rallies.map((r, idx) => (
            <div key={`rally-col-${r.rally_number || idx}`} className="rhs-vertical-col">
              {/* Top Cell */}
              {renderCell(r, topSide, true)}

              {/* Bottom Cell */}
              {renderCell(r, bottomSide, false)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
