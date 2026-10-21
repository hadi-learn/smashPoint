'use client';
import { useMemo, useState } from 'react';
import { courtPositions, isDoubles, other, playerName, teamLabel } from '@/lib/engine';
import CourtMap from '../CourtMap';
import { Shuttle, Target } from '../Icons';
import { MatchInfo } from './Entry';

function NamesEditor({ match, send, pending }) {
  const dbl = isDoubles(match);
  const init = () => ({
    team_a: { p1: match.teams.team_a.p1, p2: match.teams.team_a.p2 || '', club: match.teams.team_a.club || '' },
    team_b: { p1: match.teams.team_b.p1, p2: match.teams.team_b.p2 || '', club: match.teams.team_b.club || '' },
    court: String(match.court_number),
  });
  const [f, setF] = useState(init);
  const [editing, setEditing] = useState(false);
  const set = (t, k, v) => setF((x) => ({ ...x, [t]: { ...x[t], [k]: v } }));

  if (!editing) {
    return (
      <div className="col">
        <MatchInfo match={match} />
        <button
          className="btn btn-red"
          onClick={() => {
            setF(init());
            setEditing(true);
          }}
        >
          ✏️ Local Override (Koreksi Nama / Club / Lapangan)
        </button>
      </div>
    );
  }
  const save = async () => {
    const names = {};
    for (const t of ['team_a', 'team_b']) {
      names[t] = { p1: f[t].p1, club: f[t].club };
      if (dbl) names[t].p2 = f[t].p2;
    }
    const payload = { names };
    if (String(match.court_number) !== f.court) payload.court_number = f.court;
    const r = await send('OVERRIDE', payload);
    if (r?.ok) setEditing(false);
  };
  return (
    <div className="col">
      {['team_a', 'team_b'].map((t) => (
        <div key={t} className="team-card col">
          <div className="muted small">TIM {t.slice(-1).toUpperCase()}</div>
          <input className="input" value={f[t].p1} onChange={(e) => set(t, 'p1', e.target.value)} placeholder="Pemain 1" />
          {dbl && <input className="input" value={f[t].p2} onChange={(e) => set(t, 'p2', e.target.value)} placeholder="Pemain 2" />}
          <input className="input" value={f[t].club} onChange={(e) => set(t, 'club', e.target.value)} placeholder="Club / PB" />
        </div>
      ))}
      <label className="field">
        Nomor Lapangan
        <input className="input" type="number" min={1} value={f.court} onChange={(e) => setF((x) => ({ ...x, court: e.target.value }))} />
      </label>
      <div className="row">
        <button className="btn btn-green" onClick={save} disabled={pending}>
          Simpan & Sinkronkan
        </button>
        <button className="btn btn-ghost" onClick={() => setEditing(false)}>
          Batal
        </button>
      </div>
    </div>
  );
}

