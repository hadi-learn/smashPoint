'use client';
import { useState } from 'react';
import { isDoubles, matchDurationText, playerName, teamLabel } from '@/lib/engine';
import CourtMap from '../CourtMap';
import { Shuttle } from '../Icons';

const T = (t) => (t ? t.toUpperCase() : '');

function OverrideModal({ match, onClose, send, pending }) {
  const st = match.live_state;
  const dbl = isDoubles(match);
  const scoringEditable = ['live', 'interval'].includes(st.phase);
  const [tab, setTab] = useState(scoringEditable ? 'score' : 'names');
  const [names, setNames] = useState({
    team_a: { p1: match.teams.team_a.p1, p2: match.teams.team_a.p2 || '', club: match.teams.team_a.club || '' },
    team_b: { p1: match.teams.team_b.p1, p2: match.teams.team_b.p2 || '', club: match.teams.team_b.club || '' },
  });
  const [score, setScore] = useState({ ...st.score });
  const [side, setSide] = useState(st.service_status.side || 'a');
  const [turn, setTurn] = useState(st.service_status.turn || 1);
  const [server, setServer] = useState(st.service_status.player_id || 'a1');
  const [pos, setPos] = useState(st.positions);
  const [court, setCourt] = useState(String(match.court_number));
  const [err, setErr] = useState(null);

  const submit = async (payload) => {
    setErr(null);
    const r = await send('OVERRIDE', payload);
    if (r?.ok) onClose();
    else if (r?.error) setErr(r.error);
  };
  const setName = (t, k, v) => setNames((x) => ({ ...x, [t]: { ...x[t], [k]: v } }));
  const bump = (t, d) => setScore((s) => ({ ...s, [t]: Math.max(0, (parseInt(s[t], 10) || 0) + d) }));
  const serverOptions = dbl ? [`${side}1`, `${side}2`] : [`${side}1`];

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal col" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2 style={{ margin: 0, color: '#f87171' }}>⚠ OVERRIDE / Koreksi Darurat</h2>
          <div className="spacer" />
          <button className="btn btn-sm btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="tabs">
          <button className={`btn btn-sm ${tab === 'score' ? 'active' : ''}`} disabled={!scoringEditable} onClick={() => setTab('score')}>
            Skor & Servis
          </button>
          <button className={`btn btn-sm ${tab === 'names' ? 'active' : ''}`} onClick={() => setTab('names')}>
            Nama & Club
          </button>
          <button className={`btn btn-sm ${tab === 'court' ? 'active' : ''}`} onClick={() => setTab('court')}>
            Lapangan
          </button>
        </div>
        {err && <div className="notice error">{err}</div>}

        {tab === 'score' && (
          <div className="col">
            <div className="row" style={{ justifyContent: 'space-around' }}>
              {['a', 'b'].map((t) => (
                <div key={t} className="col" style={{ alignItems: 'center' }}>
                  <div className="muted small">TIM {T(t)} · {teamLabel(match, t)}</div>
                  <div className="row">
                    <button className="btn btn-lg" onClick={() => bump(t, -1)}>
                      −
                    </button>
                    <input className="input" style={{ width: 90, fontSize: '2rem', textAlign: 'center', fontWeight: 900 }} type="number" min={0} value={score[t]} onChange={(e) => setScore((s) => ({ ...s, [t]: e.target.value }))} />
                    <button className="btn btn-lg" onClick={() => bump(t, 1)}>
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <label className="field">
              Tim yang servis
              <div className="row">
                {['a', 'b'].map((t) => (
                  <button
                    key={t}
                    className={`btn ${side === t ? 'btn-yellow' : ''}`}
                    onClick={() => {
                      setSide(t);
                      setServer(`${t}1`);
                    }}
                  >
                    Tim {T(t)}: {teamLabel(match, t)}
                  </button>
                ))}
              </div>
            </label>
            {dbl && (
              <label className="field">
                Pemain servis
                <div className="row">
                  {serverOptions.map((pid) => (
                    <button key={pid} className={`btn ${server === pid ? 'btn-yellow' : ''}`} onClick={() => setServer(pid)}>
                      <Shuttle size={16} /> {playerName(match, pid)}
                    </button>
                  ))}
                </div>
              </label>
            )}
            {dbl && match.rules.scoring_method === 'side_out' && (
              <label className="field">
                Giliran servis
                <div className="row">
                  {[1, 2].map((n) => (
                    <button key={n} className={`btn ${turn === n ? 'btn-blue' : ''}`} onClick={() => setTurn(n)}>
                      Servis {n === 1 ? '1 (1st)' : '2 (2nd)'}
                    </button>
                  ))}
                </div>
              </label>
            )}
            {dbl && (
              <label className="field">
                Posisi pemain (Kotak Kanan/Genap · Kotak Kiri/Ganjil)
                <div className="row">
                  {['a', 'b'].map((t) => (
                    <button key={t} className="btn" onClick={() => setPos((p) => ({ ...p, [t]: { even: p[t].odd, odd: p[t].even } }))}>
                      ⇅ Tim {T(t)}: Kanan={playerName(match, pos[t].even)} · Kiri={playerName(match, pos[t].odd)}
                    </button>
                  ))}
                </div>
              </label>
            )}
            <button className="btn btn-red btn-lg" disabled={pending} onClick={() => submit({ score, service: { side, player_id: server, turn }, positions: dbl ? pos : undefined })}>
              Terapkan Koreksi Skor & Servis
            </button>
          </div>
        )}

        {tab === 'names' && (
          <div className="col">
            {['team_a', 'team_b'].map((t) => (
              <div key={t} className="team-card col">
                <div className="muted small">TIM {t.slice(-1).toUpperCase()}</div>
                <input className="input" value={names[t].p1} onChange={(e) => setName(t, 'p1', e.target.value)} />
                {dbl && <input className="input" value={names[t].p2} onChange={(e) => setName(t, 'p2', e.target.value)} />}
                <input className="input" value={names[t].club} placeholder="Club" onChange={(e) => setName(t, 'club', e.target.value)} />
              </div>
            ))}
            <button
              className="btn btn-red btn-lg"
              disabled={pending}
              onClick={() => {
                const n = {};
                for (const t of ['team_a', 'team_b']) n[t] = dbl ? names[t] : { p1: names[t].p1, club: names[t].club };
                submit({ names: n });
              }}
            >
              Simpan Nama & Club
            </button>
          </div>
        )}

        {tab === 'court' && (
          <div className="col">
            <label className="field">
              Nomor Lapangan (TV lapangan baru akan otomatis menampilkan match ini)
              <input className="input" type="number" min={1} value={court} onChange={(e) => setCourt(e.target.value)} />
            </label>
            <button className="btn btn-red btn-lg" disabled={pending} onClick={() => submit({ court_number: court })}>
              Pindahkan Lapangan
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function TakeoverModal({ match, onClose, onSubmit }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const go = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const r = await onSubmit(pin);
    setBusy(false);
    if (r?.ok) onClose();
    else setErr(r?.error || 'Gagal');
  };
  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal col" style={{ width: 'min(440px, 100%)' }} onClick={(e) => e.stopPropagation()} onSubmit={go}>
        <h2>Ambil Alih Sesi (Takeover)</h2>
        <p className="muted small">
          Match <b>{match.match_number}</b> saat ini dikontrol oleh <b>{match.session_management.controller_label || `perangkat …${match.session_management.controller_tag}`}</b>. Masukkan Master PIN 4-digit panitia. Perangkat lama akan diputus paksa dan skor dilanjutkan tanpa kehilangan poin.
        </p>
        {err && <div className="notice error">{err}</div>}
        <input className="input pin-input" type="password" inputMode="numeric" pattern="[0-9]*" maxLength={4} autoFocus value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="••••" />
        <div className="row">
          <button className="btn btn-red btn-lg" style={{ flex: 1 }} type="submit" disabled={pin.length !== 4 || busy}>
            Ambil Alih
          </button>
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            Batal
          </button>
        </div>
      </form>
    </div>
  );
}

export default function LiveScreen({ match, now, readOnly, pending, connected, send, spectator }) {
  const [showOverride, setShowOverride] = useState(false);
  const st = match.live_state;
  const ss = st.service_status;
  const L = st.sides.left;
  const R = st.sides.right;
  const sideOutDbl = match.rules.scoring_method === 'side_out' && isDoubles(match);
  const finished = match.session_management.status === 'finished';
  const canAct = !readOnly && !pending && connected && !finished;
  const canScore = canAct && st.phase === 'live';
  const isSets = match.rules.scoring_type === 'sets';
  const duration = matchDurationText(match, now);

  const teamHeader = (t, align) => (
    <div className={`team ${align}`}>
      <span className="tname">{teamLabel(match, t)}</span>
      <span className="small muted">
        Tim {T(t)} · {match.teams[`team_${t}`].club || '-'}
      </span>
      <span className={`num ${ss.side === t ? 'serving' : ''}`}>{st.score[t]}</span>
    </div>
  );

  let overlay = null;
  if (finished) {
    overlay = (
      <div className="phase-overlay">
        <h2>HASIL AKHIR</h2>
        <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>🏆 {teamLabel(match, st.winner)}</div>
        <div className="muted">
          {st.set_history.map((s) => `${s.a}-${s.b}`).join('  ·  ')}
          {duration ? `  ·  ⏱ ${duration}` : ''}
        </div>
        {match.export_status && <span className="badge cyan">Ekspor: {match.export_status.message}</span>}
      </div>
    );
  } else if (st.phase === 'interval') {
    overlay = (
      <div className="phase-overlay">
        <h2>{st.interval_swap ? 'INTERVAL - TUKAR LAPANGAN' : 'INTERVAL'}</h2>
        <div className="muted">
          Skor {st.score[L]} - {st.score[R]}. {st.interval_swap ? 'Pemain bertukar sisi lapangan.' : 'Istirahat singkat, tanpa tukar sisi.'}
        </div>
        {!readOnly && (
          <div className="row">
            <button className="btn btn-yellow btn-lg" disabled={!canAct} onClick={() => send('UNDO')}>
              ↶ UNDO
            </button>
            <button className="btn btn-blue btn-lg" disabled={!canAct} onClick={() => send('CONFIRM_INTERVAL')}>
              {st.interval_swap ? '⇄ Konfirmasi Tukar Posisi' : '▶ Lanjutkan Permainan'}
            </button>
          </div>
        )}
      </div>
    );
  } else if (st.phase === 'set_break') {
    const last = st.set_history[st.set_history.length - 1];
    overlay = (
      <div className="phase-overlay">
        <h2>SET {st.current_set} SELESAI</h2>
        <div style={{ fontSize: '1.4rem', fontWeight: 800 }}>Pemenang: {teamLabel(match, st.game_winner)}</div>
        <div className="muted">
          Skor set: {last?.a}-{last?.b} · Sets {st.sets.a}-{st.sets.b}
        </div>
        {!readOnly && (
          <div className="row">
            <button className="btn btn-yellow btn-lg" disabled={!canAct} onClick={() => send('UNDO')}>
              ↶ UNDO
            </button>
            <button className="btn btn-green btn-lg" disabled={!canAct} onClick={() => send('NEXT_SET')}>
              ▶ Mulai Set {st.current_set + 1} (Ganti Tempat)
            </button>
          </div>
        )}
      </div>
    );
  } else if (st.phase === 'finished') {
    overlay = (
      <div className="phase-overlay">
        <h2>PERTANDINGAN SELESAI</h2>
        <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>🏆 {teamLabel(match, st.winner)}</div>
        <div className="muted">
          {st.set_history.map((s) => `${s.a}-${s.b}`).join('  ·  ')}
          {duration ? `  ·  ⏱ ${duration}` : ''}
        </div>
        {!readOnly && (
          <div className="row">
            <button className="btn btn-yellow btn-lg" disabled={!canAct} onClick={() => send('UNDO')}>
              ↶ UNDO
            </button>
            <button className="btn btn-green btn-lg" disabled={!canAct} onClick={() => send('CONFIRM_FINISH')}>
              ✔ Konfirmasi Hasil & Kirim
            </button>
          </div>
        )}
      </div>
    );
  } else if (st.phase === 'setup') {
    overlay = (
      <div className="phase-overlay">
        <h2>PERSIAPAN</h2>
        <div className="muted">Wasit sedang melakukan verifikasi, undian, dan penempatan posisi.</div>
      </div>
    );
  }

  const rallyBtn = (screen) => {
    const t = screen === 'left' ? L : R;
    return (
      <button className={`rally-btn ${screen}`} disabled={!canScore} onClick={() => send('WIN_RALLY', { side: screen })}>
        {screen === 'left' ? '◀' : '▶'}
        <span>
          TIM {screen === 'left' ? 'KIRI' : 'KANAN'}
          <br />
          MENANG RELI
        </span>
        <small>{teamLabel(match, t)}</small>
      </button>
    );
  };

  return (
    <>
      <div className="ref-live">
        {rallyBtn('left')}
        <div className="ref-center">
          <div className="scoreline">
            {teamHeader(L, '')}
            <div className="mid">
              <div>{isSets ? `SET ${st.current_set}` : 'GAME'}</div>
              {isSets && (
                <div style={{ fontSize: '1.4rem', color: 'var(--text)' }}>
                  {st.sets[L]} - {st.sets[R]}
                </div>
              )}
              <div className="small">{match.rules.scoring_method === 'side_out' ? 'SIDE-OUT' : 'RALLY'} · {match.rules.win_point}</div>
              {duration && <div className="small mono" style={{ color: 'var(--cyan)', marginTop: '.15rem' }}>⏱ {duration}</div>}
              {ss.side && st.phase !== 'setup' && (
                <div className={`badge ${sideOutDbl && ss.turn === 2 ? 'orange' : 'gold'}`} style={{ marginTop: '.3rem' }}>
                  <Shuttle size={14} />
                  {sideOutDbl && ss.turn === 2 ? <Shuttle size={14} /> : null} {ss.player_name}
                  {sideOutDbl ? ` · ${ss.turn === 2 ? '2nd Serve' : '1st Serve'}` : ''}
                </div>
              )}
            </div>
            {teamHeader(R, 'right')}
          </div>
          <CourtMap match={match} positions={st.court_positions} serverId={st.phase === 'setup' ? null : ss.player_id} receiverId={st.phase === 'setup' ? null : ss.receiver_id} serveTurn={ss.turn} spinKey={L} overlay={overlay} />
          {st.set_history.length > 0 && (
            <div className="row small muted" style={{ justifyContent: 'center' }}>
              {st.set_history.map((s) => (
                <span key={s.set} className="badge">
                  Set {s.set}: {s.a}-{s.b} ({T(s.winner)})
                </span>
              ))}
            </div>
          )}
        </div>
        {rallyBtn('right')}
      </div>
      <div className="ref-footer">
        {!readOnly && (
          <>
            <button className="btn btn-yellow" disabled={!canAct || !match.can_undo} onClick={() => send('UNDO')}>
              ↶ UNDO
            </button>
            <button
              className="btn btn-blue"
              disabled={!canAct || st.phase !== 'live'}
              onClick={() => {
                if (window.confirm('Tukar sisi tim secara manual (Kiri ↔ Kanan)?')) send('SWITCH_SIDE');
              }}
            >
              ⇄ TUKAR SISI
            </button>
            <button className="btn btn-red" disabled={!canAct} onClick={() => setShowOverride(true)}>
              ⚠ OVERRIDE
            </button>
          </>
        )}
        {spectator}
      </div>
      {showOverride && <OverrideModal match={match} onClose={() => setShowOverride(false)} send={send} pending={pending} />}
    </>
  );
}
