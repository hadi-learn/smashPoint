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
    if (!autoFit || !hasRallies) {
      setMeasuredLimit(null);
      return undefined;
    }
    const el = wrapRef.current;
    if (!el) return undefined;
    const host = el.parentElement || el;

    const computeFit = () => {
      const hostWidth = host.clientWidth || el.clientWidth || 0;
      if (!hostWidth) return;
      // Subtract container horizontal padding (~16px) and optional left team label column width
      const innerWidth = Math.max(0, hostWidth - 18);
      const teamLabelWidth = showTeamNames ? (compact ? 56 : 75) : 0;
      const availableWidth = Math.max(0, innerWidth - teamLabelWidth);
      const colWidth = compact ? 21 : 27;
      const colGap = 3;
      const cols = Math.floor((availableWidth + colGap) / (colWidth + colGap));
      const clamped = Math.max(5, Math.min(60, cols));
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
  }, [autoFit, hasRallies, compact, showTeamNames]);

  const effectiveLimit = autoFit && measuredLimit ? measuredLimit : limit;

  const rallies = useMemo(() => {
    return getRecentRallies(match, effectiveLimit, false);
  }, [match?.live_state?.rally_history, effectiveLimit]);

  if (!rallies || rallies.length === 0) {
    return null; // Do not render if no rallies yet
  }

  const topName = teamLabel(match, topSide);
  const bottomName = teamLabel(match, bottomSide);
  const dynamicTitle = title || `${rallies.length} RALLY TERAKHIR`;

  const renderCell = (r, team, isTopRow) => {
    const winner = r.winner;
    const srv = r.server_side;
    const isServer = srv === team;
    const isWinner = winner === team;
    const scoreVal = r.score ? r.score[team] : '-';
    const isSecondServe = r.second_serve || (isServer && r.server_turn === 2);
    const isSideOut = r.side_out;

    // Determine visual style tone
    let tone = 'loser-receiver'; // Default neutral/grayed out
    if (isWinner && isServer) {
      tone = 'winner-server'; // High-contrast gold / yellow
    } else if (isWinner && !isServer) {
      tone = 'winner-receiver'; // High-contrast green (break / side-out + point)
    } else if (isServer && !isWinner) {
      tone = 'loser-server'; // Server that lost the rally
    }

    // Pure symbols for serves: 1 dot for 1st serve, 2 dots for 2nd serve, ⇄ for side-out
    let symbol = null;
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

    return (
      <div
        className={`rhs-cell ${tone} ${compact ? 'compact' : ''} ${isWinner ? 'is-winner' : 'is-loser'}`}
        title={`Reli #${r.rally_number} (Set ${r.set}): ${team.toUpperCase()} Skor ${scoreVal}${isServer ? (isSecondServe ? ' · Servis ke-2' : ' · Servis ke-1') : isWinner ? ' · Pindah Servis' : ''}`}
      >
        <span className="rhs-score">{scoreVal}</span>
        <div className="rhs-symbol-slot">
          {symbol || <span className="rhs-symbol-spacer" />}
        </div>
      </div>
    );
  };

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
