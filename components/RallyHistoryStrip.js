'use client';
import { useMemo } from 'react';
import { getRecentRallies, teamLabel } from '@/lib/engine';

/**
 * RallyHistoryStrip
 * Displays dynamic recent rally/serve history boxes (up to N rallies).
 *
 * Requirements:
 *  - Dynamic count: if there are 5 rallies, renders exactly 5 columns.
 *    If 7 rallies, renders exactly 7 columns. Up to max `limit` (e.g. 10).
 *    NO empty placeholder/dashed boxes! If 0 rallies, renders nothing.
 *  - Strict vertical alignment (Top vs Bottom):
 *    Top row corresponds to Top Team (e.g. Team A / Left Side).
 *    Bottom row corresponds to Bottom Team (e.g. Team B / Right Side).
 *  - In each vertical column, the rally winner is rendered with high-contrast vibrant color,
 *    while the losing receiver/opponent is neutral/grayed-out, making rally progression instantly clear.
 *  - Indicators: S1 (1st serve), S2 (2nd serve), ⇄ (Side-out / serve change), +1 (point gained).
 */
export default function RallyHistoryStrip({
  match,
  limit = 10,
  topSide = 'a',
  bottomSide = 'b',
  compact = false,
  showLabel = true,
  showTeamNames = true,
  title = 'HISTORI RELI',
  className = '',
}) {
  const rallies = useMemo(() => {
    return getRecentRallies(match, limit, false);
  }, [match?.live_state?.rally_history, limit]);

  if (!rallies || rallies.length === 0) {
    return null; // Do not render if no rallies yet
  }

  const topName = teamLabel(match, topSide);
  const bottomName = teamLabel(match, bottomSide);

  const renderCell = (r, team, isTopRow) => {
    const winner = r.winner;
    const srv = r.server_side;
    const isServer = srv === team;
    const isWinner = winner === team;
    const scoreVal = r.score ? r.score[team] : '-';
    const pointDelta = r.point_delta ? r.point_delta[team] : 0;
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

    // Badge indicator: S1, S2, ⇄, +1
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
        title={`Reli #${r.rally_number} (Set ${r.set}): ${team.toUpperCase()} Skor ${scoreVal}${badgeTitle ? ` · ${badgeTitle}` : ''}`}
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
            {rallies.length} Servis Terakhir
          </span>
        </div>
      )}

      <div className="rhs-body-layout">
        {/* Optional Team Name Indicator Column on the Left for crystal clear Atas vs Bawah reading */}
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
