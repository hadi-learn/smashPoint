'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, emitAck, getSocket, useNow } from '@/lib/client';
import { DISCIPLINES, DISCIPLINE_LABEL, DOUBLES, matchDurationText, teamLabel } from '@/lib/engine';
import { StatusBadge } from '@/components/referee/Entry';

const ACTIVE = ['locked', 'in_progress'];
const tm = (s) => (s ? new Date(s).toLocaleTimeString('id-ID', { hour12: false }) : '-');

function heartbeatAge(m, now) {
  if (!m.session_management.last_heartbeat) return null;
  return Math.max(0, Math.round((now - new Date(m.session_management.last_heartbeat).getTime()) / 1000));
}

function PinGate({ onOk }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    const r = await api('/api/admin/verify', { method: 'POST', pin });
    if (r.ok) {
      sessionStorage.setItem('sp_admin_pin', pin);
      onOk(pin);
    } else setErr(r.error || 'PIN salah');
  };
  return (
    <main className="container" style={{ maxWidth: 420, paddingTop: '10vh' }}>
      <form className="card col" onSubmit={submit}>
        <h2>🖥️ Server Admin</h2>
        <p className="muted small">Masukkan PIN Admin (ADMIN_PIN di .env, default sama dengan Master PIN).</p>
        {err && <div className="notice error">{err}</div>}
        <input className="input pin-input" type="password" inputMode="numeric" autoFocus value={pin} onChange={(e) => setPin(e.target.value)} />
        <button className="btn btn-primary btn-lg" disabled={!pin}>
          Masuk
        </button>
      </form>
    </main>
  );
}

