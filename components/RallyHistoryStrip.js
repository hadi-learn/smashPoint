'use client';
import { useMemo } from 'react';
import { getRecentRallies } from '@/lib/engine';

/**
 * RallyHistoryStrip
 * Displays a 2-row horizontal history strip (top player row vs bottom player row)
 * for the last N serves/rallies (default 10).
 *
 * Rules:
 *  - Winning server: score highlighted in vibrant high-contrast gold with server badge (1st / 2nd serve).
 *  - Winning receiver (rally point break): score highlighted in vibrant green with side-out/transfer badge (⇄ / +1).
 *  - Losing team / neutral receiver: muted / grayed-out box with current score.
 *  - Empty slots: clean dashed placeholder cells ensuring layout stability.
 */
export default function RallyHistoryStrip({
  match,
  limit = 10,
  topSide = 'a',
  bottomSide = 'b',
  compact = false,
  showLabel = true,
  title = '10 SERVIS TERAKHIR',
  className = '',
}) {
  const rallies = useMemo(() => {
    return getRecentRallies(match, limit, false);
  }, [match?.live_state?.rally_history, limit]);

  // Build fixed length array of columns
  const cols = useMemo(() => {
    const list = [];
    for (let i = 0; i < limit; i += 1) {
      list.push(rallies[i] || null);
    }
    return list;
  }, [rallies, limit]);

  const renderCell = (r, team, isTopRow) => {
    if (!r) {
      return (
        <div
          className={`rhs-cell empty ${compact ? 'compact' : ''}`}
          title="Menunggu reli berikutnya"
        >
          <span className="rhs-empty-dot">·</span>
        </div>
      );
    }

    const winner = r.winner;
    const srv = r.server_side;
    const isServer = srv === team;
    const isWinner = winner === team;
    const scoreVal = r.score ? r.score[team] : '-';
    const pointDelta = r.point_delta ? r.point_delta[team] : 0;
    const isSecondServe = r.second_serve || (isServer && r.server_turn === 2);
    const isSideOut = r.side_out;

    // Determine visual style tone
    let tone = 'neutral';
    if (isWinner && isServer) {
      tone = 'winner-server'; // High-contrast gold / yellow
    } else if (isWinner && !isServer) {
      tone = 'winner-receiver'; // High-contrast green / cyan (pindah servis + poin)
    } else if (isServer && !isWinner) {
      tone = 'loser-server'; // Server that lost the rally (side out to opponent)
    } else {
      tone = 'loser-receiver'; // Neutral grayed out
    }

    // Build badge indicator for serve 1, serve 2, side out, or point
    let badgeText = null;
    let badgeTitle = '';

    if (isServer) {
      if (isSecondServe) {
        badgeText = 'S2';
        badgeTitle = 'Servis ke-2';
      } else {
        badgeText = 'S1';
        badgeTitle = 'Servis ke-1';
      }
    } else if (isWinner && isSideOut) {
      badgeText = '⇄';
      badgeTitle = 'Pindah Servis';
    } else if (pointDelta > 0) {
      badgeText = '+1';
      badgeTitle = 'Poin Bertambah';
    }

    return (
      <div
        className={`rhs-cell ${tone} ${compact ? 'compact' : ''} ${isWinner ? 'is-winner' : 'is-loser'}`}
        title={`Reli #${r.rally_number} (Set ${r.set}): Tim ${team.toUpperCase()} Skor ${scoreVal}${badgeTitle ? ` · ${badgeTitle}` : ''}`}
      >
        <span className="rhs-score">{scoreVal}</span>
        {badgeText && (
          <span className={`rhs-badge ${isSecondServe ? 'serve-2' : ''}`}>
            {badgeText}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className={`rhs-wrap ${compact ? 'compact' : ''} ${className}`}>
      {showLabel && (
        <div className="rhs-header">
          <span className="rhs-title">{title}</span>
          <span className="rhs-count-info">
            {rallies.length > 0 ? `${rallies.length}/${limit}` : 'STANDBY'}
          </span>
        </div>
      )}

      <div className="rhs-grid">
        {/* Top Player Row */}
        <div className="rhs-row top-row">
          {cols.map((r, idx) => (
            <div key={`top-${idx}`} className="rhs-col-cell">
              {renderCell(r, topSide, true)}
            </div>
          ))}
        </div>

        {/* Bottom Player Row */}
        <div className="rhs-row bottom-row">
          {cols.map((r, idx) => (
            <div key={`bot-${idx}`} className="rhs-col-cell">
              {renderCell(r, bottomSide, false)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
