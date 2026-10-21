'use client';
import { useEffect, useState } from 'react';
import { DISCIPLINE_LABEL, isDoubles } from '@/lib/engine';
import { api } from '@/lib/client';

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

function detailsText(d) {
  if (!d) return null;
  if (typeof d === 'string') return d;
  return Object.entries(d)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' · ');
}

export function MatchInfo({ match }) {
  const r = match.rules;
  const dbl = isDoubles(match);
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
  ];
  const team = (t) => {
    const tm = match.teams[`team_${t}`];
    const det = detailsText(tm.details);
    return (
      <div className="team-card">
        <div className="muted small">TIM {t.toUpperCase()}</div>
        <div className="pl">{tm.p1}</div>
        {dbl && <div className="pl">{tm.p2}</div>}
        <div className="muted">{tm.club || '-'}</div>
        {det && <div className="small muted">{det}</div>}
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
  const [court, setCourt] = useState(null);
  const [list, setList] = useState(null);

  useEffect(() => {
    api('/api/config').then((c) => c.court_count && setCourtCount(c.court_count));
  }, []);

  useEffect(() => {
    if (!court) return;
    setList(null);
    api(`/api/matches?court=${court}`).then((r) => setList(r.matches || []));
  }, [court]);

  return (
    <div className="container col" style={{ maxWidth: 960 }}>
      <div className="card col">
        <h2>Controller Wasit</h2>
        <div className="row">
          <label className="field" style={{ flex: 1, minWidth: 220 }}>
            Nama perangkat / wasit (tampil saat konflik sesi)
            <input className="input" value={label} placeholder="mis. Tablet Lapangan 3" onChange={(e) => setLabel(e.target.value)} maxLength={40} />
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
          if (code.trim()) onOpen(code.trim().toUpperCase());
        }}
      >
        <h3>Masukkan Nomor Pertandingan</h3>
        <div className="row">
          <input className="input" style={{ flex: 1, fontSize: '1.6rem', fontWeight: 800, textTransform: 'uppercase' }} value={code} placeholder="M-101" onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" />
          <button className="btn btn-primary btn-lg" type="submit" disabled={!code.trim()}>
            Buka Match
          </button>
        </div>
      </form>

      <div className="card col">
        <h3>Atau pilih dari Jadwal Lapangan</h3>
        <div className="court-links" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))' }}>
          {Array.from({ length: courtCount }, (_, i) => (
            <button key={i} className={`btn btn-sm ${court === i + 1 ? 'btn-primary' : ''}`} onClick={() => setCourt(i + 1)} type="button">
              {i + 1}
            </button>
          ))}
        </div>
        {court && (
          <div className="col">
            <div className="muted small">Jadwal Lapangan {court}</div>
            {!list && <div className="muted">Memuat…</div>}
            {list && !list.length && <div className="muted">Belum ada match di lapangan ini.</div>}
            {list?.map((m) => (
              <button key={m.match_number} className="list-item" onClick={() => onOpen(m.match_number)} type="button">
                <div style={{ minWidth: 105 }}>
                  <div style={{ fontWeight: 900, fontSize: '1.1rem' }}>{m.match_number}</div>
                  {m.scheduled_date && <div className="small muted">{m.scheduled_date}</div>}
                  <div className="small muted">{m.scheduled_time}</div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>
                    {[m.teams.team_a.p1, m.teams.team_a.p2].filter(Boolean).join(' / ')} <span className="muted">vs</span> {[m.teams.team_b.p1, m.teams.team_b.p2].filter(Boolean).join(' / ')}
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
        )}
      </div>
    </div>
  );
}