function ImportPanel({ pin, sync, onSyncChange, onDone }) {
  const [tab, setTab] = useState('url');
  const [csv, setCsv] = useState('');
  const [url, setUrl] = useState('');
  const [intervalSec, setIntervalSec] = useState(0);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (sync?.url && !url) setUrl(sync.url);
    if (sync?.interval_sec !== undefined) setIntervalSec(sync.interval_sec);
  }, [sync?.url, sync?.interval_sec]);

  const run = async (dry) => {
    setBusy(true);
    setResult(null);
    const body = tab === 'url' ? { url } : { csv };
    const r = await api('/api/import', { method: 'POST', pin, body: { ...body, dry_run: dry } });
    setBusy(false);
    setResult(r);
    if (r.sync) onSyncChange?.(r.sync);
    if (!dry && r.ok) onDone?.();
  };

  const changeAutoSync = async (newInterval) => {
    setIntervalSec(newInterval);
    const r = await api('/api/admin/sync', {
      method: 'POST',
      pin,
      body: { url: url.trim(), interval_sec: newInterval, run_now: newInterval > 0 },
    });
    if (r.sync) onSyncChange?.(r.sync);
    if (r.result) setResult(r.result);
  };

  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    const rd = new FileReader();
    rd.onload = () => setCsv(String(rd.result || ''));
    rd.readAsText(f);
  };
  const hasInput = tab === 'url' ? url.trim() : csv.trim();
  const isPubLink = /\/d\/e\/|\/pub\b/.test(url);

  return (
    <div className="card col">
      <div className="row">
        <h3 style={{ margin: 0 }}>📥 Import & Live Sync Jadwal</h3>
        <div className="spacer" />
        <a className="btn btn-sm" href="/api/template.csv">
          ⬇ Template CSV
        </a>
      </div>
      <div className="tabs">
        {[
          ['url', '⚡ Live URL Google Sheets'],
          ['paste', 'Tempel dari Sheets/Excel'],
          ['file', 'File CSV'],
        ].map(([k, l]) => (
          <button key={k} className={`btn btn-sm ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'file' && (
        <label className="field">
          File CSV/TSV (header sesuai 19 kolom PRD)
          <input className="input" type="file" accept=".csv,.tsv,.txt,.json" onChange={onFile} />
          {fileName && <span className="small">{fileName} · {csv.split(/\r?\n/).filter(Boolean).length - 1} baris</span>}
        </label>
      )}
      {tab === 'paste' && <textarea className="input mono" rows={7} placeholder="Tempel tabel termasuk baris header (tab / koma / titik koma)" value={csv} onChange={(e) => setCsv(e.target.value)} />}
      {tab === 'url' && (
        <div className="col">
          <label className="field">
            Link Edit Google Sheets (Bagikan → &quot;Siapa saja yang memiliki link&quot; untuk update instan &lt; 1 detik!)
            <input
              className="input"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/1abc.../edit#gid=0"
            />
          </label>
          {isPubLink && (
            <div className="notice warn small">
              ⚠️ Anda menggunakan link <b>/pub (Publikasikan ke web)</b> yang memiliki <b>delay cache 5 menit dari Google</b>. Agar update instan (&lt; 1 detik), salin langsung <b>URL dari address bar Google Sheets</b> (<span className="mono">.../spreadsheets/d/.../edit#gid=0</span>) dan pastikan tombol <b>Bagikan (Share)</b> disetel ke <b>&quot;Siapa saja yang memiliki link&quot;</b>.
            </div>
          )}
          <div className="row" style={{ background: '#0a1328', padding: '.6rem .8rem', borderRadius: 10, border: '1px solid var(--line)' }}>
            <span className="small" style={{ fontWeight: 700 }}>🔄 Auto-Sync Berkala:</span>
            <select
              className="input"
              style={{ width: 170, padding: '.35rem .6rem' }}
              value={intervalSec}
              onChange={(e) => changeAutoSync(Number(e.target.value))}
              disabled={!url.trim()}
            >
              <option value={0}>Mati (Manual)</option>
              <option value={5}>Setiap 5 detik ⚡</option>
              <option value={10}>Setiap 10 detik</option>
              <option value={15}>Setiap 15 detik</option>
              <option value={30}>Setiap 30 detik</option>
              <option value={60}>Setiap 60 detik</option>
            </select>
            {sync?.last_sync && (
              <span className="small muted">
                Sinkron terakhir: <b style={{ color: 'var(--text)' }}>{tm(sync.last_sync)}</b>
                {sync.last_result ? ` (${sync.last_result.created} baru, ${sync.last_result.updated} update)` : ''}
              </span>
            )}
          </div>
          {sync?.last_error && <div className="notice error small">Auto-Sync Error: {sync.last_error}</div>}
        </div>
      )}
      <div className="row">
        <button className="btn" disabled={!hasInput || busy} onClick={() => run(true)}>
          Validasi
        </button>
        <button className="btn btn-primary" disabled={!hasInput || busy} onClick={() => run(false)}>
          {busy ? 'Memproses…' : '⚡ Tarik & Update Sekarang'}
        </button>
        <span className="small muted">Match yang sudah dimulai hanya diperbarui metadata jadwalnya (lapangan/jam).</span>
      </div>
      {result && (
        <div className="col">
          {!result.ok && <div className="notice error">{result.error}</div>}
          {result.ok && (
            <div className={`notice ${result.errors?.length ? 'warn' : 'ok'}`}>
              {result.dry_run ? `Validasi: ${result.valid}/${result.total} baris valid.` : `Sinkron selesai: ${result.created} baru, ${result.updated} diperbarui dari ${result.total} baris.`}
              {result.errors?.length ? ` ${result.errors.length} baris ditolak.` : ''}
            </div>
          )}
          {result.errors?.length > 0 && (
            <div className="err-list">
              {result.errors.map((e) => (
                <div key={e.row}>
                  <b>Baris {e.row}</b> {e.match_number && `(${e.match_number})`}: {e.messages.join('; ')}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EditMatchModal({ match, pin, courtCount, onClose, notify }) {
  const st = match.live_state;
  const sm = match.session_management;
  const [tournamentName, setTournamentName] = useState(match.tournament_name || '');
  const [categoryName, setCategoryName] = useState(match.category_name || '');
  const [discipline, setDiscipline] = useState(match.discipline || 'MD');
  const [scheduledDate, setScheduledDate] = useState(match.scheduled_date || '');
  const [scheduledTime, setScheduledTime] = useState(match.scheduled_time || '');
  const [courtNumber, setCourtNumber] = useState(String(match.court_number || 1));

  const [scoringMethod, setScoringMethod] = useState(match.rules?.scoring_method || 'rally_point');
  const [scoringType, setScoringType] = useState(match.rules?.scoring_type || 'sets');
  const [winPoint, setWinPoint] = useState(String(match.rules?.win_point ?? 21));
  const [intervalPoint, setIntervalPoint] = useState(String(match.rules?.interval_point ?? 11));

  const [teamA, setTeamA] = useState({
    p1: match.teams?.team_a?.p1 || '',
    p2: match.teams?.team_a?.p2 || '',
    club: match.teams?.team_a?.club || '',
  });
  const [teamB, setTeamB] = useState({
    p1: match.teams?.team_b?.p1 || '',
    p2: match.teams?.team_b?.p2 || '',
    club: match.teams?.team_b?.club || '',
  });

  const [status, setStatus] = useState(sm.status || 'scheduled');
  const [scoreA, setScoreA] = useState(String(st.score?.a ?? 0));
  const [scoreB, setScoreB] = useState(String(st.score?.b ?? 0));
  const [setsA, setSetsA] = useState(String(st.sets?.a ?? 0));
  const [setsB, setSetsB] = useState(String(st.sets?.b ?? 0));
  const [winner, setWinner] = useState(st.winner || '');
  const [setHistory, setSetHistory] = useState(
    st.set_history?.length
      ? st.set_history.map((s) => ({ a: String(s.a), b: String(s.b), winner: s.winner || '' }))
      : []
  );
  const [adminNote, setAdminNote] = useState('');
  const [reExport, setReExport] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const isDbl = DOUBLES.includes(discipline);

  const applyQuickPreset = (preset, winTeam) => {
    const loseTeam = winTeam === 'a' ? 'b' : 'a';
    const wp = parseInt(winPoint, 10) || 21;
    setStatus('finished');
    setWinner(winTeam);
    if (scoringType === 'sets') {
      setSetsA(winTeam === 'a' ? '2' : '0');
      setSetsB(winTeam === 'b' ? '2' : '0');
      setScoreA(winTeam === 'a' ? String(wp) : '0');
      setScoreB(winTeam === 'b' ? String(wp) : '0');
      setSetHistory([
        { a: winTeam === 'a' ? String(wp) : '0', b: winTeam === 'b' ? String(wp) : '0', winner: winTeam },
        { a: winTeam === 'a' ? String(wp) : '0', b: winTeam === 'b' ? String(wp) : '0', winner: winTeam },
      ]);
    } else {
      setScoreA(winTeam === 'a' ? String(wp) : '0');
      setScoreB(winTeam === 'b' ? String(wp) : '0');
      setSetHistory([
        { a: winTeam === 'a' ? String(wp) : '0', b: winTeam === 'b' ? String(wp) : '0', winner: winTeam },
      ]);
    }
    setAdminNote(`${preset}: Tim ${loseTeam.toUpperCase()} (${loseTeam === 'a' ? teamA.p1 : teamB.p1}) -> Pemenang Tim ${winTeam.toUpperCase()}`);
  };

  const addSetRow = () => {
    setSetHistory((h) => [...h, { a: '21', b: '15', winner: 'a' }]);
  };

  const removeSetRow = (idx) => {
    setSetHistory((h) => h.filter((_, i) => i !== idx));
  };

  const updateSetRow = (idx, field, val) => {
    setSetHistory((h) =>
      h.map((row, i) => {
        if (i !== idx) return row;
        const next = { ...row, [field]: val };
        const na = parseInt(next.a, 10) || 0;
        const nb = parseInt(next.b, 10) || 0;
        if (field === 'a' || field === 'b') {
          next.winner = na >= nb ? 'a' : 'b';
        }
        return next;
      })
    );
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const body = {
      tournament_name: tournamentName,
      category_name: categoryName,
      discipline,
      scheduled_date: scheduledDate,
      scheduled_time: scheduledTime,
      court_number: parseInt(courtNumber, 10),
      rules: {
        scoring_method: scoringMethod,
        scoring_type: scoringType,
        win_point: parseInt(winPoint, 10),
        interval_point: parseInt(intervalPoint, 10),
      },
      teams: {
        team_a: { p1: teamA.p1, p2: isDbl ? teamA.p2 : null, club: teamA.club },
        team_b: { p1: teamB.p1, p2: isDbl ? teamB.p2 : null, club: teamB.club },
      },
      status,
      score: { a: parseInt(scoreA, 10) || 0, b: parseInt(scoreB, 10) || 0 },
      sets: { a: parseInt(setsA, 10) || 0, b: parseInt(setsB, 10) || 0 },
      set_history: setHistory.map((s, idx) => ({
        set: idx + 1,
        a: parseInt(s.a, 10) || 0,
        b: parseInt(s.b, 10) || 0,
        winner: s.winner || ((parseInt(s.a, 10) || 0) >= (parseInt(s.b, 10) || 0) ? 'a' : 'b'),
      })),
      winner: winner || null,
      admin_note: adminNote,
      re_export: reExport,
    };

    const r = await api(`/api/matches/${encodeURIComponent(match.match_number)}`, {
      method: 'PATCH',
      pin,
      body,
    });
    setBusy(false);
    if (r.ok) {
      notify({ type: 'ok', text: `Match ${match.match_number} berhasil diperbarui` });
      onClose();
    } else {
      setErr(r.error || 'Gagal menyimpan perubahan');
    }
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal col" style={{ width: 'min(920px, 100%)' }} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="row">
          <h2 style={{ margin: 0 }}>✏️ Edit Lengkap Pertandingan · {match.match_number}</h2>
          <StatusBadge match={match} />
          <div className="spacer" />
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        {err && <div className="notice error">{err}</div>}

        {/* Section 1: Jadwal, Lapangan & Aturan */}
        <div className="card col" style={{ padding: '.85rem' }}>
          <div className="small" style={{ fontWeight: 800, color: 'var(--gold)' }}>1. JADWAL, LAPANGAN & ATURAN PERTANDINGAN</div>
          <div className="info-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
            <label className="field">
              Nama Turnamen
              <input className="input" value={tournamentName} onChange={(e) => setTournamentName(e.target.value)} />
            </label>
            <label className="field">
              Kategori
              <input className="input" value={categoryName} onChange={(e) => setCategoryName(e.target.value)} />
            </label>
            <label className="field">
              Disiplin
              <select className="input" value={discipline} onChange={(e) => setDiscipline(e.target.value)}>
                {DISCIPLINES.map((d) => (
                  <option key={d} value={d}>
                    {d} - {DISCIPLINE_LABEL[d]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Tanggal (YYYY-MM-DD)
              <input className="input" value={scheduledDate} placeholder="2026-10-20" onChange={(e) => setScheduledDate(e.target.value)} />
            </label>
            <label className="field">
              Jam Pertandingan
              <input className="input" value={scheduledTime} placeholder="14:30 WIB" onChange={(e) => setScheduledTime(e.target.value)} />
            </label>
            <label className="field">
              Lapangan (Court)
              <select className="input" value={courtNumber} onChange={(e) => setCourtNumber(e.target.value)}>
                {Array.from({ length: courtCount }, (_, i) => (
                  <option key={i} value={i + 1}>
                    Lapangan {i + 1}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Metode Skor
              <select className="input" value={scoringMethod} onChange={(e) => setScoringMethod(e.target.value)}>
                <option value="rally_point">Rally Point</option>
                <option value="side_out">Side-Out (Pindah Bola)</option>
              </select>
            </label>
            <label className="field">
              Tipe Pertandingan
              <select className="input" value={scoringType} onChange={(e) => setScoringType(e.target.value)}>
                <option value="sets">Sets (Best of 3)</option>
                <option value="continuous">Continuous (1 Game Panjang)</option>
              </select>
            </label>
            <label className="field">
              Win Point
              <input className="input" type="number" min={1} max={200} value={winPoint} onChange={(e) => setWinPoint(e.target.value)} />
            </label>
            <label className="field">
              Interval Point
              <input className="input" type="number" min={0} max={199} value={intervalPoint} onChange={(e) => setIntervalPoint(e.target.value)} />
            </label>
          </div>
        </div>

        {/* Section 2: Nama Pemain & Club */}
        <div className="setup-grid">
          <div className="card col" style={{ padding: '.85rem' }}>
            <div className="small" style={{ fontWeight: 800, color: '#93c5fd' }}>2A. TIM A (PEMAIN & CLUB)</div>
            <label className="field">
              Pemain 1 Tim A
              <input className="input" value={teamA.p1} onChange={(e) => setTeamA({ ...teamA, p1: e.target.value })} required />
            </label>
            {isDbl && (
              <label className="field">
                Pemain 2 Tim A (Ganda)
                <input className="input" value={teamA.p2} onChange={(e) => setTeamA({ ...teamA, p2: e.target.value })} required />
              </label>
            )}
            <label className="field">
              Club / PB Tim A
              <input className="input" value={teamA.club} onChange={(e) => setTeamA({ ...teamA, club: e.target.value })} />
            </label>
          </div>

          <div className="card col" style={{ padding: '.85rem' }}>
            <div className="small" style={{ fontWeight: 800, color: '#fca5a5' }}>2B. TIM B (PEMAIN & CLUB)</div>
            <label className="field">
              Pemain 1 Tim B
              <input className="input" value={teamB.p1} onChange={(e) => setTeamB({ ...teamB, p1: e.target.value })} required />
            </label>
            {isDbl && (
              <label className="field">
                Pemain 2 Tim B (Ganda)
                <input className="input" value={teamB.p2} onChange={(e) => setTeamB({ ...teamB, p2: e.target.value })} required />
              </label>
            )}
            <label className="field">
              Club / PB Tim B
              <input className="input" value={teamB.club} onChange={(e) => setTeamB({ ...teamB, club: e.target.value })} />
            </label>
          </div>
        </div>

        {/* Section 3: Status, Skor, Hasil Akhir, Diskualifikasi / WO */}
        <div className="card col" style={{ padding: '.85rem' }}>
          <div className="row">
            <div className="small" style={{ fontWeight: 800, color: 'var(--gold)' }}>
              3. STATUS PERTANDINGAN, SKOR & KEPUTUSAN KHUSUS (DISKUALIFIKASI / WO / RETIRED)
            </div>
          </div>

          {/* Tombol Aksi Cepat Diskualifikasi / Walkover */}
          <div className="row" style={{ background: '#0a1328', padding: '.6rem .8rem', borderRadius: 10, border: '1px solid var(--line)' }}>
            <span className="small muted" style={{ fontWeight: 700 }}>⚡ Keputusan Cepat:</span>
            <button type="button" className="btn btn-sm btn-blue" onClick={() => applyQuickPreset('Diskualifikasi/WO Tim B', 'a')}>
              🏆 Menangkan Tim A (Tim B Diskualifikasi / WO)
            </button>
            <button type="button" className="btn btn-sm btn-red" onClick={() => applyQuickPreset('Diskualifikasi/WO Tim A', 'b')}>
              🏆 Menangkan Tim B (Tim A Diskualifikasi / WO)
            </button>
          </div>

          <div className="info-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))' }}>
            <label className="field">
              Status Pertandingan
              <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="scheduled">Terjadwal (Belum Mulai)</option>
                <option value="locked">Setup (Dikunci Wasit)</option>
                <option value="in_progress">Berlangsung (Live)</option>
                <option value="finished">Selesai (Finished)</option>
              </select>
            </label>
            <label className="field">
              Pemenang Pertandingan
              <select className="input" value={winner} onChange={(e) => setWinner(e.target.value)}>
                <option value="">— Belum Ditentukan —</option>
                <option value="a">Tim A ({teamA.p1})</option>
                <option value="b">Tim B ({teamB.p1})</option>
              </select>
            </label>
            <label className="field">
              Skor Poin Aktif Tim A
              <input className="input" type="number" min={0} max={200} value={scoreA} onChange={(e) => setScoreA(e.target.value)} />
            </label>
            <label className="field">
              Skor Poin Aktif Tim B
              <input className="input" type="number" min={0} max={200} value={scoreB} onChange={(e) => setScoreB(e.target.value)} />
            </label>
            {scoringType === 'sets' && (
              <>
                <label className="field">
                  Set Menang Tim A
                  <input className="input" type="number" min={0} max={5} value={setsA} onChange={(e) => setSetsA(e.target.value)} />
                </label>
                <label className="field">
                  Set Menang Tim B
                  <input className="input" type="number" min={0} max={5} value={setsB} onChange={(e) => setSetsB(e.target.value)} />
                </label>
              </>
            )}
          </div>

          {/* Riwayat Skor Per Set */}
          <div className="col" style={{ marginTop: '.25rem' }}>
            <div className="row">
              <span className="small muted">Riwayat Skor Set (ditampilkan di Laporan Hasil & TV/OBS):</span>
              <button type="button" className="btn btn-sm" onClick={addSetRow}>
                + Tambah Set
              </button>
            </div>
            {setHistory.map((s, idx) => (
              <div key={idx} className="row" style={{ background: '#0a1328', padding: '.4rem .7rem', borderRadius: 8 }}>
                <b className="small" style={{ minWidth: 55 }}>Set {idx + 1}</b>
                <span className="small muted">Tim A:</span>
                <input
                  className="inline-input"
                  style={{ width: 65 }}
                  type="number"
                  min={0}
                  value={s.a}
                  onChange={(e) => updateSetRow(idx, 'a', e.target.value)}
                />
                <span className="small muted">Tim B:</span>
                <input
                  className="inline-input"
                  style={{ width: 65 }}
                  type="number"
                  min={0}
                  value={s.b}
                  onChange={(e) => updateSetRow(idx, 'b', e.target.value)}
                />
                <span className="small muted">Pemenang Set:</span>
                <select
                  className="inline-input"
                  style={{ width: 95 }}
                  value={s.winner}
                  onChange={(e) => updateSetRow(idx, 'winner', e.target.value)}
                >
                  <option value="a">Tim A</option>
                  <option value="b">Tim B</option>
                </select>
                <div className="spacer" />
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => removeSetRow(idx)}>
                  🗑 Hapus
                </button>
              </div>
            ))}
          </div>

          <div className="row" style={{ marginTop: '.3rem' }}>
            <label className="field" style={{ flex: 1 }}>
              Catatan Audit Log (Alasan perubahan / diskualifikasi / koreksi)
              <input
                className="input"
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
                placeholder="Contoh: Tim B didiskualifikasi karena melanggar regulasi umur kategori"
              />
            </label>
          </div>
          {status === 'finished' && (
            <label className="row small" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={reExport} onChange={(e) => setReExport(e.target.checked)} />
              Otomatis perbarui file ekspor CSV & kirim ulang hasil ke Google Sheets
            </label>
          )}
        </div>

        <div className="row">
          <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
            {busy ? 'Menyimpan…' : '💾 Simpan Semua Perubahan'}
          </button>
          <button type="button" className="btn btn-ghost btn-lg" onClick={onClose}>
            Batal
          </button>
        </div>
      </form>
    </div>
  );
}

function LogsModal({ id, onClose }) {
  const [logs, setLogs] = useState(null);
  useEffect(() => {
    api(`/api/matches/${encodeURIComponent(id)}/logs`).then((r) => setLogs(r.logs || []));
  }, [id]);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal col" style={{ width: 'min(1100px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2 style={{ margin: 0 }}>Audit Log · {id}</h2>
          <div className="spacer" />
          <a className="btn btn-sm" href={`/api/export/logs.csv?match=${encodeURIComponent(id)}`}>
            ⬇ CSV
          </a>
          <button className="btn btn-sm btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Waktu</th>
                <th>Event</th>
                <th>Detail</th>
                <th>Aktor</th>
              </tr>
            </thead>
            <tbody>
              {logs?.map((l) => (
                <tr key={l.log_id}>
                  <td className="mono small">{tm(l.timestamp)}</td>
                  <td>
                    <span className={`badge ${l.event_type === 'UNDO' ? 'gold' : l.event_type.startsWith('SIDE_OUT') ? 'blue' : l.event_type.includes('TAKEOVER') ? 'red' : ''}`}>{l.event_type}</span>
                  </td>
                  <td className="small">{l.details}</td>
                  <td className="mono small">{String(l.actor_id).slice(-6)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!logs && <div className="muted" style={{ padding: '1rem' }}>Memuat…</div>}
        </div>
      </div>
    </div>
  );
}

function CourtGrid({ matches, courtCount, now, onUnlock }) {
  const courts = useMemo(() => {
    const out = [];
    for (let c = 1; c <= courtCount; c += 1) {
      const ms = matches.filter((m) => m.court_number === c);
      const active = ms.filter((m) => ACTIVE.includes(m.session_management.status)).sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
      const next = ms.filter((m) => m.session_management.status === 'scheduled');
      const done = ms.filter((m) => m.session_management.status === 'finished').length;
      out.push({ c, featured: active[0] || null, extraActive: active.length - 1, next: next[0] || null, queue: next.length, done });
    }
    return out;
  }, [matches, courtCount]);

  return (
    <div className="admin-courts">
      {courts.map(({ c, featured: m, extraActive, next, queue, done }) => {
        const age = m ? heartbeatAge(m, now) : null;
        const stale = m && m.session_management.locked && age > 30;
        const st = m?.live_state;
        return (
          <div key={c} className={`court-card ${m ? 'active' : ''} ${stale || extraActive > 0 ? 'warn' : ''}`}>
            <div className="row" style={{ gap: '.4rem' }}>
              <span className="cnum">Lap. {c}</span>
              <div className="spacer" />
              <Link className="small" href={`/display?court=${c}`} target="_blank">
                📺
              </Link>
            </div>
            {m ? (
              <>
                <div className="row" style={{ gap: '.4rem' }}>
                  <b>{m.match_number}</b>
                  <StatusBadge match={m} />
                  {st.phase === 'interval' && <span className="badge gold">INTERVAL</span>}
                  {st.started_at && (
                    <span className="badge cyan mono" title="Durasi Pertandingan">
                      ⏱ {matchDurationText(m, now)}
                    </span>
                  )}
                </div>
                <div className="cteam">{teamLabel(m, 'a')}</div>
                <div className="cteam">{teamLabel(m, 'b')}</div>
                <div className="cscore">
                  {st.score.a} - {st.score.b}
                  {m.rules.scoring_type === 'sets' && (
                    <span className="small muted">
                      {' '}
                      ({st.sets.a}-{st.sets.b})
                    </span>
                  )}
                </div>
                <div className="small">
                  {m.session_management.locked ? (
                    <span style={{ color: stale ? '#fbbf24' : '#4ade80' }}>
                      🔒 {m.session_management.controller_label || `…${m.session_management.controller_tag}`} · ♥ {age}s
                    </span>
                  ) : (
                    <span className="muted">🔓 tanpa pengontrol</span>
                  )}
                </div>
                {m.session_management.locked && (
                  <button className="btn btn-sm btn-red" onClick={() => onUnlock(m.match_number)}>
                    Lepas Kunci
                  </button>
                )}
                {extraActive > 0 && <div className="small" style={{ color: '#fbbf24' }}>⚠ {extraActive} match aktif lain di lapangan ini</div>}
              </>
            ) : (
              <div className="small muted" style={{ flex: 1 }}>
                {next ? (
                  <>
                    Berikutnya: <b style={{ color: 'var(--text)' }}>{next.match_number}</b> {[next.scheduled_date, next.scheduled_time].filter(Boolean).join(' ')}
                    <br />
                    {teamLabel(next, 'a')} vs {teamLabel(next, 'b')}
                  </>
                ) : (
                  'Kosong'
                )}
              </div>
            )}
            <div className="small muted">
              Antrian {queue} · Selesai {done}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MatchTable({ matches, pin, courtCount, now, onEdit, onLogs, notify }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [court, setCourt] = useState('');
  const filtered = matches.filter((m) => {
    if (status && m.session_management.status !== status) return false;
    if (court && m.court_number !== Number(court)) return false;
    if (q) {
      const hay = `${m.match_number} ${m.category_name} ${teamLabel(m, 'a')} ${teamLabel(m, 'b')} ${m.teams.team_a.club} ${m.teams.team_b.club}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  const call = async (path, method = 'POST', body, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    const r = await api(path, { method, pin, body });
    notify(r.ok ? { type: 'ok', text: 'Berhasil' } : { type: 'error', text: r.error });
  };
  const enc = encodeURIComponent;

  return (
    <div className="card col">
      <div className="row">
        <h3 style={{ margin: 0 }}>📋 Daftar & Laporan Pertandingan ({filtered.length}/{matches.length})</h3>
        <div className="spacer" />
        <input className="input" style={{ width: 220 }} placeholder="Cari match / pemain / club" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" style={{ width: 150 }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Semua status</option>
          <option value="scheduled">Terjadwal</option>
          <option value="locked">Setup</option>
          <option value="in_progress">Berlangsung</option>
          <option value="finished">Selesai</option>
        </select>
        <select className="input" style={{ width: 130 }} value={court} onChange={(e) => setCourt(e.target.value)}>
          <option value="">Semua lap.</option>
          {Array.from({ length: courtCount }, (_, i) => (
            <option key={i} value={i + 1}>
              Lapangan {i + 1}
            </option>
          ))}
        </select>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Match</th>
              <th>Kategori</th>
              <th>Tim A vs Tim B</th>
              <th>Aturan</th>
              <th>Tanggal</th>
              <th>Lap.</th>
              <th>Jam</th>
              <th>Status</th>
              <th>Skor</th>
              <th>Durasi</th>
              <th>Pengontrol</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => {
              const sm = m.session_management;
              const st = m.live_state;
              const dur = matchDurationText(m, now);
              return (
                <tr key={m.match_number}>
                  <td>
                    <b>{m.match_number}</b>
                  </td>
                  <td className="small">
                    {m.category_name}
                    <br />
                    <span className="muted">{m.discipline}</span>
                  </td>
                  <td className="small">
                    {teamLabel(m, 'a')} <span className="muted">({m.teams.team_a.club || '-'})</span>
                    <br />
                    {teamLabel(m, 'b')} <span className="muted">({m.teams.team_b.club || '-'})</span>
                  </td>
                  <td className="small muted">
                    {m.rules.scoring_method === 'side_out' ? 'Side-out' : 'Rally'} · {m.rules.scoring_type} · {m.rules.win_point}/{m.rules.interval_point}
                  </td>
                  <td>
                    <input
                      className="inline-input"
                      defaultValue={m.scheduled_date}
                      placeholder="YYYY-MM-DD"
                      key={`${m.match_number}-d-${m.scheduled_date}`}
                      onBlur={(e) => {
                        if (e.target.value !== (m.scheduled_date || '')) call(`/api/matches/${enc(m.match_number)}`, 'PATCH', { scheduled_date: e.target.value });
                      }}
                    />
                  </td>
                  <td>
                    <select className="inline-input" style={{ width: '4rem' }} value={m.court_number} onChange={(e) => call(`/api/matches/${enc(m.match_number)}`, 'PATCH', { court_number: e.target.value })}>
                      {Array.from({ length: courtCount }, (_, i) => (
                        <option key={i} value={i + 1}>
                          {i + 1}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className="inline-input"
                      defaultValue={m.scheduled_time}
                      key={`${m.match_number}-${m.scheduled_time}`}
                      onBlur={(e) => {
                        if (e.target.value !== m.scheduled_time) call(`/api/matches/${enc(m.match_number)}`, 'PATCH', { scheduled_time: e.target.value });
                      }}
                    />
                  </td>
                  <td>
                    <StatusBadge match={m} />
                    {m.export_status && (
                      <div className="small muted" title={m.export_status.message}>
                        ⇪ {m.export_status.state}
                      </div>
                    )}
                  </td>
                  <td className="mono">
                    {st.score.a}-{st.score.b}
                    {m.rules.scoring_type === 'sets' && <span className="muted"> [{st.sets.a}-{st.sets.b}]</span>}
                  </td>
                  <td className="mono small">
                    {dur ? (
                      <span className={`badge ${sm.status === 'in_progress' ? 'cyan' : ''}`}>⏱ {dur}</span>
                    ) : (
                      <span className="muted">-</span>
                    )}
                  </td>
                  <td className="small">{sm.locked ? `🔒 ${sm.controller_label || `…${sm.controller_tag}`}` : <span className="muted">-</span>}</td>
                  <td>
                    <div className="row" style={{ gap: '.3rem', flexWrap: 'nowrap' }}>
                      <button className="btn btn-sm btn-yellow" onClick={() => onEdit(m)} title="Edit lengkap (pemain, club, skor, status, diskualifikasi/WO)">
                        ✏️ Edit
                      </button>
                      <button className="btn btn-sm" onClick={() => onLogs(m.match_number)} title="Audit log">
                        Log
                      </button>
                      {sm.locked && (
                        <button className="btn btn-sm btn-red" onClick={() => call(`/api/matches/${enc(m.match_number)}/unlock`, 'POST', null, `Lepas paksa kunci sesi ${m.match_number}?`)}>
                          Unlock
                        </button>
                      )}
                      {sm.status === 'finished' && (
                        <>
                          <button className="btn btn-sm btn-blue" onClick={() => call(`/api/matches/${enc(m.match_number)}/export`)}>
                            Export
                          </button>
                          <button className="btn btn-sm" onClick={() => call(`/api/matches/${enc(m.match_number)}/reopen`, 'POST', null, `Buka kembali ${m.match_number} untuk koreksi?`)}>
                            Reopen
                          </button>
                        </>
                      )}
                      <button className="btn btn-sm btn-grey" onClick={() => call(`/api/matches/${enc(m.match_number)}/reset`, 'POST', null, `RESET skor & sesi ${m.match_number}? Log tetap tersimpan.`)}>
                        Reset
                      </button>
                      <button className="btn btn-sm btn-grey" onClick={() => call(`/api/matches/${enc(m.match_number)}`, 'DELETE', null, `HAPUS match ${m.match_number}?`)}>
                        🗑
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!filtered.length && <div className="muted" style={{ padding: '1rem' }}>Belum ada data. Import jadwal terlebih dahulu.</div>}
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [pin, setPin] = useState(null);
  const [matches, setMatches] = useState([]);
  const [exporter, setExporter] = useState(null);
  const [sync, setSync] = useState(null);
  const [connected, setConnected] = useState(false);
  const [courtCount, setCourtCount] = useState(15);
  const [logsFor, setLogsFor] = useState(null);
  const [editMatch, setEditMatch] = useState(null);
  const [notice, setNotice] = useState(null);
  const now = useNow(1000);

  useEffect(() => {
    const p = sessionStorage.getItem('sp_admin_pin');
    if (p) setPin(p);
    api('/api/config').then((c) => c.court_count && setCourtCount(c.court_count));
  }, []);

  useEffect(() => {
    if (!pin) return undefined;
    const s = getSocket();
    const sub = async () => {
      setConnected(true);
      const r = await emitAck('admin:watch', { pin });
      if (r.ok) {
        setMatches(r.matches);
        setExporter(r.exporter);
        if (r.sync) setSync(r.sync);
      } else if (r.reason === 'bad_pin') {
        sessionStorage.removeItem('sp_admin_pin');
        setPin(null);
      }
    };
    const onState = (d) => {
      setMatches(d.matches);
      setExporter(d.exporter);
      if (d.sync) setSync(d.sync);
    };
    const onDisc = () => setConnected(false);
    s.on('connect', sub);
    s.on('disconnect', onDisc);
    s.on('admin:state', onState);
    if (s.connected) sub();
    return () => {
      s.off('connect', sub);
      s.off('disconnect', onDisc);
      s.off('admin:state', onState);
    };
  }, [pin]);

  const notify = useCallback((n) => {
    setNotice(n);
    setTimeout(() => setNotice((x) => (x === n ? null : x)), 4000);
  }, []);

  if (!pin) return <PinGate onOk={setPin} />;

  const stats = {
    total: matches.length,
    live: matches.filter((m) => m.session_management.status === 'in_progress').length,
    setup: matches.filter((m) => m.session_management.status === 'locked').length,
    finished: matches.filter((m) => m.session_management.status === 'finished').length,
  };

  return (
    <main className="container col" style={{ maxWidth: 1600 }}>
      <div className="row">
        <Link href="/" style={{ color: 'var(--text)' }}>
          <h1 style={{ margin: 0 }}>
            🏸 SmashPoint <span className="muted" style={{ fontSize: '1rem' }}>Server Admin</span>
          </h1>
        </Link>
        <div className="spacer" />
        <span className="badge">Total {stats.total}</span>
        <span className="badge blue">Setup {stats.setup}</span>
        <span className="badge green">Live {stats.live}</span>
        <span className="badge gold">Selesai {stats.finished}</span>
        <span className="row small" style={{ gap: '.4rem' }}>
          <span className={`dot ${connected ? 'on' : ''}`} /> {connected ? 'Real-time' : 'Terputus'}
        </span>
        <button
          className="btn btn-sm btn-ghost"
          onClick={() => {
            sessionStorage.removeItem('sp_admin_pin');
            setPin(null);
          }}
        >
          Keluar
        </button>
      </div>
      {notice && <div className={`notice ${notice.type}`}>{notice.text}</div>}

      <CourtGrid
        matches={matches}
        courtCount={courtCount}
        now={now}
        onUnlock={async (id) => {
          if (!window.confirm(`Lepas paksa kunci sesi ${id}? Perangkat wasit akan dialihkan ke mode pantau.`)) return;
          const r = await api(`/api/matches/${encodeURIComponent(id)}/unlock`, { method: 'POST', pin });
          notify(r.ok ? { type: 'ok', text: `Kunci ${id} dilepas` } : { type: 'error', text: r.error });
        }}
      />

      <div className="setup-grid">
        <ImportPanel pin={pin} sync={sync} onSyncChange={setSync} onDone={() => notify({ type: 'ok', text: 'Import selesai' })} />
        <div className="card col">
          <h3 style={{ margin: 0 }}>📤 Ekspor & Sinkronisasi</h3>
          <div className="row">
            <a className="btn" href="/api/export/results.csv">
              ⬇ Hasil (CSV)
            </a>
            <a className="btn" href="/api/export/logs.csv">
              ⬇ Semua Log (CSV)
            </a>
          </div>
          <div className="info-grid">
            <div>
              <div className="k">Google Sheets Webhook</div>
              <div className="v">{exporter?.webhook_configured ? '✅ Terkonfigurasi' : '— Lokal saja'}</div>
            </div>
            <div>
              <div className="k">Antrian Sinkron</div>
              <div className="v">{exporter?.queue_length ?? 0}</div>
            </div>
            <div>
              <div className="k">Sukses Terakhir</div>
              <div className="v small">{tm(exporter?.last_success)}</div>
            </div>
          </div>
          {exporter?.last_error && <div className="notice warn small">Error terakhir: {exporter.last_error}</div>}
          <div className="row">
            <button
              className="btn btn-sm btn-blue"
              disabled={!exporter?.webhook_configured || !exporter?.queue_length}
              onClick={async () => {
                const r = await api('/api/admin/export/retry', { method: 'POST', pin });
                if (r.exporter) setExporter(r.exporter);
              }}
            >
              ⟳ Coba Kirim Ulang
            </button>
            <div className="spacer" />
            <button
              className="btn btn-sm btn-grey"
              onClick={async () => {
                if (!window.confirm('Hapus SEMUA data match dari server? (Log audit tetap tersimpan)')) return;
                const r = await api('/api/matches', { method: 'DELETE', pin });
                notify(r.ok ? { type: 'ok', text: 'Semua match dihapus' } : { type: 'error', text: r.error });
              }}
            >
              🗑 Hapus Semua Match
            </button>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Hasil match berstatus <b>finished</b> otomatis ditulis ke <span className="mono">exports/</span> dan dikirim ke Google Sheets (jika <span className="mono">GOOGLE_SHEETS_WEBHOOK_URL</span> diset). Saat offline, antrian dicoba ulang tiap 60 detik.
          </p>
        </div>
      </div>

      <MatchTable matches={matches} pin={pin} courtCount={courtCount} now={now} onEdit={setEditMatch} onLogs={setLogsFor} notify={notify} />
      {editMatch && (
        <EditMatchModal
          match={matches.find((x) => x.match_number === editMatch.match_number) || editMatch}
          pin={pin}
          courtCount={courtCount}
          onClose={() => setEditMatch(null)}
          notify={notify}
        />
      )}
      {logsFor && <LogsModal id={logsFor} onClose={() => setLogsFor(null)} />}
    </main>
  );
}
