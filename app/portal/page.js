'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, getSocket, useNow } from '@/lib/client';
import {
  DISCIPLINE_LABEL,
  formatDuration,
  formatLocalDateTime,
  matchDurationText,
  parseScheduleDateValue,
  teamLabel,
  teamSeedBadge,
} from '@/lib/engine';
import RallyHistoryStrip from '@/components/RallyHistoryStrip';

function getSetScoreSummary(match) {
  if (!match) return [];
  const sets = Array.isArray(match.sets) ? [...match.sets] : [];
  if (match.status === 'live' && match.live) {
    const idx = sets.findIndex((s) => Number(s.set) === Number(match.live.current_set));
    const cur = { set: match.live.current_set, A: match.live.scoreA ?? 0, B: match.live.scoreB ?? 0 };
    if (idx >= 0) sets[idx] = { ...sets[idx], ...cur };
    else sets.push(cur);
  }
  return sets;
}

function PublicMatchDetailModal({ match, onClose }) {
  if (!match) return null;
  const sets = getSetScoreSummary(match);
  const dur = matchDurationText(match);
  const labelA = teamLabel(match.teamA || {});
  const labelB = teamLabel(match.teamB || {});
  const seedA = teamSeedBadge(match.teamA || {});
  const seedB = teamSeedBadge(match.teamB || {});
  const winnerSide = match.winner === 'A' ? 'A' : match.winner === 'B' ? 'B' : null;
  const totalRallies = Array.isArray(match.rally_history) ? match.rally_history.length : 0;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal portal-detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="row" style={{ gap: '.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="pill">{match.id}</span>
              <span className="pill">{DISCIPLINE_LABEL[match.category] || match.category}</span>
              {match.round && <span className="pill">{match.round}</span>}
              {match.court && <span className="pill">Lap {match.court}</span>}
              <span className={`pill ${match.status === 'finished' ? 'green' : match.status === 'live' ? 'red' : 'amber'}`}>
                {match.status === 'finished' ? 'Selesai' : match.status === 'live' ? 'LIVE' : 'Terjadwal'}
              </span>
            </div>
            <h2 style={{ margin: '.4rem 0 0', fontSize: '1.15rem' }}>Detail Pertandingan &amp; Histori Reli</h2>
          </div>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            ✕ Tutup
          </button>
        </div>

        <div className="portal-detail-teams">
          <div className={`portal-detail-team ${winnerSide === 'A' ? 'winner' : ''}`}>
            <div className="portal-detail-team-name">
              {winnerSide === 'A' && <span className="portal-win-badge">🏆 MENANG</span>}
              <span>{labelA}</span>
              {seedA && <span className="seed-tag">{seedA}</span>}
            </div>
            {match.teamA?.club && <div className="muted small">{match.teamA.club}</div>}
          </div>

          <div className="portal-detail-vs">
            {sets.length > 0 ? (
              <div className="portal-detail-sets">
                {sets.map((s) => (
                  <div key={s.set} className="portal-detail-set-pill">
                    <span className="muted small">S{s.set}</span>
                    <strong>
                      {s.A ?? 0} - {s.B ?? 0}
                    </strong>
                  </div>
                ))}
              </div>
            ) : (
              <span className="muted">VS</span>
            )}
          </div>

          <div className={`portal-detail-team ${winnerSide === 'B' ? 'winner' : ''}`}>
            <div className="portal-detail-team-name">
              {winnerSide === 'B' && <span className="portal-win-badge">🏆 MENANG</span>}
              <span>{labelB}</span>
              {seedB && <span className="seed-tag">{seedB}</span>}
            </div>
            {match.teamB?.club && <div className="muted small">{match.teamB.club}</div>}
          </div>
        </div>

        <div className="portal-detail-meta">
          {dur && <span>⏱️ Durasi: <strong>{dur}</strong></span>}
          {match.referee && <span>👨‍⚖️ Wasit: <strong>{match.referee}</strong></span>}
          {match.scheduled_time && <span>🗓️ Jadwal: <strong>{formatLocalDateTime(match.scheduled_time)}</strong></span>}
          <span>🏸 Total Reli: <strong>{totalRallies}</strong></span>
          {Number(match.shuttlecock_count) > 0 && (
            <span>🪶 Shuttlecock: <strong>{match.shuttlecock_count}</strong></span>
          )}
          {match.live?.retirement && (
            <span style={{ color: '#f87171' }}>
              🚑 Status: <strong>{match.live.retirement.tag} ({match.live.retirement.reason})</strong>
            </span>
          )}
        </div>

        {totalRallies > 0 ? (
          <div style={{ marginTop: '.75rem' }}>
            <RallyHistoryStrip
              match={match}
              multiRow
              perRow={22}
              groupBySet
              showLabel
              showTeamNames
              title={`Histori Reli Lengkap (${totalRallies} Reli)`}
            />
          </div>
        ) : (
          <div className="card" style={{ marginTop: '.75rem', textAlign: 'center', padding: '1rem' }}>
            <span className="muted">Belum ada data histori reli untuk pertandingan ini.</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function PublicPortalPage() {
  const [matches, setMatches] = useState([]);
  const [courts, setCourts] = useState({});
  const [config, setConfig] = useState({
    tournament_name: 'SmashPoint Tournament',
    venue: '',
    courts_count: 4,
    active_profile_name: '',
  });
  const [tab, setTab] = useState('live');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [dateFilter, setDateFilter] = useState('ALL');
  const [selectedMatchId, setSelectedMatchId] = useState(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const now = useNow(1000);

  const loadData = useCallback(async () => {
    try {
      const [mRes, cRes, cfgRes] = await Promise.all([
        api('/api/matches'),
        api('/api/courts'),
        api('/api/config'),
      ]);
      setMatches(Array.isArray(mRes.matches) ? mRes.matches : []);
      setCourts(cRes.courts || {});
      if (cfgRes) {
        setConfig((prev) => ({ ...prev, ...cfgRes }));
      }
    } catch {
      // ignore transient error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const socket = getSocket();
    const onConnect = () => {
      setConnected(true);
      socket.emit('courts:watch_all');
    };
    const onDisconnect = () => setConnected(false);
    const onCourtState = (payload) => {
      if (!payload) return;
      if (payload.courts) {
        setCourts(payload.courts);
      } else if (payload.court) {
        setCourts((prev) => ({ ...prev, [payload.court]: payload }));
      }
      if (payload.match) {
        setMatches((prev) => {
          const idx = prev.findIndex((m) => m.id === payload.match.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = { ...next[idx], ...payload.match };
            return next;
          }
          return [payload.match, ...prev];
        });
      }
    };
    const onMatchUpdated = (m) => {
      if (!m || !m.id) return;
      setMatches((prev) => {
        const idx = prev.findIndex((x) => x.id === m.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = m;
          return next;
        }
        return [m, ...prev];
      });
    };
    const onProfileSwitched = () => {
      loadData();
    };

    if (socket.connected) onConnect();
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('court:state', onCourtState);
    socket.on('match:updated', onMatchUpdated);
    socket.on('profile:switched', onProfileSwitched);

    const timer = setInterval(loadData, 15000);
    return () => {
      clearInterval(timer);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('court:state', onCourtState);
      socket.off('match:updated', onMatchUpdated);
      socket.off('profile:switched', onProfileSwitched);
    };
  }, [loadData]);

  const categories = useMemo(() => {
    const set = new Set();
    for (const m of matches) {
      if (m.category) set.add(m.category);
    }
    return Array.from(set).sort();
  }, [matches]);

  const scheduleDates = useMemo(() => {
    const set = new Set();
    for (const m of matches) {
      const parsed = parseScheduleDateValue(m.scheduled_time);
      if (parsed?.dateKey) set.add(parsed.dateKey);
    }
    return Array.from(set).sort();
  }, [matches]);

  const filteredMatches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return matches.filter((m) => {
      if (categoryFilter !== 'ALL' && m.category !== categoryFilter) return false;
      if (dateFilter !== 'ALL') {
        const parsed = parseScheduleDateValue(m.scheduled_time);
        if (parsed?.dateKey !== dateFilter) return false;
      }
      if (!q) return true;
      const text = [
        m.id,
        m.round,
        m.category,
        DISCIPLINE_LABEL[m.category],
        teamLabel(m.teamA || {}),
        teamLabel(m.teamB || {}),
        m.teamA?.club,
        m.teamB?.club,
        m.referee,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return text.includes(q);
    });
  }, [matches, search, categoryFilter, dateFilter]);

  const liveMatches = useMemo(
    () => filteredMatches.filter((m) => m.status === 'live').sort((a, b) => Number(a.court || 99) - Number(b.court || 99)),
    [filteredMatches],
  );

  const scheduledMatches = useMemo(
    () =>
      filteredMatches
        .filter((m) => m.status === 'scheduled' || m.status === 'pending' || !m.status)
        .sort((a, b) => String(a.scheduled_time || '').localeCompare(String(b.scheduled_time || '')) || String(a.id).localeCompare(String(b.id))),
    [filteredMatches],
  );

  const finishedMatches = useMemo(
    () =>
      filteredMatches
        .filter((m) => m.status === 'finished')
        .sort((a, b) => String(b.finished_at || b.scheduled_time || '').localeCompare(String(a.finished_at || a.scheduled_time || ''))),
    [filteredMatches],
  );

  const courtNumbers = useMemo(() => {
    const count = Math.max(1, Number(config.courts_count) || 4);
    return Array.from({ length: count }, (_, i) => i + 1);
  }, [config.courts_count]);

  const selectedMatch = useMemo(
    () => matches.find((m) => m.id === selectedMatchId) || null,
    [matches, selectedMatchId],
  );

  return (
    <main className="container portal-page">
      <header className="portal-hero">
        <div className="portal-hero-top">
          <div>
            <div className="portal-badge-row">
              <span className="pill green">🌐 PORTAL PENONTON &amp; PESERTA</span>
              <span className={`pill ${connected ? 'blue' : 'amber'}`}>
                {connected ? '● LIVE TERHUBUNG' : '○ MENYAMBUNG...'}
              </span>
            </div>
            <h1 className="portal-title">{config.tournament_name || 'SmashPoint Tournament'}</h1>
            <p className="muted small" style={{ margin: '.2rem 0 0' }}>
              {config.venue ? `📍 ${config.venue} · ` : ''}
              Pantau Live Score tiap lapangan, Jadwal Pertandingan, serta Hasil &amp; Histori Reli secara real-time.
            </p>
          </div>
          <div className="row" style={{ gap: '.5rem' }}>
            <Link href="/" className="btn btn-sm">
              ← Beranda
            </Link>
            <Link href="/livescore" className="btn btn-sm btn-blue">
              🏟️ Layar GOR
            </Link>
          </div>
        </div>

        <div className="portal-stats-row">
          <div className="portal-stat-box live">
            <span className="portal-stat-num">{matches.filter((m) => m.status === 'live').length}</span>
            <span className="portal-stat-lbl">Sedang Bermain</span>
          </div>
          <div className="portal-stat-box sched">
            <span className="portal-stat-num">{matches.filter((m) => m.status === 'scheduled' || m.status === 'pending' || !m.status).length}</span>
            <span className="portal-stat-lbl">Jadwal Berikutnya</span>
          </div>
          <div className="portal-stat-box done">
            <span className="portal-stat-num">{matches.filter((m) => m.status === 'finished').length}</span>
            <span className="portal-stat-lbl">Pertandingan Selesai</span>
          </div>
        </div>
      </header>

      <section className="portal-toolbar">
        <div className="portal-tabs">
          <button
            type="button"
            className={`portal-tab ${tab === 'live' ? 'active' : ''}`}
            onClick={() => setTab('live')}
          >
            🔴 Live Score ({liveMatches.length})
          </button>
          <button
            type="button"
            className={`portal-tab ${tab === 'schedule' ? 'active' : ''}`}
            onClick={() => setTab('schedule')}
          >
            📅 Jadwal ({scheduledMatches.length})
          </button>
          <button
            type="button"
            className={`portal-tab ${tab === 'results' ? 'active' : ''}`}
            onClick={() => setTab('results')}
          >
            🏆 Hasil &amp; Histori Reli ({finishedMatches.length})
          </button>
        </div>

        <div className="portal-filters">
          <input
            type="search"
            className="input portal-search"
            placeholder="Cari nama pemain, klub, atau Match ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="input"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            style={{ width: 'auto', minWidth: '140px' }}
          >
            <option value="ALL">Semua Kategori</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {DISCIPLINE_LABEL[cat] || cat}
              </option>
            ))}
          </select>
          {scheduleDates.length > 0 && (
            <select
              className="input"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              style={{ width: 'auto', minWidth: '130px' }}
            >
              <option value="ALL">Semua Tanggal</option>
              {scheduleDates.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          )}
        </div>
      </section>

      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
          <span className="muted">Memuat data turnamen...</span>
        </div>
      ) : tab === 'live' ? (
        <section className="portal-live-grid">
          {courtNumbers.map((courtNum) => {
            const cState = courts[courtNum] || {};
            const liveMatch =
              liveMatches.find((m) => Number(m.court) === courtNum) ||
              (cState.match && cState.match.status === 'live' ? cState.match : null);
            const live = liveMatch?.live || cState.live;
            const sets = getSetScoreSummary(liveMatch);

            if (!liveMatch) {
              return (
                <div key={courtNum} className="card portal-court-card idle">
                  <div className="portal-court-head">
                    <span className="pill">Lapangan {courtNum}</span>
                    <span className="muted small">Menunggu Pertandingan</span>
                  </div>
                  <div className="portal-court-empty">
                    <span>🏸 Belum ada pertandingan aktif di Lapangan {courtNum}</span>
                  </div>
                </div>
              );
            }

            const elapsed = live?.started_at ? formatDuration(Math.max(0, now - live.started_at)) : '';
            return (
              <div
                key={courtNum}
                className="card portal-court-card active clickable"
                onClick={() => setSelectedMatchId(liveMatch.id)}
              >
                <div className="portal-court-head">
                  <div className="row" style={{ gap: '.35rem' }}>
                    <span className="pill red">● LIVE · Lap {courtNum}</span>
                    <span className="pill">{DISCIPLINE_LABEL[liveMatch.category] || liveMatch.category}</span>
                    {liveMatch.round && <span className="pill">{liveMatch.round}</span>}
                  </div>
                  {elapsed && <span className="muted small">⏱️ {elapsed}</span>}
                </div>

                <div className="portal-scoreboard">
                  <div className={`portal-sb-row ${live?.server === 'A' ? 'serving' : ''}`}>
                    <div className="portal-sb-team">
                      <span className="portal-serve-dot">{live?.server === 'A' ? '🏸' : ''}</span>
                      <div>
                        <div className="portal-sb-name">{teamLabel(liveMatch.teamA || {})}</div>
                        {liveMatch.teamA?.club && <div className="muted small">{liveMatch.teamA.club}</div>}
                      </div>
                    </div>
                    <div className="portal-sb-scores">
                      {sets.map((s) => (
                        <span
                          key={s.set}
                          className={`portal-set-box ${Number(s.set) === Number(live?.current_set) ? 'current' : ''}`}
                        >
                          {s.A ?? 0}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className={`portal-sb-row ${live?.server === 'B' ? 'serving' : ''}`}>
                    <div className="portal-sb-team">
                      <span className="portal-serve-dot">{live?.server === 'B' ? '🏸' : ''}</span>
                      <div>
                        <div className="portal-sb-name">{teamLabel(liveMatch.teamB || {})}</div>
                        {liveMatch.teamB?.club && <div className="muted small">{liveMatch.teamB.club}</div>}
                      </div>
                    </div>
                    <div className="portal-sb-scores">
                      {sets.map((s) => (
                        <span
                          key={s.set}
                          className={`portal-set-box ${Number(s.set) === Number(live?.current_set) ? 'current' : ''}`}
                        >
                          {s.B ?? 0}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="portal-court-foot">
                  <span className="muted small">
                    Set {live?.current_set || 1} · {liveMatch.id}
                  </span>
                  <span className="small" style={{ color: '#60a5fa' }}>
                    Klik untuk detail &amp; histori reli →
                  </span>
                </div>
              </div>
            );
          })}
        </section>
      ) : tab === 'schedule' ? (
        <section className="portal-list">
          {scheduledMatches.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
              <span className="muted">Tidak ada jadwal pertandingan yang cocok dengan filter.</span>
            </div>
          ) : (
            scheduledMatches.map((m) => (
              <div key={m.id} className="card portal-match-row">
                <div className="portal-match-meta">
                  <span className="pill">{m.id}</span>
                  <span className="pill">{DISCIPLINE_LABEL[m.category] || m.category}</span>
                  {m.round && <span className="pill">{m.round}</span>}
                  {m.court ? <span className="pill blue">Lap {m.court}</span> : <span className="pill amber">Lapangan menyusul</span>}
                  {m.scheduled_time && (
                    <span className="muted small">🗓️ {formatLocalDateTime(m.scheduled_time)}</span>
                  )}
                </div>
                <div className="portal-match-teams">
                  <div className="portal-match-side">
                    <strong>{teamLabel(m.teamA || {})}</strong>
                    {m.teamA?.club && <span className="muted small"> · {m.teamA.club}</span>}
                  </div>
                  <span className="muted small">VS</span>
                  <div className="portal-match-side">
                    <strong>{teamLabel(m.teamB || {})}</strong>
                    {m.teamB?.club && <span className="muted small"> · {m.teamB.club}</span>}
                  </div>
                </div>
              </div>
            ))
          )}
        </section>
      ) : (
        <section className="portal-list">
          {finishedMatches.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
              <span className="muted">Belum ada pertandingan yang selesai sesuai filter.</span>
            </div>
          ) : (
            finishedMatches.map((m) => {
              const sets = getSetScoreSummary(m);
              const dur = matchDurationText(m);
              const totalRallies = Array.isArray(m.rally_history) ? m.rally_history.length : 0;
              return (
                <div
                  key={m.id}
                  className="card portal-match-row clickable"
                  onClick={() => setSelectedMatchId(m.id)}
                >
                  <div className="portal-match-meta">
                    <span className="pill">{m.id}</span>
                    <span className="pill">{DISCIPLINE_LABEL[m.category] || m.category}</span>
                    {m.round && <span className="pill">{m.round}</span>}
                    {m.court && <span className="pill">Lap {m.court}</span>}
                    {dur && <span className="muted small">⏱️ {dur}</span>}
                    <span className="muted small">🏸 {totalRallies} Reli</span>
                    <span className="small" style={{ marginLeft: 'auto', color: '#38bdf8' }}>
                      Lihat Histori Reli →
                    </span>
                  </div>
                  <div className="portal-result-grid">
                    <div className={`portal-result-team ${m.winner === 'A' ? 'winner' : ''}`}>
                      <span>
                        {m.winner === 'A' ? '🏆 ' : ''}
                        {teamLabel(m.teamA || {})}
                      </span>
                      {m.teamA?.club && <span className="muted small">{m.teamA.club}</span>}
                    </div>
                    <div className="portal-result-scores">
                      {sets.map((s) => (
                        <span key={s.set} className="portal-set-box">
                          {s.A ?? 0} - {s.B ?? 0}
                        </span>
                      ))}
                    </div>
                    <div className={`portal-result-team ${m.winner === 'B' ? 'winner' : ''}`}>
                      <span>
                        {m.winner === 'B' ? '🏆 ' : ''}
                        {teamLabel(m.teamB || {})}
                      </span>
                      {m.teamB?.club && <span className="muted small">{m.teamB.club}</span>}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </section>
      )}

      {selectedMatch && (
        <PublicMatchDetailModal match={selectedMatch} onClose={() => setSelectedMatchId(null)} />
      )}
    </main>
  );
}