export default function SetupScreen({ match, send, pending, connected }) {
  const st = match.live_state;
  const dbl = isDoubles(match);
  const [left, setLeft] = useState(st.sides.left);
  const [pos, setPos] = useState(dbl ? st.positions : { a: { even: 'a1', odd: null }, b: { even: 'b1', odd: null } });
  const [server, setServer] = useState(null);
  const [receiver, setReceiver] = useState(null);
  const suggested = st.current_set > 1 ? st.service_status.side : null;

  const preview = useMemo(
    () => ({
      ...match,
      live_state: { ...st, score: { a: 0, b: 0 }, sides: { left, right: other(left) }, positions: pos, service_status: { side: server ? server[0] : 'a' } },
    }),
    [match, st, left, pos, server],
  );
  const positions = courtPositions(preview);

  const moveToEven = (p, pid) => {
    const t = pid[0];
    if (p[t].odd === pid) return { ...p, [t]: { even: pid, odd: p[t].even } };
    return p;
  };
  const pickServer = (pid) => {
    setServer(pid);
    if (dbl) {
      setPos((p) => moveToEven(p, pid));
      if (receiver && receiver[0] === pid[0]) setReceiver(null);
    } else setReceiver(`${other(pid[0])}1`);
  };
  const pickReceiver = (pid) => {
    if (!server || pid[0] === server[0]) return;
    setReceiver(pid);
    setPos((p) => moveToEven(p, pid));
  };
  const swapTeam = (t) => {
    setPos((p) => ({ ...p, [t]: { even: p[t].odd, odd: p[t].even } }));
    if (server?.[0] === t) setServer(null);
    if (receiver?.[0] === t) setReceiver(null);
  };

  const ready = server && receiver;
  const start = () =>
    send('SETUP_START', { left, positions: dbl ? pos : undefined, server_id: server, receiver_id: dbl ? receiver : undefined });

  const steps = [
    ['Sisi Lapangan', true],
    ...(dbl ? [['Posisi Pemain', true]] : []),
    ['Servis Pertama', Boolean(server)],
    ['Penerima Pertama', Boolean(receiver)],
  ];

  return (
    <div className="container col" style={{ maxWidth: 1400 }}>
      {st.current_set > 1 && (
        <div className="notice info">
          Persiapan Set {st.current_set}. Tim sudah bertukar tempat. Pemenang set sebelumnya: <b>{teamLabel(match, suggested)}</b> melakukan servis pertama.
          <div className="spacer" />
          <button className="btn btn-sm btn-yellow" disabled={!match.can_undo || pending} onClick={() => send('UNDO')}>
            ↶ UNDO
          </button>
        </div>
      )}
      <div className="setup-grid" style={{ gridTemplateColumns: 'minmax(300px, 420px) 1fr' }}>
        <div className="card col">
          <h3>1. Verifikasi Data Pertandingan</h3>
          <p className="muted small" style={{ margin: 0 }}>
            Cocokkan data fisik pemain di lapangan dengan data di tablet. Gunakan Local Override jika ada typo.
          </p>
          <NamesEditor key={match.version} match={match} send={send} pending={pending} />
        </div>
        <div className="card col">
          <div className="row">
            <h3 style={{ margin: 0 }}>2. Undian (Toss) & Posisi Awal</h3>
            <div className="spacer" />
            <div className="steps">
              {steps.map(([s, done]) => (
                <span key={s} className={`step ${done ? 'done' : ''}`}>
                  {done ? '✓ ' : ''}
                  {s}
                </span>
              ))}
            </div>
          </div>
          <div className="row">
            <button className="btn btn-blue" onClick={() => setLeft(other(left))}>
              ⇄ Tukar Sisi Tim (Kiri ↔ Kanan)
            </button>
            {dbl && (
              <>
                <button className="btn" onClick={() => swapTeam(left)}>
                  ⇅ Tukar Posisi Tim Kiri
                </button>
                <button className="btn" onClick={() => swapTeam(other(left))}>
                  ⇅ Tukar Posisi Tim Kanan
                </button>
              </>
            )}
          </div>
          <div className="scoreline">
            <div className="team">
              <span className="muted small">KIRI</span>
              <span className="tname">{teamLabel(match, left)}</span>
              <span className="small muted">{match.teams[`team_${left}`].club}</span>
            </div>
            <div className="mid">VS</div>
            <div className="team right">
              <span className="muted small">KANAN</span>
              <span className="tname">{teamLabel(match, other(left))}</span>
              <span className="small muted">{match.teams[`team_${other(left)}`].club}</span>
            </div>
          </div>
          <div style={{ minHeight: 330, display: 'flex' }}>
            <CourtMap
              match={match}
              positions={positions}
              serverId={server}
              receiverId={receiver}
              spinKey={left}
              renderActions={(pid) => (
                <>
                  <button className={`icon-btn shuttle ${server === pid ? 'on' : ''}`} onClick={() => pickServer(pid)} title="Pemenang undian servis">
                    <Shuttle size={18} /> Servis
                  </button>
                  {dbl && (
                    <button className={`icon-btn target ${receiver === pid ? 'on' : ''}`} onClick={() => pickReceiver(pid)} disabled={!server || pid[0] === server[0]} title="Penerima servis">
                      <Target /> Terima
                    </button>
                  )}
                </>
              )}
            />
          </div>
          <div className="small muted">
            {!server && 'Tekan ikon shuttlecock pada pemain yang menang undian servis.'}
            {server && !receiver && 'Tekan ikon target pada pemain lawan yang menerima servis.'}
            {ready && `Servis: ${playerName(match, server)} → Penerima: ${playerName(match, receiver)}. Keduanya otomatis ditempatkan di kotak kanan (genap) sesuai aturan skor 0.`}
          </div>
          <button className="btn btn-green btn-lg btn-block" disabled={!ready || pending || !connected} onClick={start}>
            🔒 Kunci Posisi & Mulai Laga
          </button>
        </div>
      </div>
    </div>
  );
}
