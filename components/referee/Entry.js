'use client';
import { useEffect, useState } from 'react';
import { DISCIPLINE_LABEL, isDoubles, matchDurationText, teamSeedBadge, teamSeedText } from '@/lib/engine';
import { api, getSocket, lsGet, lsSet, useNow } from '@/lib/client';

export const STATUS_BADGE = {
  scheduled: ['Terjadwal', ''],
  locked: ['Setup', 'blue'],
  in_progress: ['Berlangsung', 'green'],
  finished: ['Selesai', 'gold'],
};

export function StatusBadge({ match }) {
  const s = match?.session_management?.status || 'scheduled';
  const [label, cls] = STATUS_BADGE[s] || [s, ''];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function MatchInfo({ match }) {
  const now = useNow(1000);
  const r = match.rules;
  const dbl = isDoubles(match);
  const dur = matchDurationText(match, now);
  const info = [
    ['Turnamen', match.tournament_name || '-'],
    ['Kategori', match.category_name || '-'],
    ['Disiplin', `${match.discipline} · ${DISCIPLINE_LABEL[match.discipline] || ''}`],
    ['Metode Skor', r.scoring_method === 'side_out' ? 'Side-out (Pindah Bola)' : 'Rally Point'],
    ['Tipe', r.scoring_type === 'sets' ? 'Sets (Best of 3)' : 'Continuous (Skor Panjang)'],
    ['Poin Menang', r.win_point + (r.scoring_type === 'sets' ? ` (maks ${r.max_point || r.win_point + 9})` : '')],
    ['Interval', r.interval_point || '-'],
    ['Tanggal', match.scheduled_date || '-'],
    ['Lapangan', match.court_number],
    ['Jam', match.scheduled_time || '-'],
    ...(dur ? [['Durasi', `⏱ ${dur}`]] : []),
  ];
  const team = (t) => {
    const tm = match.teams[`team_${t}`];
    const seed = teamSeedText(tm.details);
    return (
      <div className="team-card">
        <div className="row" style={{ gap: '.4rem' }}>
          <span className="muted small">TIM {t.toUpperCase()}</span>
          {seed && <span className="seed-pill">{seed}</span>}
        </div>
        <div className="pl">{tm.p1}</div>
        {dbl && <div className="pl">{tm.p2}</div>}
        <div className="muted">{tm.club || '-'}</div>
      </div>
    );
  };
  return (
    <div className="col">
      <div className="info-grid">
        {info.map(([k, v]) => (
          <div key={k}>
            <div className="k">{k}</div>
            <div className="v">{v}</div>
          </div>
        ))}
      </div>
      <div className="vs-grid">
        {team('a')}
        <div className="vs">VS</div>
        {team('b')}
      </div>
    </div>
  );
}

export function EntryScreen({ label, setLabel, deviceId, onOpen }) {
  const [code, setCode] = useState('');
  const [courtCount, setCourtCount] = useState(15);
  const [activeProfile, setActiveProfile] = useState(null);
  const [court, setCourt] = useState(null);
  const [list, setList] = useState(null);
  const [nameAlert, setNameAlert] = useState(false);
  const [hideFinished, setHideFinished] = useState(false);

  const hasName = Boolean(String(label || '').trim());

  useEffect(() => {
    setHideFinished(Boolean(lsGet('sp_ref_hide_finished', false)));
    api('/api/config').then((c) => {
      if (c.court_count) setCourtCount(c.court_count);
      if (c.active_profile) setActiveProfile(c.active_profile);
    });
    const s = getSocket();
    const onProfileSwitched = ({ active_profile }) => {
      if (active_profile) setActiveProfile(active_profile);
    };
    s.on('profile:switched', onProfileSwitched);
    return () => s.off('profile:switched', onProfileSwitched);
  }, []);

  useEffect(() => {
    if (!court) return;
    setList(null);
    api(`/api/matches?court=${court}`).then((r) => setList(r.matches || []));
  }, [court, activeProfile?.id]);

  const toggleHideFinished = () => {
    setHideFinished((prev) => {
      const next = !prev;
      lsSet('sp_ref_hide_finished', next);
      return next;
    });
  };

  const tryOpen = (matchNumber) => {
    if (!hasName) {
      setNameAlert(true);
      return;
    }
    setNameAlert(false);
    onOpen(matchNumber);
  };

  return (
    <div className="container col" style={{ maxWidth: 960 }}>
      <div className="card col" style={{ borderColor: !hasName ? 'var(--gold)' : 'var(--line)' }}>
        <div className="row">
          <h2 style={{ margin: 0 }}>👤 Identitas Wasit (Wajib Diisi)</h2>
          {activeProfile && (
            <span className="badge blue" title={activeProfile.description || 'Profil Turnamen Aktif'}>
              🏆 {activeProfile.name}
            </span>
          )}
          <div className="spacer" />
          {hasName ? (
            <span className="badge green">✓ Identitas Siap: {label.trim()}</span>
          ) : (
            <span className="badge gold">⚠ Wajib Diisi Sebelum Memilih Match</span>
          )}
        </div>
        {(nameAlert || !hasName) && (
          <div className={`notice ${nameAlert ? 'error' : 'warn'} small`}>
            {nameAlert
              ? '⚠️ Harap isi Nama Wasit terlebih dahulu pada kolom di bawah sebelum membuka atau memilih pertandingan!'
              : 'ℹ️ Masukkan nama lengkap atau panggilan Anda sebagai identitas Wasit yang bertugas sebelum memilih pertandingan.'}
          </div>
        )}
        <div className="row">
          <label className="field" style={{ flex: 1, minWidth: 220 }}>
            Nama Wasit Bertugas (tampil pada laporan &amp; pengontrol lapangan) *
            <input
              className="input"
              style={{
                fontSize: '1.15rem',
                fontWeight: 700,
                borderColor: !hasName ? 'var(--gold)' : undefined,
              }}
              value={label}
              placeholder="Contoh: Wasit Budi / Umpire Andi (Lap. 3)"
              onChange={(e) => {
                setLabel(e.target.value);
                if (e.target.value.trim()) setNameAlert(false);
              }}
              maxLength={40}
              autoFocus={!hasName}
            />
          </label>
          <div className="small muted">
            ID Perangkat:
            <br />
            <span className="mono">{deviceId}</span>
          </div>
        </div>
      </div>

      <form
        className="card col"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) tryOpen(code.trim().toUpperCase());
        }}
      >
        <h3>Masukkan Nomor Pertandingan</h3>
        <div className="row">
          <input
            className="input"
            style={{ flex: 1, fontSize: '1.6rem', fontWeight: 800, textTransform: 'uppercase' }}
            value={code}
            placeholder="M-101 / A-B#1"
            onChange={(e) => setCode(e.target.value)}
            autoCapitalize="characters"
          />
          <button className="btn btn-primary btn-lg" type="submit" disabled={!code.trim() || !hasName}>
            Buka Match
          </button>
        </div>
      </form>

      <div className="card col">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Atau pilih dari Jadwal Lapangan</h3>
          <button
            type="button"
            className={`btn btn-sm ${hideFinished ? 'btn-yellow' : 'btn-ghost'}`}
            onClick={toggleHideFinished}
            title="Sembunyikan atau tampilkan pertandingan yang sudah selesai"
          >
            {hideFinished ? '👁️ Tampilkan Match Selesai' : '🙈 Sembunyikan Match Selesai'}
          </button>
        </div>
        <div className="court-links" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))' }}>
          {Array.from({ length: courtCount }, (_, i) => (
            <button key={i} className={`btn btn-sm ${court === i + 1 ? 'btn-primary' : ''}`} onClick={() => setCourt(i + 1)} type="button">
              {i + 1}
            </button>
          ))}
        </div>
        {court && (() => {
          const isMatchFinished = (m) => m.session_management?.status === 'finished' || m.live_state?.phase === 'finished';
          const finishedCount = list ? list.filter(isMatchFinished).length : 0;
          const visibleList = list ? (hideFinished ? list.filter((m) => !isMatchFinished(m)) : list) : null;

          return (
            <div className="col">
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="muted small">
                  Jadwal Lapangan {court}
                  {list ? ` · Menampilkan ${visibleList.length} dari ${list.length} pertandingan` : ''}
                  {hideFinished && finishedCount > 0 ? ` (${finishedCount} selesai disembunyikan)` : ''}
                </div>
                {list && finishedCount > 0 && (
                  <button
                    type="button"
                    className={`btn btn-sm ${hideFinished ? 'btn-blue' : 'btn-ghost'}`}
                    onClick={toggleHideFinished}
                  >
                    {hideFinished ? `👁️ Lihat ${finishedCount} Match Selesai` : `🙈 Sembunyikan ${finishedCount} Selesai`}
                  </button>
                )}
              </div>
              {!list && <div className="muted">Memuat…</div>}
              {list && !list.length && <div className="muted">Belum ada match di lapangan ini.</div>}
              {list && list.length > 0 && visibleList.length === 0 && (
                <div className="notice info small row" style={{ justifyContent: 'space-between' }}>
                  <span>Semua pertandingan ({finishedCount} match) di Lapangan {court} sudah selesai.</span>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={toggleHideFinished}>
                    Tampilkan Semua
                  </button>
                </div>
              )}
              {visibleList?.map((m) => (
                <button
                  key={m.match_number}
                  className="list-item"
                  style={{ opacity: hasName ? 1 : 0.7 }}
                  onClick={() => tryOpen(m.match_number)}
                  type="button"
                >
                  <div style={{ minWidth: 105 }}>
                    <div style={{ fontWeight: 900, fontSize: '1.1rem' }}>{m.match_number}</div>
                    {m.scheduled_date && <div className="small muted">{m.scheduled_date}</div>}
                    <div className="small muted">{m.scheduled_time}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700 }}>
                      {[m.teams.team_a.p1, m.teams.team_a.p2].filter(Boolean).join(' / ')}
                      {teamSeedBadge(m, 'a') && <span className="seed-pill">{teamSeedBadge(m, 'a')}</span>}{' '}
                      <span className="muted">vs</span>{' '}
                      {[m.teams.team_b.p1, m.teams.team_b.p2].filter(Boolean).join(' / ')}
                      {teamSeedBadge(m, 'b') && <span className="seed-pill">{teamSeedBadge(m, 'b')}</span>}
                    </div>
                    <div className="small muted">
                      {m.category_name} · {m.discipline}
                    </div>
                  </div>
                  <div className="col" style={{ alignItems: 'flex-end', gap: '.3rem' }}>
                    <StatusBadge match={m} />
                    {m.session_management.locked && <span className="badge red">🔒 {m.session_management.controller_label || m.session_management.controller_tag}</span>}
                  </div>
                </button>
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
