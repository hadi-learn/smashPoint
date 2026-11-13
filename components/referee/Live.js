'use client';
import { useState } from 'react';
import { breakCountdownInfo, BWF_CARD_REASONS, BWF_CARD_TYPES, BWF_RETIRE_REASONS, courtPositions, detailsToInput, isDoubles, matchDurationText, other, playerName, teamLabel, teamSeedBadge } from '@/lib/engine';
import CourtMap from '../CourtMap';
import { Shuttle } from '../Icons';

const T = (t) => (t ? t.toUpperCase() : '');

function PenaltyCardModal({ match, onClose, send, pending }) {
  const st = match.live_state;
  const dbl = isDoubles(match);
  const canIssueRed = st.phase === 'live';
  const [team, setTeam] = useState('a');
  const [playerId, setPlayerId] = useState('a1');
  const [cardType, setCardType] = useState('yellow');
  const [reasonPreset, setReasonPreset] = useState(BWF_CARD_REASONS[0]);
  const [customNote, setCustomNote] = useState('');
  const [err, setErr] = useState(null);

  const cards = Array.isArray(st.cards) ? st.cards : [];
  const playerCards = cards.filter((c) => c.player_id === playerId || c.team === team);
  const hasYellowAlready = playerCards.some((c) => c.type === 'yellow');

  const selectTeam = (t) => {
    setTeam(t);
    setPlayerId(`${t}1`);
  };

  const handleIssue = async (e) => {
    e.preventDefault();
    setErr(null);
    const fullReason = customNote.trim()
      ? `${reasonPreset} — ${customNote.trim()}`
      : reasonPreset;
    if (cardType === 'black') {
      const oppName = teamLabel(match, other(team));
      if (!window.confirm(`KONFIRMASI KARTU HITAM (DISKUALIFIKASI BWF Law 16.7.2):\n\nDiskualifikasi ${playerName(match, playerId)} (Tim ${T(team)}) dan menangkan lawan (${oppName}) sekarang?`)) {
        return;
      }
    }
    const r = await send('ISSUE_CARD', {
      card_type: cardType,
      team,
      player_id: playerId,
      reason: fullReason,
    });
    if (r?.ok) onClose();
    else if (r?.error) setErr(r.error);
  };

  const selectedMeta = BWF_CARD_TYPES[cardType] || BWF_CARD_TYPES.yellow;
  const oppTeam = other(team);

  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal col" style={{ width: 'min(720px, 100%)' }} onClick={(e) => e.stopPropagation()} onSubmit={handleIssue}>
        <div className="row">
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '.45rem' }}>
            <span>🟨🟥</span> Kartu Pelanggaran Resmi BWF / PBSI
          </h2>
          <span className="badge gold">BWF Law 16</span>
          <div className="spacer" />
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Ringkasan Peraturan Resmi BWF & PBSI */}
        <div className="col" style={{ background: '#0a1328', padding: '.7rem .85rem', borderRadius: 10, border: '1px solid var(--line)', gap: '.3rem' }}>
          <div className="small" style={{ fontWeight: 800, color: 'var(--gold)' }}>
            📖 Panduan Regulasi Resmi BWF (Clause 16.6 &amp; 16.7) &amp; PBSI:
          </div>
          <div className="small muted" style={{ lineHeight: 1.45 }}>
            • <b>🟨 Kartu Kuning (Warning / Peringatan — Law 16.7.1.1):</b> Diberikan atas pelanggaran pertama (menunda permainan, merusak shuttlecock, membanting raket, coaching saat reli, perilaku tidak sportif). <b>Tidak mengubah skor maupun servis.</b>
            <br />
            • <b>🟥 Kartu Merah (Fault for Misconduct — Law 16.7.1.2):</b> Diberikan atas pelanggaran kedua setelah Kartu Kuning atau pelanggaran berat. <b>Dihitung sebagai FAULT (Pelanggaran Reli):</b> Lawan otomatis mendapat <b>+1 Poin &amp; Servis</b> (Rally Point) atau <b>Pindah Servis / +1 Poin</b> (Side-Out).
            <br />
            • <b>⬛ Kartu Hitam (Disqualification — Law 16.7.2):</b> Atas persetujuan Referee untuk pelanggaran sangat berat. Pemain didiskualifikasi &amp; lawan langsung dinyatakan menang.
          </div>
        </div>

        {err && <div className="notice error">{err}</div>}

        {/* Pilih Tim & Pemain */}
        <div className="col" style={{ gap: '.45rem' }}>
          <span className="small" style={{ fontWeight: 800 }}>1. Pilih Tim &amp; Pemain yang Melanggar:</span>
          <div className="row" style={{ gap: '.5rem' }}>
            {['a', 'b'].map((t) => {
              const tCards = cards.filter((c) => c.team === t);
              return (
                <button
                  key={t}
                  type="button"
                  className={`btn ${team === t ? 'btn-primary' : ''}`}
                  style={{ flex: 1, justifyContent: 'space-between', padding: '.65rem .85rem' }}
                  onClick={() => selectTeam(t)}
                >
                  <span>
                    <b>Tim {T(t)}:</b> {teamLabel(match, t)}
                  </span>
                  {tCards.length > 0 && (
                    <span className="row" style={{ gap: 2 }}>
                      {tCards.map((c) => (
                        <span key={c.card_id} title={`${c.player_name}: ${c.reason}`}>
                          {c.type === 'yellow' ? '🟨' : c.type === 'red' ? '🟥' : '⬛'}
                        </span>
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {dbl && (
            <div className="row" style={{ gap: '.5rem' }}>
              {[`${team}1`, `${team}2`].map((pid) => (
                <button
                  key={pid}
                  type="button"
                  className={`btn btn-sm ${playerId === pid ? 'btn-yellow' : ''}`}
                  style={{ flex: 1 }}
                  onClick={() => setPlayerId(pid)}
                >
                  👤 {playerName(match, pid)}
                </button>
              ))}
            </div>
          )}

          {hasYellowAlready && cardType === 'yellow' && (
            <div className="notice warn small">
              ⚠️ Tim/Pemain ini sudah menerima <b>🟨 Kartu Kuning</b> sebelumnya pada pertandingan ini. Sesuai <b>BWF Law 16.7.1.2</b>, pelanggaran berikutnya disarankan menggunakan <b>🟥 Kartu Merah (Fault / Poin Lawan)</b>.
            </div>
          )}
        </div>

        {/* Pilih Jenis Kartu */}
        <div className="col" style={{ gap: '.45rem' }}>
          <span className="small" style={{ fontWeight: 800 }}>2. Pilih Jenis Kartu Pelanggaran:</span>
          <div className="row" style={{ gap: '.5rem' }}>
            <button
              type="button"
              className={`btn ${cardType === 'yellow' ? 'btn-yellow' : ''}`}
              style={{ flex: 1, flexDirection: 'column', alignItems: 'flex-start', padding: '.65rem .8rem', border: cardType === 'yellow' ? '2px solid #facc15' : undefined }}
              onClick={() => setCardType('yellow')}
            >
              <div style={{ fontWeight: 900, fontSize: '.95rem' }}>🟨 Kartu Kuning</div>
              <div className="small" style={{ opacity: 0.85, textAlign: 'left' }}>Peringatan Resmi (Skor Tetap)</div>
            </button>
            <button
              type="button"
              className={`btn ${cardType === 'red' ? 'btn-red' : ''}`}
              disabled={!canIssueRed}
              style={{ flex: 1, flexDirection: 'column', alignItems: 'flex-start', padding: '.65rem .8rem', border: cardType === 'red' ? '2px solid #f87171' : undefined }}
              onClick={() => setCardType('red')}
              title={!canIssueRed ? 'Kartu Merah hanya dapat diberikan saat permainan berstatus Live' : ''}
            >
              <div style={{ fontWeight: 900, fontSize: '.95rem' }}>🟥 Kartu Merah</div>
              <div className="small" style={{ opacity: 0.9, textAlign: 'left' }}>
                Fault (+1 Poin / Servis ke Tim {T(oppTeam)})
              </div>
            </button>
            <button
              type="button"
              className={`btn ${cardType === 'black' ? 'btn-grey' : ''}`}
              style={{ flex: 1, flexDirection: 'column', alignItems: 'flex-start', padding: '.65rem .8rem', border: cardType === 'black' ? '2px solid #fff' : undefined }}
              onClick={() => setCardType('black')}
            >
              <div style={{ fontWeight: 900, fontSize: '.95rem' }}>⬛ Kartu Hitam</div>
              <div className="small" style={{ opacity: 0.85, textAlign: 'left' }}>Diskualifikasi (Menangkan Tim {T(oppTeam)})</div>
            </button>
          </div>

          <div className="notice small" style={{ background: cardType === 'red' ? 'rgba(239, 68, 68, 0.14)' : cardType === 'black' ? 'rgba(15, 23, 42, 0.9)' : 'rgba(250, 204, 21, 0.12)', borderColor: cardType === 'red' ? '#ef4444' : cardType === 'black' ? '#94a3b8' : '#facc15' }}>
            <b>{selectedMeta.icon} {selectedMeta.label} ({selectedMeta.law}):</b>
            <br />
            {selectedMeta.consequence}
          </div>
        </div>

        {/* Pilih Alasan Pelanggaran */}
        <div className="col" style={{ gap: '.45rem' }}>
          <label className="field">
            3. Jenis Pelanggaran (BWF Clause 16)
            <select className="input" value={reasonPreset} onChange={(e) => setReasonPreset(e.target.value)}>
              {BWF_CARD_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Catatan Tambahan Wasit (Opsional)
            <input
              className="input"
              value={customNote}
              onChange={(e) => setCustomNote(e.target.value)}
              placeholder="Contoh: Menolak melanjutkan servis setelah dipanggil 2x oleh wasit"
            />
          </label>
        </div>

        {/* Riwayat Kartu di Pertandingan Ini */}
        {cards.length > 0 && (
          <div className="col" style={{ background: '#0a1328', padding: '.6rem .8rem', borderRadius: 8, gap: '.3rem' }}>
            <div className="small muted" style={{ fontWeight: 700 }}>Riwayat Kartu pada Pertandingan Ini ({cards.length}):</div>
            {cards.map((c) => (
              <div key={c.card_id} className="row small" style={{ justifyContent: 'space-between', borderBottom: '1px solid rgba(148,163,184,0.12)', paddingBottom: '.2rem' }}>
                <span>
                  {c.type === 'yellow' ? '🟨' : c.type === 'red' ? '🟥' : '⬛'} <b>{c.player_name}</b> (Tim {T(c.team)}) — {c.reason}
                </span>
                <span className="mono muted">Set {c.set} ({c.score_after?.a}-{c.score_after?.b})</span>
              </div>
            ))}
          </div>
        )}

        <div className="row">
          <button
            type="submit"
            className={`btn btn-lg ${cardType === 'red' ? 'btn-red' : cardType === 'black' ? 'btn-grey' : 'btn-yellow'}`}
            style={{ flex: 1 }}
            disabled={pending}
          >
            {pending
              ? 'Memproses…'
              : `${selectedMeta.icon} Berikan ${selectedMeta.label} ke ${playerName(match, playerId)}`}
          </button>
          <button type="button" className="btn btn-ghost btn-lg" onClick={onClose}>
            Batal
          </button>
        </div>
      </form>
    </div>
  );
}

function RetireModal({ match, onClose, send, pending }) {
  const st = match.live_state;
  const dbl = isDoubles(match);
  const [team, setTeam] = useState('a');
  const [playerId, setPlayerId] = useState('a1');
  const [mode, setMode] = useState(st.phase === 'setup' ? 'walkover' : 'retired');
  const [reasonPreset, setReasonPreset] = useState(BWF_RETIRE_REASONS[0]);
  const [customNote, setCustomNote] = useState('');
  const [err, setErr] = useState(null);

  const selectTeam = (t) => {
    setTeam(t);
    setPlayerId(`${t}1`);
  };

  const handleRetire = async (e) => {
    e.preventDefault();
    setErr(null);
    const fullReason = customNote.trim()
      ? `${reasonPreset} — ${customNote.trim()}`
      : reasonPreset;
    const oppTeam = other(team);
    const oppLabel = teamLabel(match, oppTeam);
    const injuredName = playerName(match, playerId);
    const tag = mode === 'walkover' ? 'WALKOVER (WO)' : 'RETIRED (CEDERA / MUNDUR)';

    if (!window.confirm(`KONFIRMASI ${tag}:\n\nPemain: ${injuredName} (Tim ${T(team)})\nAlasan: ${fullReason}\n\nPertandingan akan dihentikan dan dimenangkan oleh Tim ${T(oppTeam)} (${oppLabel}). Lanjutkan?`)) {
      return;
    }

    const r = await send('RETIRE', {
      team,
      player_id: playerId,
      mode,
      reason: fullReason,
    });
    if (r?.ok) onClose();
    else if (r?.error) setErr(r.error);
  };

  const oppTeam = other(team);

  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal col" style={{ width: 'min(580px, 100%)', gap: '.85rem' }} onClick={(e) => e.stopPropagation()} onSubmit={handleRetire}>
        <div className="row">
          <h2 style={{ margin: 0, color: '#f87171' }}>🚑 Pemain Cedera / Tidak Bisa Lanjut</h2>
          <div className="spacer" />
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <p className="small muted" style={{ margin: 0 }}>
          Catat penghentian pertandingan resmi karena cedera medis (Retired) atau ketidakhadiran (Walkover). Kemenangan otomatis diberikan kepada lawan.
        </p>

        {err && <div className="notice error">{err}</div>}

        {/* Pilih Jenis Penghentian */}
        <div className="col" style={{ gap: '.4rem' }}>
          <span className="small" style={{ fontWeight: 800 }}>1. Jenis Status Penghentian:</span>
          <div className="row" style={{ gap: '.5rem' }}>
            <button
              type="button"
              className={`btn ${mode === 'retired' ? 'btn-red' : ''}`}
              style={{ flex: 1 }}
              onClick={() => {
                setMode('retired');
                setReasonPreset(BWF_RETIRE_REASONS[0]);
              }}
            >
              🚑 Retired (Cedera / Sakit)
            </button>
            <button
              type="button"
              className={`btn ${mode === 'walkover' ? 'btn-red' : ''}`}
              style={{ flex: 1 }}
              onClick={() => {
                setMode('walkover');
                setReasonPreset(BWF_RETIRE_REASONS[3]);
              }}
            >
              🚪 Walkover / WO (Tidak Hadir)
            </button>
          </div>
        </div>

        {/* Pilih Tim & Pemain yang Mundur */}
        <div className="col" style={{ gap: '.4rem' }}>
          <span className="small" style={{ fontWeight: 800 }}>2. Tim / Pemain yang Tidak Dapat Melanjutkan:</span>
          <div className="row" style={{ gap: '.5rem' }}>
            {['a', 'b'].map((t) => (
              <button
                key={t}
                type="button"
                className={`btn ${team === t ? 'btn-primary' : ''}`}
                style={{ flex: 1, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '.1rem' }}
                onClick={() => selectTeam(t)}
              >
                <span className="badge" style={{ alignSelf: 'flex-start' }}>TIM {T(t)}</span>
                <b style={{ fontSize: '.9rem' }}>{teamLabel(match, t)}</b>
                <span className="small muted">{match.teams[`team_${t}`].club || '-'}</span>
              </button>
            ))}
          </div>

          {dbl && (
            <div className="row" style={{ gap: '.5rem', marginTop: '.3rem' }}>
              {[`${team}1`, `${team}2`].map((pid) => (
                <button
                  key={pid}
                  type="button"
                  className={`btn btn-sm ${playerId === pid ? 'btn-yellow' : ''}`}
                  style={{ flex: 1 }}
                  onClick={() => setPlayerId(pid)}
                >
                  👤 {playerName(match, pid)}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Pilih Alasan */}
        <div className="col" style={{ gap: '.4rem' }}>
          <span className="small" style={{ fontWeight: 800 }}>3. Alasan Resmi Penghentian:</span>
          <select className="input" value={reasonPreset} onChange={(e) => setReasonPreset(e.target.value)}>
            {BWF_RETIRE_REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <input
            className="input"
            placeholder="Catatan medis tambahan (opsional: contoh 'Kram betis kanan game 2')"
            value={customNote}
            onChange={(e) => setCustomNote(e.target.value)}
          />
        </div>

        <div className="notice warn small" style={{ margin: 0 }}>
          🏆 <b>Konsekuensi:</b> Pertandingan dinyatakan selesai dengan status <b>{mode === 'walkover' ? 'WO' : 'RET'}</b>. Kemenangan otomatis diberikan kepada <b>Tim {T(oppTeam)} ({teamLabel(match, oppTeam)})</b>.
        </div>

        <div className="row">
          <button
            type="submit"
            className="btn btn-red btn-lg"
            style={{ flex: 1 }}
            disabled={pending}
          >
            {pending ? 'Memproses…' : `🚑 Konfirmasi Penghentian (Menangkan Tim ${T(oppTeam)})`}
          </button>
          <button type="button" className="btn btn-ghost btn-lg" onClick={onClose}>
            Batal
          </button>
        </div>
      </form>
    </div>
  );
}

function OverrideModal({ match, onClose, send, pending }) {
  const st = match.live_state;
  const dbl = isDoubles(match);
  const scoringEditable = ['live', 'interval'].includes(st.phase);
  const [tab, setTab] = useState(scoringEditable ? 'score' : 'court');
  const [names, setNames] = useState({
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
  });
  const [score, setScore] = useState({ ...st.score });
  const [left, setLeft] = useState(st.sides?.left || 'a');
  const [side, setSide] = useState(st.service_status.side || 'a');
  const [turn, setTurn] = useState(st.service_status.turn || 1);
  const [server, setServer] = useState(st.service_status.player_id || 'a1');
  const [pos, setPos] = useState(st.positions);
  const [court, setCourt] = useState(String(match.court_number));
  const [cockCount, setCockCount] = useState(Number(st.shuttlecock_count ?? 0));
  const [err, setErr] = useState(null);

  const submit = async (payload) => {
    setErr(null);
    const r = await send('OVERRIDE', payload);
    if (r?.ok) onClose();
    else if (r?.error) setErr(r.error);
  };
  const setName = (t, k, v) => setNames((x) => ({ ...x, [t]: { ...x[t], [k]: v } }));
  const bump = (t, d) => setScore((s) => ({ ...s, [t]: Math.max(0, (parseInt(s[t], 10) || 0) + d) }));
  const leftTeam = left;
  const rightTeam = other(leftTeam);

  const previewMatch = {
    ...match,
    live_state: {
      ...st,
      score: { a: parseInt(score.a, 10) || 0, b: parseInt(score.b, 10) || 0 },
      sides: { left: leftTeam, right: rightTeam },
      positions: pos,
      service_status: { side, turn, player_id: server, receiver_id: null },
    },
  };
  const previewPositions = courtPositions(previewMatch);

  const pickServer = (pid) => {
    if (!pid) return;
    setSide(pid[0]);
    setServer(pid);
  };

  const swapTeamVertical = (t) => {
    setPos((p) => ({ ...p, [t]: { even: p[t].odd, odd: p[t].even } }));
  };

  const renderSidePositionCol = (screenSide) => {
    const t = screenSide === 'left' ? leftTeam : rightTeam;
    const topSlot = screenSide === 'left' ? 'left_top' : 'right_top';
    const bottomSlot = screenSide === 'left' ? 'left_bottom' : 'right_bottom';
    const topPid = previewPositions[topSlot];
    const bottomPid = previewPositions[bottomSlot];
    const topBoxLabel = screenSide === 'left' ? 'Atas (Kiri/Ganjil)' : 'Atas (Kanan/Genap)';
    const bottomBoxLabel = screenSide === 'left' ? 'Bawah (Kanan/Genap)' : 'Bawah (Kiri/Ganjil)';

    return (
      <div className={`setup-side-col ${screenSide}`}>
        <div className="setup-side-hdr">
          {screenSide === 'left' ? '◀ SISI KIRI' : 'SISI KANAN ▶'} · TIM {T(t)}
        </div>

        {/* Score Stepper for this side's team */}
        <div className="ov-score-stepper" style={{ padding: '.35rem .5rem' }}>
          <button type="button" className="btn btn-sm" onClick={() => bump(t, -1)}>−</button>
          <input
            className="input ov-score-input mono"
            style={{ width: 64, fontSize: '1.35rem', padding: '.2rem' }}
            type="number"
            min={0}
            value={score[t]}
            onChange={(e) => setScore((s) => ({ ...s, [t]: e.target.value }))}
          />
          <button type="button" className="btn btn-sm btn-green" onClick={() => bump(t, 1)}>+</button>
        </div>

        {/* Top Player Slot */}
        <div className={`setup-slot-card ${server === topPid ? 'is-srv' : ''}`}>
          <div className="setup-slot-tag">⬆ {topBoxLabel}</div>
          <div className="setup-slot-name">{playerName(match, topPid) || '—'}</div>
          {topPid && (
            <div className="setup-slot-actions">
              <button
                type="button"
                className={`icon-btn shuttle ${server === topPid ? 'on' : ''}`}
                onClick={() => pickServer(topPid)}
              >
                <Shuttle size={14} /> Servis
              </button>
            </div>
          )}
        </div>

        {/* Swap Top <-> Bottom for this side */}
        {dbl && (
          <button
            type="button"
            className="btn btn-sm setup-swap-vertical-btn"
            onClick={() => swapTeamVertical(t)}
            title={`Tukar posisi Atas ⇅ Bawah untuk pasangan Tim ${T(t)}`}
          >
            ⇅ Tukar Atas ↕ Bawah ({screenSide === 'left' ? 'Kiri' : 'Kanan'})
          </button>
        )}

        {/* Bottom Player Slot */}
        <div className={`setup-slot-card ${server === bottomPid ? 'is-srv' : ''}`}>
          <div className="setup-slot-tag">⬇ {bottomBoxLabel}</div>
          <div className="setup-slot-name">{playerName(match, bottomPid) || '—'}</div>
          {bottomPid && (
            <div className="setup-slot-actions">
              <button
                type="button"
                className={`icon-btn shuttle ${server === bottomPid ? 'on' : ''}`}
                onClick={() => pickServer(bottomPid)}
              >
                <Shuttle size={14} /> Servis
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal col" style={{ width: 'min(1080px, 98vw)' }} onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2 style={{ margin: 0, color: '#f87171' }}>⚠ Koreksi Cepat Wasit (Override)</h2>
          <div className="spacer" />
          <button className="btn btn-sm btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="tabs">
          <button className={`btn btn-sm ${tab === 'score' ? 'active' : ''}`} disabled={!scoringEditable} onClick={() => setTab('score')}>
            🎯 Skor, Posisi &amp; Servis
          </button>
          <button className={`btn btn-sm ${tab === 'court' ? 'active' : ''}`} onClick={() => setTab('court')}>
            🏸 Cock &amp; Lapangan
          </button>
          <button className={`btn btn-sm ${tab === 'names' ? 'active' : ''}`} onClick={() => setTab('names')}>
            👥 Nama &amp; Club
          </button>
        </div>
        {err && <div className="notice error">{err}</div>}

        {tab === 'score' && (
          <div className="col" style={{ gap: '.75rem' }}>
            {/* TOP BAR: Left Team | Center Swap Sides Button | Right Team */}
            <div className="setup-top-sides-bar">
              <div className="setup-side-team left">
                <span className="setup-side-badge left">◀ LAPANGAN KIRI · TIM {T(leftTeam)}</span>
                <span className="tname">{teamLabel(match, leftTeam)}</span>
                <span className="tclub">{match.teams[`team_${leftTeam}`].club || '-'}</span>
              </div>

              <button
                type="button"
                className="btn btn-blue setup-swap-sides-btn"
                onClick={() => setLeft(other(leftTeam))}
                title="Tukar sisi lapangan pasangan Kiri dan Kanan"
              >
                ⇄ Tukar Sisi Lapangan (Kiri ↔ Kanan)
              </button>

              <div className="setup-side-team right">
                <span className="setup-side-badge right">LAPANGAN KANAN · TIM {T(rightTeam)} ▶</span>
                <span className="tname">{teamLabel(match, rightTeam)}</span>
                <span className="tclub">{match.teams[`team_${rightTeam}`].club || '-'}</span>
              </div>
            </div>

            {/* MIDDLE STAGE: Left Vertical Controls | Center CourtMap with inline Servis buttons | Right Vertical Controls */}
            <div className="setup-court-stage">
              {renderSidePositionCol('left')}

              <div className="setup-court-center">
                <CourtMap
                  match={previewMatch}
                  positions={previewPositions}
                  serverId={server}
                  serveTurn={turn}
                  spinKey={leftTeam}
                  renderActions={(pid) => (
                    <button
                      type="button"
                      className={`icon-btn shuttle ${server === pid ? 'on' : ''}`}
                      onClick={() => pickServer(pid)}
                      title="Jadikan pemegang servis saat ini"
                    >
                      <Shuttle size={16} /> Servis
                    </button>
                  )}
                />
              </div>

              {renderSidePositionCol('right')}
            </div>

            {dbl && match.rules.scoring_method === 'side_out' && (
              <div className="row" style={{ gap: '.5rem', alignItems: 'center', justifyContent: 'center' }}>
                <span className="small muted" style={{ fontWeight: 800 }}>Giliran Servis (Side-Out):</span>
                {[1, 2].map((n) => (
                  <button key={n} type="button" className={`btn btn-sm ${turn === n ? 'btn-blue' : ''}`} onClick={() => setTurn(n)}>
                    {n === 1 ? '● Servis ke-1 (1st)' : '● ● Servis ke-2 (2nd)'}
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              className="btn btn-red btn-lg btn-block"
              disabled={pending}
              onClick={() =>
                submit({
                  sides: { left: leftTeam },
                  score,
                  service: { side, player_id: server, turn },
                  positions: dbl ? pos : undefined,
                })
              }
            >
              ✔ Terapkan Koreksi Sisi, Skor, Posisi &amp; Servis
            </button>
          </div>
        )}

        {tab === 'court' && (
          <div className="col" style={{ gap: '.85rem' }}>
            <div className="ov-section">
              <div className="small muted" style={{ fontWeight: 800, marginBottom: '.4rem' }}>
                🏸 JUMLAH PENGGUNAAN SHUTTLECOCK (COCK):
              </div>
              <div className="row" style={{ gap: '.75rem', alignItems: 'center' }}>
                <button type="button" className="btn btn-lg" onClick={() => setCockCount((c) => Math.max(0, c - 1))}>−</button>
                <input
                  className="input mono"
                  style={{ width: 110, textAlign: 'center', fontSize: '1.6rem', fontWeight: 900 }}
                  type="number"
                  min={0}
                  max={999}
                  value={cockCount}
                  onChange={(e) => setCockCount(Math.max(0, parseInt(e.target.value, 10) || 0))}
                />
                <button type="button" className="btn btn-lg btn-yellow" onClick={() => setCockCount((c) => Math.min(999, c + 1))}>+</button>
              </div>
            </div>
            <label className="field">
              Nomor Lapangan (TV lapangan baru akan otomatis menampilkan match ini)
              <input className="input" type="number" min={1} value={court} onChange={(e) => setCourt(e.target.value)} />
            </label>
            <button type="button" className="btn btn-red btn-lg" disabled={pending} onClick={() => submit({ court_number: court, shuttlecock_count: cockCount })}>
              ✔ Simpan Lapangan &amp; Jumlah Cock
            </button>
          </div>
        )}

        {tab === 'names' && (
          <div className="col">
            {['team_a', 'team_b'].map((t) => (
              <div key={t} className="team-card col">
                <div className="muted small">TIM {t.slice(-1).toUpperCase()}</div>
                <input className="input" value={names[t].p1} onChange={(e) => setName(t, 'p1', e.target.value)} placeholder="Pemain 1" />
                {dbl && <input className="input" value={names[t].p2} onChange={(e) => setName(t, 'p2', e.target.value)} placeholder="Pemain 2" />}
                <input className="input" value={names[t].club} placeholder="Club / PB" onChange={(e) => setName(t, 'club', e.target.value)} />
                <input className="input" value={names[t].details} placeholder="Seeded / Detail (contoh: 1 atau [3/4])" onChange={(e) => setName(t, 'details', e.target.value)} />
              </div>
            ))}
            <button
              type="button"
              className="btn btn-red btn-lg"
              disabled={pending}
              onClick={() => {
                const n = {};
                for (const t of ['team_a', 'team_b']) {
                  n[t] = dbl
                    ? names[t]
                    : { p1: names[t].p1, club: names[t].club, details: names[t].details };
                }
                submit({ names: n });
              }}
            >
              ✔ Simpan Nama, Club &amp; Seeded
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

export default function LiveScreen({ match, now, readOnly, pending, connected, send, spectator, layout = 'landscape-sides' }) {
  const [showOverride, setShowOverride] = useState(false);
  const [showCardModal, setShowCardModal] = useState(false);
  const [showRetireModal, setShowRetireModal] = useState(false);
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
  const isSplitBelow = layout === 'portrait-split';
  const isStack = layout === 'portrait-stack';
  const cards = Array.isArray(st.cards) ? st.cards : [];

  const renderTeamCards = (t) => {
    const tCards = cards.filter((c) => c.team === t);
    if (!tCards.length) return null;
    return (
      <span className="ref-team-cards" title={tCards.map((c) => `${c.type.toUpperCase()} (${c.player_name}): ${c.reason}`).join(' | ')}>
        {tCards.map((c) => (
          <span key={c.card_id} className={`ref-card-pip ${c.type}`}>
            {c.type === 'yellow' ? '🟨' : c.type === 'red' ? '🟥' : '⬛'}
          </span>
        ))}
      </span>
    );
  };

  const teamHeader = (t, align, sideTag) => {
    const seed = teamSeedBadge(match, t);
    return (
      <div className={`team ${align}`}>
        <span className="tname">
          {teamLabel(match, t)}
          {seed && <span className="seed-pill">{seed}</span>}
          {renderTeamCards(t)}
        </span>
        <span className="tclub">
          {sideTag ? `${sideTag} · ` : ''}Tim {T(t)} · {match.teams[`team_${t}`].club || '-'}
        </span>
        <span className={`num ${ss.side === t ? 'serving' : ''}`}>{st.score[t]}</span>
      </div>
    );
  };

  let overlay = null;
  let breakBanner = null;
  const breakTimer = breakCountdownInfo(match, now);

  // Preview post-swap sides on CourtMap during interval_swap so referee immediately sees where Server & Receiver stand
  const effectiveSides =
    st.phase === 'interval' && st.interval_swap
      ? { left: st.sides.right, right: st.sides.left }
      : st.sides;
  const effectiveCourtPositions =
    st.phase === 'interval' && st.interval_swap
      ? courtPositions(match, { ...st, sides: effectiveSides })
      : st.court_positions;

  const renderServeReceiveSummary = () => {
    if (!ss.side || !ss.player_id) return null;
    const srvTeam = ss.side;
    const rcvTeam = other(srvTeam);
    return (
      <div className="ref-break-srv-cards">
        <div className={`ref-break-srv-item server ${sideOutDbl && ss.turn === 2 ? 'serve-2' : 'serve-1'}`}>
          <span className="ref-break-srv-role">
            <Shuttle size={14} /> {sideOutDbl ? (ss.turn === 2 ? 'SERVIS KE-2 (2ND)' : 'SERVIS KE-1 (1ST)') : 'PEMAIN SERVIS'}
          </span>
          <span className="ref-break-srv-name">{ss.player_name || playerName(match, ss.player_id)}</span>
          <span className="ref-break-srv-team">Tim {T(srvTeam)} · {teamLabel(match, srvTeam)}</span>
        </div>
        <div className="ref-break-srv-arrow">➔</div>
        <div className="ref-break-srv-item receiver">
          <span className="ref-break-srv-role">🎯 PENERIMA SERVIS</span>
          <span className="ref-break-srv-name">{ss.receiver_name || playerName(match, ss.receiver_id) || '-'}</span>
          <span className="ref-break-srv-team">Tim {T(rcvTeam)} · {teamLabel(match, rcvTeam)}</span>
        </div>
      </div>
    );
  };

  const renderBreakTimer = (bt) => {
    if (!bt) return null;
    const pct = Math.min(100, Math.round((bt.remainingSec / bt.targetSec) * 100));
    const stateCls = bt.isOvertime ? 'overtime' : bt.callWarning ? 'warning' : 'normal';
    return (
      <div className={`bwf-countdown-box ${stateCls}`}>
        <div className="bwf-countdown-rule">{bt.ruleLabel}</div>
        <div className="bwf-countdown-digits mono">
          {bt.isOvertime ? `00:00 (${bt.overtimeFormatted})` : bt.formatted}
        </div>
        <div className="bwf-countdown-bar">
          <div className="bwf-countdown-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="bwf-countdown-hint">
          {bt.isOvertime
            ? '⏰ WAKTU ISTIRAHAT HABIS! Panggil pemain: "Play / Mulai!"'
            : bt.callWarning
            ? `📢 PANGGIL PEMAIN KE LAPANGAN ("Lapangan ${match.court_number}, 20 Detik!")`
            : `Istirahat berjalan · Sisa ${bt.remainingSec} detik dari ${bt.targetSec} detik`}
        </div>
      </div>
    );
  };

  if (finished) {
    overlay = (
      <div className="phase-overlay">
        <h2>HASIL AKHIR</h2>
        <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>🏆 {teamLabel(match, st.winner)}</div>
        <div className="muted">
          {st.set_history.map((s) => `${s.a}-${s.b}`).join('  ·  ')}
          {duration ? `  ·  ⏱ ${duration}` : ''}
          {`  ·  🏸 ${st.shuttlecock_count ?? 0} Cock`}
        </div>
        {match.export_status && <span className="badge cyan">Ekspor: {match.export_status.message}</span>}
      </div>
    );
  } else if (st.phase === 'interval') {
    breakBanner = (
      <div className="ref-break-panel">
        <div className="ref-break-top">
          <div>
            <h3 className="ref-break-title">
              {st.interval_swap ? '⇄ INTERVAL · TUKAR SISI LAPANGAN' : '⏸ INTERVAL ISTIRAHAT'}
            </h3>
            <div className="small muted">
              Skor {st.score[L]} - {st.score[R]} ·{' '}
              {st.interval_swap
                ? `Posisi lapangan di bawah telah menampilkan sisi baru setelah tukar tempat (Kiri: Tim ${T(effectiveSides.left)}, Kanan: Tim ${T(effectiveSides.right)}).`
                : 'Posisi servis & penerima tetap terlihat pada gambar lapangan di bawah.'}
            </div>
          </div>
          {!readOnly && (
            <div className="row" style={{ gap: '.5rem' }}>
              <button className="btn btn-yellow" disabled={!canAct} onClick={() => send('UNDO')}>
                ↶ UNDO
              </button>
              <button className="btn btn-blue btn-lg" disabled={!canAct} onClick={() => send('CONFIRM_INTERVAL')}>
                {st.interval_swap ? '⇄ Konfirmasi Tukar Posisi & Lanjut' : '▶ Selesai Interval & Lanjutkan'}
              </button>
            </div>
          )}
        </div>
        {renderServeReceiveSummary()}
        {renderBreakTimer(breakTimer)}
      </div>
    );
  } else if (st.phase === 'set_break') {
    const last = st.set_history[st.set_history.length - 1];
    breakBanner = (
      <div className="ref-break-panel">
        <div className="ref-break-top">
          <div>
            <h3 className="ref-break-title">🏁 SET {st.current_set} SELESAI · JEDA ANTAR SET (GANTI TEMPAT)</h3>
            <div className="small" style={{ fontWeight: 800, color: '#f8fafc' }}>
              Pemenang Set {st.current_set}: <span style={{ color: 'var(--gold)' }}>{teamLabel(match, st.game_winner)}</span> ({last?.a}-{last?.b}) · Kedudukan Set {st.sets.a}-{st.sets.b}
            </div>
            <div className="small muted">
              Pemain bertukar sisi lapangan. Tim <b>{teamLabel(match, st.game_winner)}</b> akan melakukan servis pertama di Set {st.current_set + 1}.
            </div>
          </div>
          {!readOnly && (
            <div className="row" style={{ gap: '.5rem' }}>
              <button className="btn btn-yellow" disabled={!canAct} onClick={() => send('UNDO')}>
                ↶ UNDO
              </button>
              <button className="btn btn-green btn-lg" disabled={!canAct} onClick={() => send('NEXT_SET')}>
                ▶ Mulai Set {st.current_set + 1} (Ganti Tempat)
              </button>
            </div>
          )}
        </div>
        {renderServeReceiveSummary()}
        {renderBreakTimer(breakTimer)}
      </div>
    );
  } else if (st.phase === 'finished') {
    const winSide = st.winner || 'a';
    const loseSide = winSide === 'a' ? 'b' : 'a';
    const methodLabel = match.rules?.scoring_method === 'side_out' ? 'Side-Out' : 'Rally Point';
    const typeLabel = isSets ? 'Sets (Best of 3)' : 'Continuous';
    const ralliesCount = Array.isArray(st.rally_history) ? st.rally_history.length : 0;

    overlay = (
      <div className="phase-overlay ref-finish-overlay">
        <div className="ref-finish-card">
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '.4rem' }}>
            <span className="badge gold" style={{ fontSize: '.78rem', padding: '.22rem .65rem' }}>
              🏁 RINGKASAN AKHIR PERTANDINGAN
            </span>
            <span className="badge blue mono">
              {match.match_number} · {typeLabel} · {methodLabel}
            </span>
          </div>

          <div className="ref-finish-duel">
            <div className="ref-finish-winner">
              <div className="small" style={{ fontWeight: 900, color: '#fde047' }}>
                🏆 PEMENANG (TIM {T(winSide)})
                {st.retirement && <span className="badge red" style={{ marginLeft: '.35rem', fontSize: '.68rem' }}>MENANG {st.retirement.tag}</span>}
              </div>
              <div className="ref-finish-name">{teamLabel(match, winSide)}</div>
              <div className="small muted">{match.teams[`team_${winSide}`].club || '-'}</div>
            </div>
            <div className="ref-finish-vs">VS</div>
            <div className="ref-finish-runner">
              <div className="small muted" style={{ fontWeight: 800 }}>
                RUNNER-UP (TIM {T(loseSide)})
                {st.retirement && <span className="badge red" style={{ marginLeft: '.35rem', fontSize: '.68rem' }}>{st.retirement.tag} ({st.retirement.type.toUpperCase()})</span>}
              </div>
              <div className="ref-finish-name-sub">{teamLabel(match, loseSide)}</div>
              <div className="small muted">{match.teams[`team_${loseSide}`].club || '-'}</div>
            </div>
          </div>

          {st.retirement && (
            <div className="notice warn" style={{ margin: '.2rem 0', padding: '.5rem .75rem' }}>
              <div className="small" style={{ fontWeight: 800, color: '#fecaca' }}>
                🚑 {st.retirement.type === 'walkover' ? 'WALKOVER (WO)' : 'PENGUNDURAN DIRI / CEDERA (RETIRED)'}
              </div>
              <div className="small" style={{ marginTop: '.15rem', color: '#f8fafc' }}>
                <b>{st.retirement.player_name}</b> (Tim {T(st.retirement.team)}) tidak dapat melanjutkan pertandingan: &ldquo;{st.retirement.reason}&rdquo;. Skor saat berhenti: {st.retirement.score_at_stop.a}-{st.retirement.score_at_stop.b} (Set {st.retirement.set}).
              </div>
            </div>
          )}

          <div className="ref-finish-sets">
            {(st.set_history || []).map((s) => (
              <div key={s.set} className="ref-finish-set-pill">
                <span>{isSets ? `Set ${s.set}` : 'Skor Akhir'}</span>
                <b className="mono">{s.a} - {s.b}</b>
              </div>
            ))}
          </div>

          {/* Highlighted Shuttlecock Verification + Cards Check */}
          <div className="ref-finish-highlights">
            <div className="ref-finish-hl-box cock">
              <div className="small" style={{ fontWeight: 900, color: 'var(--gold)' }}>
                🏸 PASTIKAN JUMLAH COCK SUDAH BENAR:
              </div>
              <div className="row" style={{ justifyContent: 'center', gap: '.6rem', marginTop: '.25rem' }}>
                {!readOnly && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={!canAct || (st.shuttlecock_count ?? 0) <= 0}
                    onClick={() => send('SHUTTLECOCK', { delta: -1 })}
                  >
                    −1
                  </button>
                )}
                <span className="mono" style={{ fontSize: '1.35rem', fontWeight: 900, color: '#fff' }}>
                  {st.shuttlecock_count ?? 0} Cock
                </span>
                {!readOnly && (
                  <button
                    type="button"
                    className="btn btn-sm btn-yellow"
                    disabled={!canAct}
                    onClick={() => send('SHUTTLECOCK', { delta: 1 })}
                  >
                    +1
                  </button>
                )}
              </div>
            </div>

            <div className={`ref-finish-hl-box ${cards.length > 0 ? 'has-cards' : 'clean'}`}>
              <div className="small" style={{ fontWeight: 900, color: cards.length > 0 ? '#fca5a5' : '#4ade80' }}>
                🟨🟥 KARTU PELANGGARAN BWF:
              </div>
              {cards.length > 0 ? (
                <div className="ref-finish-cards-list">
                  {cards.map((c) => (
                    <div key={c.card_id} className="small">
                      {c.type === 'yellow' ? '🟨' : c.type === 'red' ? '🟥' : '⬛'} <b>{c.player_name}</b> ({c.reason})
                    </div>
                  ))}
                </div>
              ) : (
                <div className="small" style={{ marginTop: '.2rem', fontWeight: 700 }}>✔ 0 Kartu — Fair Play</div>
              )}
            </div>
          </div>

          <div className="row small muted" style={{ justifyContent: 'center', gap: '.85rem' }}>
            <span>👤 Wasit: <b style={{ color: '#e2e8f0' }}>{match.session_management?.controller_label || '-'}</b></span>
            <span>⏱ Durasi: <b className="mono" style={{ color: 'var(--cyan)' }}>{duration || '-'}</b></span>
            <span>📈 Total Reli: <b className="mono">{ralliesCount}</b></span>
          </div>

          {!readOnly && (
            <div className="row" style={{ justifyContent: 'center', gap: '.65rem', marginTop: '.2rem' }}>
              <button className="btn btn-yellow btn-lg" disabled={!canAct} onClick={() => send('UNDO')}>
                ↶ UNDO Poin Terakhir
              </button>
              <button className="btn btn-green btn-lg" disabled={!canAct} onClick={() => send('CONFIRM_FINISH')}>
                ✅ Konfirmasi &amp; Simpan Hasil Akhir
              </button>
            </div>
          )}
        </div>
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
    const club = match.teams[`team_${t}`].club;
    const seed = teamSeedBadge(match, t);
    const isServeHere = ss.side === t && st.phase !== 'setup';
    const sideLabel = screen === 'left' ? 'LAPANGAN KIRI' : 'LAPANGAN KANAN';
    const arrow = screen === 'left' ? '◀' : '▶';

    return (
      <button
        className={`rally-btn ${screen} ${isStack ? 'stack-btn' : isSplitBelow ? 'split-btn' : 'landscape-btn'} ${isServeHere ? 'is-serving' : ''}`}
        disabled={!canScore}
        onClick={() => send('WIN_RALLY', { side: screen })}
      >
        <div className="rally-btn-top">
          <span className="rally-side-pill">
            {arrow} {sideLabel} · MENANG RELI
          </span>
          {seed && <span className="seed-pill">{seed}</span>}
          {renderTeamCards(t)}
          {isServeHere && (
            <span className={`rally-serve-tag ${sideOutDbl && ss.turn === 2 ? 'serve-2' : 'serve-1'}`}>
              <Shuttle size={14} />
              {sideOutDbl ? (ss.turn === 2 ? ' 2nd Serve' : ' 1st Serve') : ' Servis'}
            </span>
          )}
        </div>
        <div className="rally-btn-main">
          <div className="rally-team-info">
            <div className="rally-players">{teamLabel(match, t)}</div>
            {(club || seed) && (
              <div className="rally-club">
                {club || '-'}
                {seed ? ` · ${seed}` : ''}
              </div>
            )}
          </div>
          <div className={`rally-score ${isServeHere ? 'serving' : ''}`}>{st.score[t]}</div>
        </div>
      </button>
    );
  };

  return (
    <>
      <div className={`ref-live ${layout}`}>
        {!isSplitBelow && rallyBtn('left')}
        <div className="ref-center">
          <div className={`scoreline ${isStack ? 'portrait-bar' : ''}`}>
            {!isStack && teamHeader(L, '', 'KIRI')}
            <div className="mid">
              <div className="mid-top-row">
                <span>{isSets ? `SET ${st.current_set}` : 'GAME'}</span>
                {isSets && (
                  <span className="mid-sets">
                    ({st.sets[L]} - {st.sets[R]})
                  </span>
                )}
                <span>· {match.rules.scoring_method === 'side_out' ? 'SIDE-OUT' : 'RALLY'} {match.rules.win_point}</span>
                {duration && <span className="mid-dur mono">⏱ {duration}</span>}
              </div>
              {ss.side && st.phase !== 'setup' && (
                <div className={`ref-serve-banner ${sideOutDbl && ss.turn === 2 ? 'serve-2' : 'serve-1'}`}>
                  <span className="ref-srv-part">
                    <Shuttle size={16} />
                    {sideOutDbl && ss.turn === 2 ? <Shuttle size={16} /> : null}
                    <span>
                      Servis: <b>{ss.player_name}</b>
                      {sideOutDbl ? ` (${ss.turn === 2 ? '2nd Serve' : '1st Serve'})` : ''}
                    </span>
                  </span>
                  {ss.receiver_name && (
                    <>
                      <span className="ref-srv-arrow">➔</span>
                      <span className="ref-rcv-part">
                        🎯 Penerima: <b>{ss.receiver_name}</b>
                      </span>
                    </>
                  )}
                </div>
              )}

              {/* Kontrol Elegan Penggunaan Shuttlecock (Cock) oleh Wasit */}
              {st.phase !== 'setup' && (
                <div className="ref-shuttle-counter" title="Jumlah penggunaan shuttlecock selama pertandingan berlangsung">
                  <span className="ref-shuttle-label">
                    <Shuttle size={15} /> SHUTTLECOCK
                  </span>
                  {!readOnly && (
                    <button
                      type="button"
                      className="ref-shuttle-btn minus"
                      disabled={!canAct || (st.shuttlecock_count ?? 0) <= 0}
                      onClick={() => send('SHUTTLECOCK', { delta: -1 })}
                      title="Kurangi 1 shuttlecock"
                    >
                      −
                    </button>
                  )}
                  <span className="ref-shuttle-val mono">
                    {st.shuttlecock_count ?? 0} <small>Cock</small>
                  </span>
                  {!readOnly && (
                    <button
                      type="button"
                      className="ref-shuttle-btn plus"
                      disabled={!canAct}
                      onClick={() => send('SHUTTLECOCK', { delta: 1 })}
                      title="Tambah 1 penggunaan shuttlecock (Ganti Cock Baru)"
                    >
                      + Ganti Cock
                    </button>
                  )}
                </div>
              )}
            </div>
            {!isStack && teamHeader(R, 'right', 'KANAN')}
          </div>
          {breakBanner}
          <CourtMap
            match={match}
            positions={effectiveCourtPositions}
            serverId={st.phase === 'setup' ? null : ss.player_id}
            receiverId={st.phase === 'setup' ? null : ss.receiver_id}
            serveTurn={ss.turn}
            spinKey={effectiveSides.left}
            overlay={overlay}
          />
          {/* Mode Portrait Kiri-Kanan: Tombol Pemenang Reli Kiri & Kanan berdampingan persis di bawah belahan lapangan masing-masing */}
          {isSplitBelow && (
            <div className="rally-split-row">
              {rallyBtn('left')}
              {rallyBtn('right')}
            </div>
          )}
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
        {!isSplitBelow && rallyBtn('right')}
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
              ⇄ TUKAR SISI (KIRI ↔ KANAN)
            </button>
            <button
              className="btn"
              style={{
                background: 'linear-gradient(135deg, rgba(250, 204, 21, 0.22), rgba(239, 68, 68, 0.25))',
                borderColor: 'rgba(250, 204, 21, 0.65)',
                color: '#fef08a',
                fontWeight: 800,
              }}
              disabled={!canAct}
              onClick={() => setShowCardModal(true)}
              title="Berikan Kartu Kuning (Warning), Kartu Merah (Fault / Poin Lawan), atau Kartu Hitam (Diskualifikasi) sesuai BWF Law 16"
            >
              🟨🟥 KARTU PELANGGARAN {cards.length > 0 ? `(${cards.length})` : ''}
            </button>
            <button
              className="btn"
              style={{
                background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.28), rgba(185, 28, 28, 0.38))',
                borderColor: 'rgba(239, 68, 68, 0.7)',
                color: '#fca5a5',
                fontWeight: 800,
              }}
              disabled={!canAct || st.phase === 'finished'}
              onClick={() => setShowRetireModal(true)}
              title="Catat pemain yang cedera atau tidak dapat melanjutkan pertandingan (Retired / Walkover)"
            >
              🚑 CEDERA / RETIRED
            </button>
            <button className="btn btn-red" disabled={!canAct} onClick={() => setShowOverride(true)}>
              ⚠ OVERRIDE
            </button>
          </>
        )}
        {spectator}
      </div>
      {showCardModal && <PenaltyCardModal match={match} onClose={() => setShowCardModal(false)} send={send} pending={pending} />}
      {showRetireModal && <RetireModal match={match} onClose={() => setShowRetireModal(false)} send={send} pending={pending} />}
      {showOverride && <OverrideModal match={match} onClose={() => setShowOverride(false)} send={send} pending={pending} />}
    </>
  );
}
