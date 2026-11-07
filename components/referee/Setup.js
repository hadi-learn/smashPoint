'use client';
import { useMemo, useState } from 'react';
import { courtPositions, detailsToInput, isDoubles, other, playerName, teamLabel, teamSeedBadge } from '@/lib/engine';
import CourtMap from '../CourtMap';
import { Shuttle, Target } from '../Icons';
import { MatchInfo } from './Entry';

function NamesEditor({ match, send, pending }) {
  const dbl = isDoubles(match);
  const init = () => ({
    team_a: {
      p1: match.teams.team_a.p1,
      p2: match.teams.team_a.p2 || '',
      club: match.teams.team_a.club || '',
      details: detailsToInput(match.teams.team_a.details),
    },
    team_b: {
      p1: match.teams.team_b.p1,
      p2: match.teams.team_b.p2 || '',
      club: match.teams.team_b.club || '',
      details: detailsToInput(match.teams.team_b.details),
    },
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
          ✏️ Local Override (Koreksi Nama / Club / Seeded / Lapangan)
        </button>
      </div>
    );
  }
  const save = async () => {
    const names = {};
    for (const t of ['team_a', 'team_b']) {
      names[t] = { p1: f[t].p1, club: f[t].club, details: f[t].details };
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
          <input className="input" value={f[t].details} onChange={(e) => set(t, 'details', e.target.value)} placeholder="Seeded / Detail (contoh: 1 atau [3/4])" />
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
  const suggested = st.current_set > 1 ? st.service_status.side : null;
  const initialServer = suggested ? (dbl ? st.positions?.[suggested]?.even || `${suggested}1` : `${suggested}1`) : null;
  const oppSuggested = suggested ? other(suggested) : null;
  const initialReceiver = oppSuggested ? (dbl ? st.positions?.[oppSuggested]?.even || `${oppSuggested}1` : `${oppSuggested}1`) : null;
  const [server, setServer] = useState(initialServer);
  const [receiver, setReceiver] = useState(initialReceiver);

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
    const srvTeam = pid[0];
    const rcvTeam = other(srvTeam);
    setServer(pid);
    if (dbl) {
      setPos((p) => {
        const nextP = moveToEven(p, pid);
        if (!receiver || receiver[0] === srvTeam) {
          setReceiver(nextP[rcvTeam]?.even || `${rcvTeam}1`);
        }
        return nextP;
      });
    } else setReceiver(`${rcvTeam}1`);
  };
  const pickReceiver = (pid) => {
    if (!server || pid[0] === server[0]) return;
    setReceiver(pid);
    setPos((p) => moveToEven(p, pid));
  };
  const swapTeam = (t) => {
    setPos((p) => {
      const nextEven = p[t].odd;
      const nextOdd = p[t].even;
      if (server?.[0] === t && nextEven) setServer(nextEven);
      if (receiver?.[0] === t && nextEven) setReceiver(nextEven);
      return { ...p, [t]: { even: nextEven, odd: nextOdd } };
    });
  };

  const right = other(left);
  const ready = server && receiver;
  const start = () =>
    send('SETUP_START', { left, positions: dbl ? pos : undefined, server_id: server, receiver_id: dbl ? receiver : undefined });

  const steps = [
    ['Sisi Lapangan', true],
    ...(dbl ? [['Posisi Pemain', true]] : []),
    ['Servis Pertama', Boolean(server)],
    ['Penerima Pertama', Boolean(receiver)],
  ];

  // Helper to render the vertical side control column for the Left or Right court half
  const renderSidePositionCol = (screenSide) => {
    const t = screenSide === 'left' ? left : right;
    const topSlot = screenSide === 'left' ? 'left_top' : 'right_top';
    const bottomSlot = screenSide === 'left' ? 'left_bottom' : 'right_bottom';
    const topPid = positions[topSlot];
    const bottomPid = positions[bottomSlot];
    const topBoxLabel = screenSide === 'left' ? 'Atas (Kiri/Ganjil)' : 'Atas (Kanan/Genap)';
    const bottomBoxLabel = screenSide === 'left' ? 'Bawah (Kanan/Genap)' : 'Bawah (Kiri/Ganjil)';

    return (
      <div className={`setup-side-col ${screenSide}`}>
        <div className="setup-side-hdr">
          {screenSide === 'left' ? '◀ SISI KIRI' : 'SISI KANAN ▶'}
        </div>

        {/* Top Player Slot Info + Quick Actions */}
        <div className={`setup-slot-card ${server === topPid ? 'is-srv' : receiver === topPid ? 'is-rcv' : ''}`}>
          <div className="setup-slot-tag">⬆ Posisi {topBoxLabel}</div>
          <div className="setup-slot-name">{playerName(match, topPid) || '-'}</div>
          {topPid && (
            <div className="setup-slot-actions">
              <button
                type="button"
                className={`icon-btn shuttle ${server === topPid ? 'on' : ''}`}
                onClick={() => pickServer(topPid)}
              >
                <Shuttle size={14} /> Servis
              </button>
              {dbl && (
                <button
                  type="button"
                  className={`icon-btn target ${receiver === topPid ? 'on' : ''}`}
                  disabled={!server || topPid[0] === server[0]}
                  onClick={() => pickReceiver(topPid)}
                >
                  <Target /> Terima
                </button>
              )}
            </div>
          )}
        </div>

        {/* Center Swap Button (Atas <-> Bawah) for this side's team */}
        {dbl && (
          <button
            type="button"
            className="btn btn-sm setup-swap-vertical-btn"
            onClick={() => swapTeam(t)}
            title={`Tukar posisi Atas ⇅ Bawah untuk pasangan Tim ${t.toUpperCase()}`}
          >
            ⇅ Tukar Atas ↕ Bawah ({ screenSide === 'left' ? 'Kiri' : 'Kanan' })
          </button>
        )}

        {/* Bottom Player Slot Info + Quick Actions */}
        <div className={`setup-slot-card ${server === bottomPid ? 'is-srv' : receiver === bottomPid ? 'is-rcv' : ''}`}>
          <div className="setup-slot-tag">⬇ Posisi {bottomBoxLabel}</div>
          <div className="setup-slot-name">{playerName(match, bottomPid) || '-'}</div>
          {bottomPid && (
            <div className="setup-slot-actions">
              <button
                type="button"
                className={`icon-btn shuttle ${server === bottomPid ? 'on' : ''}`}
                onClick={() => pickServer(bottomPid)}
              >
                <Shuttle size={14} /> Servis
              </button>
              {dbl && (
                <button
                  type="button"
                  className={`icon-btn target ${receiver === bottomPid ? 'on' : ''}`}
                  disabled={!server || bottomPid[0] === server[0]}
                  onClick={() => pickReceiver(bottomPid)}
                >
                  <Target /> Terima
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="container col" style={{ maxWidth: 1480 }}>
      {st.current_set > 1 && (
        <div className="notice info">
          Persiapan Set {st.current_set}. Tim sudah bertukar tempat. Pemenang set sebelumnya: <b>{teamLabel(match, suggested)}</b> melakukan servis pertama.
          <div className="spacer" />
          <button className="btn btn-sm btn-yellow" disabled={!match.can_undo || pending} onClick={() => send('UNDO')}>
            ↶ UNDO
          </button>
        </div>
      )}
      <div className="setup-grid" style={{ gridTemplateColumns: 'minmax(290px, 390px) 1fr' }}>
        <div className="card col">
          <h3>1. Verifikasi Data Pertandingan</h3>
          <p className="muted small" style={{ margin: 0 }}>
            Cocokkan data fisik pemain di lapangan dengan data di tablet. Gunakan Local Override jika ada typo.
          </p>
          <NamesEditor key={match.version} match={match} send={send} pending={pending} />
        </div>
        <div className="card col">
          <div className="row">
            <h3 style={{ margin: 0 }}>2. Undian (Toss) &amp; Posisi Awal</h3>
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

          {/* BAGIAN ATAS LAPANGAN: Pemilihan Sisi Lapangan Kiri <-> Kanan */}
          <div className="setup-top-sides-bar">
            <div className="setup-side-team left">
              <span className="setup-side-badge left">◀ LAPANGAN KIRI</span>
              <span className="tname">
                {teamLabel(match, left)}
                {teamSeedBadge(match, left) && <span className="seed-pill">{teamSeedBadge(match, left)}</span>}
              </span>
              <span className="tclub">{match.teams[`team_${left}`].club || '-'}</span>
            </div>

            <button
              type="button"
              className="btn btn-blue setup-swap-sides-btn"
              onClick={() => setLeft(other(left))}
              title="Tukar sisi lapangan pasangan Kiri dan Kanan"
            >
              ⇄ Tukar Sisi Lapangan (Kiri ↔ Kanan)
            </button>

            <div className="setup-side-team right">
              <span className="setup-side-badge right">LAPANGAN KANAN ▶</span>
              <span className="tname">
                {teamLabel(match, right)}
                {teamSeedBadge(match, right) && <span className="seed-pill">{teamSeedBadge(match, right)}</span>}
              </span>
              <span className="tclub">{match.teams[`team_${right}`].club || '-'}</span>
            </div>
          </div>

          {/* BAGIAN TENGAH: Kontrol Posisi Atas/Bawah Kiri | Gambar Lapangan Landscape | Kontrol Posisi Atas/Bawah Kanan */}
          <div className="setup-court-stage">
            {renderSidePositionCol('left')}

            <div className="setup-court-center">
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

            {renderSidePositionCol('right')}
          </div>

          <div className="small muted">
            {!server && '1️⃣ Pilih Sisi Kiri/Kanan di atas lapangan, atur posisi pemain Atas/Bawah di samping kiri & kanan lapangan, lalu tekan tombol "Servis" pada pemain yang melakukan servis pertama.'}
            {server && !receiver && '2️⃣ Tekan tombol "Terima" pada pemain lawan yang menerima servis pertama.'}
            {ready && `✅ Siap Mulai! Servis: ${playerName(match, server)} → Penerima: ${playerName(match, receiver)}. Keduanya otomatis ditempatkan di kotak kanan (genap) sesuai aturan skor 0-0.`}
          </div>
          <button className="btn btn-green btn-lg btn-block" disabled={!ready || pending || !connected} onClick={start}>
            🔒 Kunci Posisi &amp; Mulai Laga
          </button>
        </div>
      </div>
    </div>
  );
}
