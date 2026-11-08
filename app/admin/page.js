'use client';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, emitAck, getSocket, useNow } from '@/lib/client';
import {
  DISCIPLINES,
  DISCIPLINE_LABEL,
  DOUBLES,
  detailsToInput,
  matchDurationSec,
  matchDurationText,
  parseScheduleDateValue,
  parseScheduleDateToIso,
  formatIsoToIndonesianDate,
  parseScheduleTimeToPicker,
  formatPickerToScheduleTime,
  teamLabel,
  teamSeedBadge,
} from '@/lib/engine';
import { StatusBadge } from '@/components/referee/Entry';

const ACTIVE = ['locked', 'in_progress'];
const tm = (s) => (s ? new Date(s).toLocaleTimeString('id-ID', { hour12: false }) : '-');

function heartbeatAge(m, now) {
  if (!m.session_management.last_heartbeat) return null;
  return Math.max(0, Math.round((now - new Date(m.session_management.last_heartbeat).getTime()) / 1000));
}

function LoginGate({ onOk }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const r = await api('/api/admin/login', {
      method: 'POST',
      body: { username: username.trim(), password },
    });
    setBusy(false);
    if (r.ok && r.token) {
      sessionStorage.setItem('sp_admin_token', r.token);
      sessionStorage.setItem('sp_admin_user', JSON.stringify(r.user));
      onOk(r.token, r.user);
    } else {
      setErr(r.error || 'Username atau password salah');
    }
  };

  return (
    <main className="container" style={{ maxWidth: 440, paddingTop: '10vh' }}>
      <form className="card col" onSubmit={submit}>
        <div className="row">
          <h2 style={{ margin: 0 }}>🔐 Login Server Admin</h2>
        </div>
        <p className="muted small">
          Halaman terproteksi khusus Administrator Turnamen. Masukkan <b>Username</b> dan <b>Password</b> Anda untuk melanjutkan.
        </p>
        {err && <div className="notice error">{err}</div>}
        <label className="field">
          Username
          <input
            className="input"
            type="text"
            autoFocus
            autoComplete="username"
            placeholder="contoh: admin"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="field">
          Password
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            placeholder="Masukkan password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button className="btn btn-primary btn-lg" disabled={!username.trim() || !password || busy}>
          {busy ? 'Memverifikasi…' : 'Masuk ke Dashboard Admin'}
        </button>
      </form>
    </main>
  );
}

function ImportPanel({ pin, sync, onSyncChange, onDone }) {
  const [tab, setTab] = useState('url');
  const [csv, setCsv] = useState('');
  const [url, setUrl] = useState('');
  const [sheetName, setSheetName] = useState('Jadwal');
  const [intervalSec, setIntervalSec] = useState(0);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    setUrl(sync?.url || '');
    setSheetName(sync?.sheet_name || 'Jadwal');
    if (sync?.interval_sec !== undefined) setIntervalSec(sync.interval_sec);
    setResult(null);
  }, [sync?.url, sync?.sheet_name, sync?.interval_sec]);

  const run = async (dry) => {
    setBusy(true);
    setResult(null);
    const body = tab === 'url' ? { url, sheet_name: sheetName } : { csv };
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
      body: { url: url.trim(), sheet_name: sheetName.trim() || 'Jadwal', interval_sec: newInterval, run_now: newInterval > 0 },
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
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <label className="field" style={{ flex: 1 }}>
              Link Google Sheets (Bagikan → &quot;Siapa saja yang memiliki link&quot;) atau URL Web App Apps Script
              <input
                className="input"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/1abc.../edit"
              />
            </label>
            <label className="field" style={{ width: 160 }}>
              Nama Sheet / Tab
              <input
                className="input"
                value={sheetName}
                onChange={(e) => setSheetName(e.target.value)}
                placeholder="Jadwal"
              />
            </label>
          </div>
          {isPubLink && (
            <div className="notice warn small">
              ⚠️ Anda menggunakan link <b>/pub (Publikasikan ke web)</b> yang memiliki <b>delay cache 5 menit dari Google</b>. Agar update instan (&lt; 1 detik), salin langsung <b>URL dari address bar Google Sheets</b> (<span className="mono">.../spreadsheets/d/.../edit</span>) dan pastikan tombol <b>Bagikan (Share)</b> disetel ke <b>&quot;Siapa saja yang memiliki link&quot;</b>.
            </div>
          )}
          <div className="row" style={{ background: '#0a1328', padding: '.6rem .8rem', borderRadius: 10, border: '1px solid var(--line)' }}>
            <span className="small" style={{ fontWeight: 700 }}>🔄 Auto-Sync Sheet &quot;{sheetName || 'Jadwal'}&quot;:</span>
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
              {result.dry_run
                ? `Validasi${result.sheet_name ? ` (Sheet "${result.sheet_name}")` : ''}: ${result.valid}/${result.total} baris valid.`
                : `Sinkron selesai${result.sheet_name ? ` dari Sheet "${result.sheet_name}"` : ''}: ${result.created} baru, ${result.updated} diperbarui dari ${result.total} baris.`}
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
  const [datePickerVal, setDatePickerVal] = useState(parseScheduleDateToIso(match.scheduled_date));
  const [scheduledTime, setScheduledTime] = useState(match.scheduled_time || '');
  const [timePickerVal, setTimePickerVal] = useState(parseScheduleTimeToPicker(match.scheduled_time));
  const [courtNumber, setCourtNumber] = useState(String(match.court_number || 1));
  const [lockAdminOverride, setLockAdminOverride] = useState(true);

  const [scoringMethod, setScoringMethod] = useState(match.rules?.scoring_method || 'rally_point');
  const [scoringType, setScoringType] = useState(match.rules?.scoring_type || 'sets');
  const [winPoint, setWinPoint] = useState(String(match.rules?.win_point ?? 21));
  const [intervalPoint, setIntervalPoint] = useState(String(match.rules?.interval_point ?? 11));

  const [teamA, setTeamA] = useState({
    p1: match.teams?.team_a?.p1 || '',
    p2: match.teams?.team_a?.p2 || '',
    club: match.teams?.team_a?.club || '',
    details: detailsToInput(match.teams?.team_a?.details),
  });
  const [teamB, setTeamB] = useState({
    p1: match.teams?.team_b?.p1 || '',
    p2: match.teams?.team_b?.p2 || '',
    club: match.teams?.team_b?.club || '',
    details: detailsToInput(match.teams?.team_b?.details),
  });

  const [status, setStatus] = useState(sm.status || 'scheduled');
  const [scoreA, setScoreA] = useState(String(st.score?.a ?? 0));
  const [scoreB, setScoreB] = useState(String(st.score?.b ?? 0));
  const [setsA, setSetsA] = useState(String(st.sets?.a ?? 0));
  const [setsB, setSetsB] = useState(String(st.sets?.b ?? 0));
  const [shuttlecockCount, setShuttlecockCount] = useState(String(st.shuttlecock_count ?? 0));
  const [refereeName, setRefereeName] = useState(sm.controller_label || '');
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

  const onPickDate = (iso) => {
    setDatePickerVal(iso);
    if (iso) {
      setScheduledDate(formatIsoToIndonesianDate(iso));
    }
  };

  const onPickTime = (val) => {
    setTimePickerVal(val);
    if (val) {
      setScheduledTime(`${val} WIB`);
    }
  };

  const handleResetOverride = async () => {
    if (
      !window.confirm(
        `Buka kunci auto-sync untuk Match ${match.match_number}?\n\nData match akan kembali mengikuti pembaruan otomatis dari Google Spreadsheet saat sync berikutnya.`
      )
    ) {
      return;
    }
    setBusy(true);
    const r = await api(`/api/matches/${encodeURIComponent(match.match_number)}/reset_override`, {
      method: 'POST',
      pin,
    });
    setBusy(false);
    if (r.ok) {
      notify({ type: 'ok', text: `Kunci edit Match ${match.match_number} dilepas. Kembali mengikuti Google Sheet.` });
      onClose();
    } else {
      setErr(r.error || 'Gagal melepas kunci');
    }
  };

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

    // Dialog konfirmasi simpan edit (Opsi 2)
    const confirmMsg =
      `Konfirmasi Perubahan Match ${match.match_number}:\n\n` +
      `• Lapangan: Lapangan ${courtNumber}\n` +
      `• Tanggal: ${scheduledDate || '-'}\n` +
      `• Jam: ${scheduledTime || '-'}\n` +
      `• Status: ${status}\n\n` +
      (lockAdminOverride
        ? `🔒 Data editan ini akan DIKUNCI dari penimpaan auto-sync Google Spreadsheet sehingga tidak akan hilang saat sync berjalan.\n\nSimpan sekarang?`
        : `⚠️ Kunci dinonaktifkan: Data ini dapat tertimpa kembali oleh Google Spreadsheet.\n\nSimpan sekarang?`);

    if (!window.confirm(confirmMsg)) return;

    setBusy(true);
    setErr(null);
    const body = {
      tournament_name: tournamentName,
      category_name: categoryName,
      discipline,
      scheduled_date: scheduledDate,
      scheduled_time: scheduledTime,
      court_number: parseInt(courtNumber, 10),
      lock_admin_override: lockAdminOverride,
      rules: {
        scoring_method: scoringMethod,
        scoring_type: scoringType,
        win_point: parseInt(winPoint, 10),
        interval_point: parseInt(intervalPoint, 10),
      },
      teams: {
        team_a: { p1: teamA.p1, p2: isDbl ? teamA.p2 : null, club: teamA.club, details: teamA.details },
        team_b: { p1: teamB.p1, p2: isDbl ? teamB.p2 : null, club: teamB.club, details: teamB.details },
      },
      status,
      score: { a: parseInt(scoreA, 10) || 0, b: parseInt(scoreB, 10) || 0 },
      sets: { a: parseInt(setsA, 10) || 0, b: parseInt(setsB, 10) || 0 },
      shuttlecock_count: Math.max(0, parseInt(shuttlecockCount, 10) || 0),
      referee_name: refereeName.trim(),
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
      notify({ type: 'ok', text: `Match ${match.match_number} berhasil diperbarui & dikunci dari auto-sync!` });
      onClose();
    } else {
      setErr(r.error || 'Gagal menyimpan perubahan');
    }
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal col" style={{ width: 'min(940px, 100%)' }} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="row">
          <h2 style={{ margin: 0 }}>✏️ Edit Lengkap Pertandingan · {match.match_number}</h2>
          <StatusBadge match={match} />
          {match.admin_override?.is_edited && (
            <span className="badge gold" title="Data pertandingan ini telah dikunci dari penimpaan auto-sync sheet">
              🔒 DIEDIT PANITIA
            </span>
          )}
          <div className="spacer" />
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Banner Kunci & Perbedaan Sheet jika ada */}
        {match.admin_override?.is_edited && (
          <div className="notice ok small" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
            <span>
              🔒 <b>Data Ini Terkunci:</b> Perubahan yang dilakukan panitia dilindungi dan tidak akan tertimpa saat auto-sync Google Sheets berjalan.
            </span>
            <button
              type="button"
              className="btn btn-sm btn-yellow"
              disabled={busy}
              onClick={handleResetOverride}
              title="Lepas kunci agar data match ini kembali mengikuti Google Spreadsheet"
            >
              ↺ Buka Kunci (Ikuti Sheet)
            </button>
          </div>
        )}

        {match.sheet_diff && (
          <div className="notice warn small">
            ⚠️ <b>Perbedaan Terdeteksi dari Google Sheet:</b>
            {match.sheet_diff.court_number && ` Lapangan Sheet: Lap ${match.sheet_diff.court_number.sheet} (Aplikasi: Lap ${match.sheet_diff.court_number.local}); `}
            {match.sheet_diff.scheduled_time && ` Jam Sheet: ${match.sheet_diff.scheduled_time.sheet} (Aplikasi: ${match.sheet_diff.scheduled_time.local}); `}
            {match.sheet_diff.scheduled_date && ` Tanggal Sheet: ${match.sheet_diff.scheduled_date.sheet} (Aplikasi: ${match.sheet_diff.scheduled_date.local}); `}
            <span className="muted">(Editan panitia di aplikasi tetap aktif karena terkunci).</span>
          </div>
        )}

        {err && <div className="notice error">{err}</div>}

        {/* Section 1: Jadwal, Lapangan & Aturan */}
        <div className="card col" style={{ padding: '.85rem' }}>
          <div className="small" style={{ fontWeight: 800, color: 'var(--gold)' }}>1. JADWAL, LAPANGAN & ATURAN PERTANDINGAN</div>
          <div className="info-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
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

            {/* Input Tanggal dengan Date Picker */}
            <div className="field">
              <span className="row" style={{ justifyContent: 'space-between' }}>
                <span>Tanggal Pertandingan</span>
                <span className="small muted">📅 Date Picker</span>
              </span>
              <div className="row" style={{ gap: '.35rem' }}>
                <input
                  type="date"
                  className="input"
                  style={{ width: 140, cursor: 'pointer' }}
                  value={datePickerVal}
                  onChange={(e) => onPickDate(e.target.value)}
                  title="Pilih tanggal dari kalender"
                />
                <input
                  className="input"
                  style={{ flex: 1 }}
                  value={scheduledDate}
                  placeholder="Sabtu / 7 November 2026"
                  onChange={(e) => {
                    setScheduledDate(e.target.value);
                    const iso = parseScheduleDateToIso(e.target.value);
                    if (iso) setDatePickerVal(iso);
                  }}
                  title="Format teks tanggal (bisa diketik bebas atau dipilih dari kalender)"
                />
              </div>
              {datePickerVal && (
                <div className="row" style={{ gap: '.3rem', marginTop: '.2rem' }}>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    style={{ fontSize: '.72rem', padding: '.1rem .4rem' }}
                    onClick={() => setScheduledDate(formatIsoToIndonesianDate(datePickerVal))}
                  >
                    Format Hari: {formatIsoToIndonesianDate(datePickerVal)}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    style={{ fontSize: '.72rem', padding: '.1rem .4rem' }}
                    onClick={() => setScheduledDate(datePickerVal)}
                  >
                    Format ISO: {datePickerVal}
                  </button>
                </div>
              )}
            </div>

            {/* Input Jam dengan Time Picker */}
            <div className="field">
              <span className="row" style={{ justifyContent: 'space-between' }}>
                <span>Jam Pertandingan</span>
                <span className="small muted">🕒 Time Picker</span>
              </span>
              <div className="row" style={{ gap: '.35rem' }}>
                <input
                  type="time"
                  className="input"
                  style={{ width: 110, cursor: 'pointer' }}
                  value={timePickerVal}
                  onChange={(e) => onPickTime(e.target.value)}
                  title="Pilih jam pertandingan"
                />
                <input
                  className="input"
                  style={{ flex: 1 }}
                  value={scheduledTime}
                  placeholder="14:30 WIB"
                  onChange={(e) => {
                    setScheduledTime(e.target.value);
                    const p = parseScheduleTimeToPicker(e.target.value);
                    if (p) setTimePickerVal(p);
                  }}
                  title="Format jam pertandingan"
                />
              </div>
            </div>

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
            <label className="field">
              Seeded / Detail Tim A (team_a_detail)
              <input
                className="input"
                value={teamA.details}
                placeholder="Contoh: 1, [3/4], atau Seed 2"
                onChange={(e) => setTeamA({ ...teamA, details: e.target.value })}
              />
            </label>
          </div>

          <div className="card col" style={{ padding: '.85rem' }}>
            <div className="small" style={{ fontWeight: 800, color: '#fca5a5' }}>2B. TIM B (PEMAIN, CLUB & SEEDED)</div>
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
            <label className="field">
              Seeded / Detail Tim B (team_b_detail)
              <input
                className="input"
                value={teamB.details}
                placeholder="Contoh: 2, [3/4], atau Seed 1"
                onChange={(e) => setTeamB({ ...teamB, details: e.target.value })}
              />
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
            <label className="field">
              🏸 Jumlah Penggunaan Cock
              <input className="input" type="number" min={0} max={999} value={shuttlecockCount} onChange={(e) => setShuttlecockCount(e.target.value)} />
            </label>
            <label className="field">
              👤 Nama Wasit Bertugas
              <input className="input" value={refereeName} onChange={(e) => setRefereeName(e.target.value)} placeholder="Nama wasit" />
            </label>
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

        {/* Opsi 2: Kunci Auto-Sync Google Sheets */}
        <div className="card col" style={{ padding: '.75rem .9rem', background: '#0a1328', borderColor: lockAdminOverride ? '#22c55e' : 'var(--line)' }}>
          <label className="row small" style={{ cursor: 'pointer', color: 'var(--text)', fontWeight: 700, alignItems: 'flex-start' }}>
            <input
              type="checkbox"
              style={{ marginTop: 3 }}
              checked={lockAdminOverride}
              onChange={(e) => setLockAdminOverride(e.target.checked)}
            />
            <div className="col" style={{ gap: 2 }}>
              <span>🔒 <b>Kunci Data Ini dari Penimpaan Auto-Sync Google Sheets (Opsi 2 - Best Practice)</b></span>
              <span className="muted" style={{ fontWeight: 500 }}>
                Nomor match ini akan memakai data editan panitia dan tidak akan pernah tertimpa/reset saat fitur auto-sync Google Spreadsheet berjalan.
              </span>
            </div>
          </label>
        </div>

        <div className="row">
          <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
            {busy ? 'Menyimpan…' : '💾 Simpan Perubahan (Konfirmasi)'}
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
                <th>Wasit</th>
                <th>Cock</th>
                <th>Aktor</th>
              </tr>
            </thead>
            <tbody>
              {logs?.map((l) => (
                <tr key={l.log_id}>
                  <td className="mono small">{tm(l.timestamp)}</td>
                  <td>
                    <span className={`badge ${l.event_type === 'UNDO' ? 'gold' : l.event_type.startsWith('SIDE_OUT') ? 'blue' : l.event_type.includes('TAKEOVER') ? 'red' : l.event_type.startsWith('SHUTTLECOCK') ? 'cyan' : ''}`}>{l.event_type}</span>
                  </td>
                  <td className="small">{l.details}</td>
                  <td className="small">{l.referee_name || <span className="muted">-</span>}</td>
                  <td className="mono small">{l.shuttlecock_count ?? 0}</td>
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

function CourtGrid({ matches, courtCount, now, onUnlock, onToggleHistory }) {
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
                  <span className="badge gold mono" title="Jumlah Penggunaan Shuttlecock">
                    🏸 {st.shuttlecock_count ?? 0} Cock
                  </span>
                </div>
                <div className="cteam">
                  {teamLabel(m, 'a')}
                  {teamSeedBadge(m, 'a') && <span className="seed-pill">{teamSeedBadge(m, 'a')}</span>}
                </div>
                <div className="cteam">
                  {teamLabel(m, 'b')}
                  {teamSeedBadge(m, 'b') && <span className="seed-pill">{teamSeedBadge(m, 'b')}</span>}
                </div>
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
                <div className="row" style={{ gap: '.3rem', marginTop: '.3rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className={`btn btn-sm ${m.live_state?.show_rally_history ? 'btn-yellow' : 'btn-ghost'}`}
                    onClick={() => onToggleHistory?.(m.match_number)}
                    title="Aktifkan / Sembunyikan tampilan 10 servis terakhir pada overlay YouTube Lapangan ini"
                  >
                    📊 Histori OBS: {m.live_state?.show_rally_history ? 'ON' : 'OFF'}
                  </button>
                  {m.session_management.locked && (
                    <button className="btn btn-sm btn-red" onClick={() => onUnlock(m.match_number)}>
                      Lepas Kunci
                    </button>
                  )}
                </div>
                {extraActive > 0 && <div className="small" style={{ color: '#fbbf24' }}>⚠ {extraActive} match aktif lain di lapangan ini</div>}
              </>
            ) : (
              <div className="small muted" style={{ flex: 1 }}>
                {next ? (
                  <>
                    Berikutnya: <b style={{ color: 'var(--text)' }}>{next.match_number}</b> {[next.scheduled_date, next.scheduled_time].filter(Boolean).join(' ')}
                    <br />
                    {teamLabel(next, 'a')}
                    {teamSeedBadge(next, 'a') && <span className="seed-pill">{teamSeedBadge(next, 'a')}</span>} vs {teamLabel(next, 'b')}
                    {teamSeedBadge(next, 'b') && <span className="seed-pill">{teamSeedBadge(next, 'b')}</span>}
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

const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const cmpStr = (a, b) => naturalCollator.compare(String(a || ''), String(b || ''));

function parseScheduleMins(s) {
  const m = String(s || '').match(/(\d{1,2})[:.](\d{2})/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 99999;
}

const STATUS_SORT_ORDER = {
  in_progress: 1,
  locked: 2,
  scheduled: 3,
  finished: 4,
};

const SORT_OPTIONS = [
  ['category', 'Kategori & Disiplin'],
  ['time', 'Jam Pertandingan'],
  ['court', 'Nomor Lapangan'],
  ['match', 'Nomor Match'],
  ['status', 'Status Pertandingan'],
  ['date', 'Tanggal Pertandingan'],
  ['teams', 'Nama Pemain / Tim'],
  ['rules', 'Aturan Skor'],
  ['score', 'Skor Pertandingan'],
  ['duration', 'Durasi Pertandingan'],
  ['shuttlecock', 'Penggunaan Cock'],
  ['controller', 'Pengontrol / Wasit'],
];

const SORT_LABELS = Object.fromEntries(SORT_OPTIONS);

function compareByCol(col, x, y, now) {
  switch (col) {
    case 'match':
      return cmpStr(x.match_number, y.match_number);
    case 'category':
      return cmpStr(x.category_name, y.category_name) || cmpStr(x.discipline, y.discipline);
    case 'teams':
      return cmpStr(teamLabel(x, 'a'), teamLabel(y, 'a')) || cmpStr(teamLabel(x, 'b'), teamLabel(y, 'b'));
    case 'rules':
      return (
        cmpStr(x.rules.scoring_method, y.rules.scoring_method) ||
        cmpStr(x.rules.scoring_type, y.rules.scoring_type) ||
        x.rules.win_point - y.rules.win_point
      );
    case 'date': {
      const dx = parseScheduleDateValue(x.scheduled_date);
      const dy = parseScheduleDateValue(y.scheduled_date);
      return dx - dy || cmpStr(x.scheduled_date || '', y.scheduled_date || '');
    }
    case 'court':
      return x.court_number - y.court_number;
    case 'time':
      return parseScheduleMins(x.scheduled_time) - parseScheduleMins(y.scheduled_time);
    case 'status':
      return (
        (STATUS_SORT_ORDER[x.session_management.status] || 99) -
        (STATUS_SORT_ORDER[y.session_management.status] || 99)
      );
    case 'score': {
      const sx = x.live_state.sets.a + x.live_state.sets.b + (x.live_state.score.a + x.live_state.score.b) / 1000;
      const sy = y.live_state.sets.a + y.live_state.sets.b + (y.live_state.score.a + y.live_state.score.b) / 1000;
      return sx - sy;
    }
    case 'duration': {
      const dx = matchDurationSec(x, now) ?? -1;
      const dy = matchDurationSec(y, now) ?? -1;
      return dx - dy;
    }
    case 'shuttlecock': {
      return (x.live_state?.shuttlecock_count ?? 0) - (y.live_state?.shuttlecock_count ?? 0);
    }
    case 'controller': {
      const cx = x.session_management.controller_label || x.session_management.controller_tag || 'zzzz';
      const cy = y.session_management.controller_label || y.session_management.controller_tag || 'zzzz';
      return cmpStr(cx, cy);
    }
    default:
      return 0;
  }
}

function MatchTable({ matches, pin, courtCount, now, onEdit, onLogs, notify }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [court, setCourt] = useState('');
  const [category, setCategory] = useState('');
  // Multi-sort criteria: array of { col, dir: 'asc' | 'desc' }
  const [sorts, setSorts] = useState([]);
  const [addSortCol, setAddSortCol] = useState('');

  const categories = useMemo(() => {
    const set = new Set();
    for (const m of matches) {
      if (m.category_name) set.add(m.category_name);
    }
    return Array.from(set).sort(cmpStr);
  }, [matches]);

  // Clicking a column header adds it to the multi-sort chain, or cycles asc -> desc -> remove if already in chain
  const toggleSort = (col) => {
    setSorts((prev) => {
      const idx = prev.findIndex((s) => s.col === col);
      if (idx === -1) {
        return [...prev, { col, dir: 'asc' }];
      }
      const cur = prev[idx];
      if (cur.dir === 'asc') {
        const next = [...prev];
        next[idx] = { ...cur, dir: 'desc' };
        return next;
      }
      return prev.filter((_, i) => i !== idx);
    });
  };

  const addSortCriterion = (col) => {
    if (!col) return;
    setSorts((prev) => {
      if (prev.some((s) => s.col === col)) return prev;
      return [...prev, { col, dir: 'asc' }];
    });
    setAddSortCol('');
  };

  const flipSortAt = (idx) => {
    setSorts((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' } : s))
    );
  };

  const removeSortAt = (idx) => {
    setSorts((prev) => prev.filter((_, i) => i !== idx));
  };

  const sortIndicator = (col) => {
    const idx = sorts.findIndex((s) => s.col === col);
    if (idx === -1) return <span className="sort-ind idle">⇅</span>;
    const item = sorts[idx];
    return (
      <span className="sort-ind active">
        {sorts.length > 1 ? `${idx + 1}` : ''}
        {item.dir === 'asc' ? '▲' : '▼'}
      </span>
    );
  };

  const filtered = useMemo(() => {
    const list = matches.filter((m) => {
      if (status && m.session_management.status !== status) return false;
      if (court && m.court_number !== Number(court)) return false;
      if (category && m.category_name !== category) return false;
      if (q) {
        const hay = `${m.match_number} ${m.category_name} ${m.discipline} ${teamLabel(m, 'a')} ${teamLabel(m, 'b')} ${m.teams.team_a.club} ${m.teams.team_b.club} ${teamSeedBadge(m, 'a') || ''} ${teamSeedBadge(m, 'b') || ''}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });

    return [...list].sort((x, y) => {
      for (const { col, dir } of sorts) {
        const res = compareByCol(col, x, y, now);
        if (res !== 0) return dir === 'desc' ? -res : res;
      }
      // Fallback tie-breaker (Default: Court -> Date -> Time -> Match Number)
      return (
        x.court_number - y.court_number ||
        parseScheduleDateValue(x.scheduled_date) - parseScheduleDateValue(y.scheduled_date) ||
        parseScheduleMins(x.scheduled_time) - parseScheduleMins(y.scheduled_time) ||
        cmpStr(x.match_number, y.match_number)
      );
    });
  }, [matches, status, court, category, q, sorts, now]);

  const call = async (path, method = 'POST', body, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    const r = await api(path, { method, pin, body });
    notify(r.ok ? { type: 'ok', text: 'Berhasil' } : { type: 'error', text: r.error });
  };
  const enc = encodeURIComponent;
  const availableSortOptions = SORT_OPTIONS.filter(([val]) => !sorts.some((s) => s.col === val));

  return (
    <div className="card col">
      <div className="row">
        <h3 style={{ margin: 0 }}>📋 Daftar & Laporan Pertandingan ({filtered.length}/{matches.length})</h3>
        <div className="spacer" />
        <input className="input" style={{ width: 200 }} placeholder="Cari match / pemain / club" value={q} onChange={(e) => setQ(e.target.value)} />
        {categories.length > 0 && (
          <select className="input" style={{ width: 155 }} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Semua kategori</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        )}
        <select className="input" style={{ width: 140 }} value={status} onChange={(e) => setStatus(e.target.value)}>
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

      {/* Multi-Sort Builder Bar */}
      <div className="multi-sort-bar">
        <span className="multi-sort-label">⇅ Urutan Multi-Sort:</span>
        {sorts.length === 0 ? (
          <span className="muted small">Default (Lapangan → Jam → Nomor Match) — Klik judul kolom tabel atau pilih di samping untuk menyusun urutan bertingkat</span>
        ) : (
          <div className="multi-sort-chips">
            {sorts.map((s, idx) => (
              <React.Fragment key={s.col}>
                {idx > 0 && <span className="multi-sort-arrow">→</span>}
                <div className="multi-sort-chip">
                  <span className="multi-sort-num">{idx + 1}</span>
                  <span className="multi-sort-name">{SORT_LABELS[s.col] || s.col}</span>
                  <button
                    type="button"
                    className="multi-sort-dir"
                    onClick={() => flipSortAt(idx)}
                    title={s.dir === 'asc' ? 'Ascending (A-Z / Kecil ke Besar) — Klik untuk balik' : 'Descending (Z-A / Besar ke Kecil) — Klik untuk balik'}
                  >
                    {s.dir === 'asc' ? '▲ Asc' : '▼ Desc'}
                  </button>
                  <button
                    type="button"
                    className="multi-sort-del"
                    onClick={() => removeSortAt(idx)}
                    title="Hapus urutan ini"
                  >
                    ✕
                  </button>
                </div>
              </React.Fragment>
            ))}
          </div>
        )}
        <div className="spacer" />
        {availableSortOptions.length > 0 && (
          <select
            className="input"
            style={{ width: 195, padding: '.38rem .6rem', fontSize: '.85rem' }}
            value={addSortCol}
            onChange={(e) => addSortCriterion(e.target.value)}
          >
            <option value="">+ Tambah Urutan Kolom...</option>
            {availableSortOptions.map(([val, lbl]) => (
              <option key={val} value={val}>
                + {lbl}
              </option>
            ))}
          </select>
        )}
        {sorts.length > 0 && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => setSorts([])}
            title="Kembalikan ke urutan Default"
          >
            ↺ Reset Urutan
          </button>
        )}
      </div>

      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th className="sortable-th" onClick={() => toggleSort('match')} title="Klik untuk menambah/mengubah urutan Nomor Match">
                Match {sortIndicator('match')}
              </th>
              <th className="sortable-th" onClick={() => toggleSort('category')} title="Klik untuk menambah/mengubah urutan Kategori & Disiplin">
                Kategori {sortIndicator('category')}
              </th>
              <th className="sortable-th" onClick={() => toggleSort('teams')} title="Klik untuk menambah/mengubah urutan Nama Pemain">
                Tim A vs Tim B {sortIndicator('teams')}
              </th>
              <th className="sortable-th" onClick={() => toggleSort('rules')} title="Klik untuk menambah/mengubah urutan Aturan Skor">
                Aturan {sortIndicator('rules')}
              </th>
              <th className="sortable-th" onClick={() => toggleSort('date')} title="Klik untuk menambah/mengubah urutan Tanggal">
                Tanggal {sortIndicator('date')}
              </th>
              <th className="sortable-th" onClick={() => toggleSort('court')} title="Klik untuk menambah/mengubah urutan Nomor Lapangan">
                Lap. {sortIndicator('court')}
              </th>
              <th className="sortable-th" onClick={() => toggleSort('time')} title="Klik untuk menambah/mengubah urutan Jam Pertandingan">
                Jam {sortIndicator('time')}
              </th>
              <th className="sortable-th" onClick={() => toggleSort('status')} title="Klik untuk menambah/mengubah urutan Status Pertandingan">
                Status {sortIndicator('status')}
              </th>
              <th className="sortable-th" onClick={() => toggleSort('score')} title="Klik untuk menambah/mengubah urutan Skor">
                Skor {sortIndicator('score')}
              </th>
              <th className="sortable-th" onClick={() => toggleSort('duration')} title="Klik untuk menambah/mengubah urutan Durasi">
                Durasi {sortIndicator('duration')}
              </th>
              <th className="sortable-th" onClick={() => toggleSort('shuttlecock')} title="Klik untuk menambah/mengubah urutan Penggunaan Shuttlecock">
                Cock {sortIndicator('shuttlecock')}
              </th>
              <th className="sortable-th" onClick={() => toggleSort('controller')} title="Klik untuk menambah/mengubah urutan Pengontrol / Wasit">
                Wasit / Pengontrol {sortIndicator('controller')}
              </th>
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
                    {teamLabel(m, 'a')}
                    {teamSeedBadge(m, 'a') && <span className="seed-pill">{teamSeedBadge(m, 'a')}</span>}{' '}
                    <span className="muted">({m.teams.team_a.club || '-'})</span>
                    <br />
                    {teamLabel(m, 'b')}
                    {teamSeedBadge(m, 'b') && <span className="seed-pill">{teamSeedBadge(m, 'b')}</span>}{' '}
                    <span className="muted">({m.teams.team_b.club || '-'})</span>
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
                  <td className="mono small">
                    {(st.shuttlecock_count ?? 0) > 0 || sm.status !== 'scheduled' ? (
                      <span className="badge gold" title="Jumlah penggunaan shuttlecock">
                        🏸 {st.shuttlecock_count ?? 0}
                      </span>
                    ) : (
                      <span className="muted">-</span>
                    )}
                  </td>
                  <td className="small">
                    {sm.locked ? (
                      `🔒 ${sm.controller_label || `…${sm.controller_tag}`}`
                    ) : sm.controller_label ? (
                      <span>👤 {sm.controller_label}</span>
                    ) : (
                      <span className="muted">-</span>
                    )}
                  </td>
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

function ExportCard({ pin, exporter, setExporter, notify }) {
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [testMsg, setTestMsg] = useState(null);
  const [showScriptModal, setShowScriptModal] = useState(false);
  const [scriptText, setScriptText] = useState('');

  useEffect(() => {
    if (exporter?.webhook_url !== undefined) {
      setWebhookUrl(exporter.webhook_url || '');
      setTestMsg(null);
    }
  }, [exporter?.webhook_url]);

  const openScriptModal = async () => {
    setShowScriptModal(true);
    if (!scriptText) {
      try {
        const res = await fetch('/api/export/google-apps-script.gs');
        const txt = await res.text();
        setScriptText(txt);
      } catch {
        setScriptText('// Gagal memuat kode dari server');
      }
    }
  };

  const copyScript = async () => {
    try {
      let txt = scriptText;
      if (!txt) {
        const res = await fetch('/api/export/google-apps-script.gs');
        txt = await res.text();
        setScriptText(txt);
      }
      await navigator.clipboard.writeText(txt);
      notify({ type: 'ok', text: '📋 Kode Google Apps Script terbaru berhasil disalin! Silakan Paste ke editor Apps Script & Deploy versi baru.' });
    } catch {
      openScriptModal();
    }
  };

  const saveWebhook = async (withTest = false) => {
    setBusy(true);
    setTestMsg(null);
    const r = await api('/api/admin/export/config', {
      method: 'POST',
      pin,
      body: {
        webhook_url: webhookUrl.trim(),
        webhook_secret: webhookSecret.trim() || undefined,
        test: withTest,
      },
    });
    setBusy(false);
    if (r.exporter) setExporter(r.exporter);
    if (r.ok) {
      const msg = withTest
        ? `✅ Koneksi Webhook Berhasil! ${r.test?.message || 'Siap mengunggah hasil & log ke Google Sheets.'}`
        : '✅ Konfigurasi Webhook Google Sheets disimpan.';
      setTestMsg({ type: 'ok', text: msg });
      notify({ type: 'ok', text: msg });
    } else {
      setTestMsg({ type: 'error', text: r.error || 'Gagal menghubungi Webhook Google Sheets' });
    }
  };

  return (
    <div className="card col">
      <h3 style={{ margin: 0 }}>📤 Ekspor & Sinkronisasi Hasil</h3>
      <div className="row">
        <a className="btn" href="/api/export/results.csv">
          ⬇ Hasil (CSV)
        </a>
        <a className="btn" href="/api/export/logs.csv">
          ⬇ Semua Log (CSV)
        </a>
        <button type="button" className="btn btn-yellow" onClick={openScriptModal} title="Lihat & salin kode terbaru Google Apps Script (mendukung kolom referee_name & shuttlecock_count)">
          📜 Kode Google Apps Script Terbaru
        </button>
      </div>

      {/* Konfigurasi Langsung Webhook Google Apps Script */}
      <div className="col" style={{ background: '#0a1328', padding: '.7rem .85rem', borderRadius: 10, border: '1px solid var(--line)' }}>
        <label className="field">
          URL Web App Google Apps Script (otomatis mengisi tab &quot;Results&quot; &amp; &quot;Logs&quot; di Google Sheets)
          <input
            className="input"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://script.google.com/macros/s/AKfycb.../exec"
          />
        </label>
        <div className="row">
          <button
            className="btn btn-sm btn-primary"
            disabled={busy}
            onClick={() => saveWebhook(true)}
          >
            {busy ? 'Menguji…' : '💾 Simpan & 🧪 Tes Koneksi Webhook'}
          </button>
          <button
            className="btn btn-sm"
            disabled={busy}
            onClick={() => saveWebhook(false)}
          >
            Simpan Saja
          </button>
          <input
            className="input"
            style={{ width: 170, padding: '.3rem .55rem', fontSize: '.8rem' }}
            placeholder="Secret (opsional)"
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
          />
        </div>
        {testMsg && <div className={`notice ${testMsg.type} small`}>{testMsg.text}</div>}
      </div>

      <div className="info-grid">
        <div>
          <div className="k">Google Sheets Webhook</div>
          <div className="v">{exporter?.webhook_configured ? '✅ Aktif' : '— Lokal saja'}</div>
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
          ⟳ Coba Kirim Ulang ({exporter?.queue_length ?? 0})
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
        Hasil match berstatus <b>finished</b> otomatis ditulis ke <span className="mono">exports/</span> dan dikirim ke Google Sheets tab <b>Results</b> &amp; <b>Logs</b> (termasuk kolom <b>referee_name</b> &amp; <b>shuttlecock_count</b>).
      </p>

      {showScriptModal && (
        <div className="modal-bg" onClick={() => setShowScriptModal(false)}>
          <div className="modal col" style={{ width: 'min(920px, 100%)' }} onClick={(e) => e.stopPropagation()}>
            <div className="row">
              <h2 style={{ margin: 0 }}>📜 Kode Google Apps Script Terbaru (Results &amp; Logs + Wasit &amp; Cock)</h2>
              <div className="spacer" />
              <button type="button" className="btn btn-sm btn-green" onClick={copyScript}>
                📋 Salin Seluruh Kode
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowScriptModal(false)}>
                ✕
              </button>
            </div>
            <div className="notice warn small">
              <b>⚠️ PENTING — Cara Update di Google Spreadsheet agar Kolom Baru Muncul:</b>
              <ol style={{ margin: '.35rem 0 0 1.2rem', padding: 0 }}>
                <li>Buka Google Spreadsheet Anda → klik menu <b>Extensions (Ekstensi) → Apps Script</b>.</li>
                <li>Hapus seluruh kode lama, lalu <b>Paste (Tempel)</b> kode terbaru di bawah ini dan tekan <b>Ctrl+S (Simpan)</b>.</li>
                <li>
                  Klik tombol biru <b>Deploy (Terapkan)</b> di kanan atas → pilih <b>Manage deployments (Kelola deployment)</b> → klik ikon <b>Pensil (Edit)</b> → pada bagian <b>Version (Versi)</b> pilih <b>&quot;New version (Versi baru)&quot;</b> → klik <b>Deploy</b>.
                  <br />
                  <span className="muted">(Atau pilih <b>Deploy → New deployment</b> lalu salin Web App URL barunya ke SmashPoint). Tanpa membuat <b>New version</b>, Google Apps Script akan tetap menjalankan kode versi lama!</span>
                </li>
              </ol>
            </div>
            <textarea
              className="input mono"
              style={{ fontSize: '.78rem', lineHeight: 1.45, minHeight: 360 }}
              readOnly
              value={scriptText}
              onClick={(e) => e.target.select()}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function UserManagementPanel({ token, currentUser, onUserUpdated, notify }) {
  const isSuper = currentUser?.role === 'super_admin';
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);

  // Own profile / password state
  const [myDisplayName, setMyDisplayName] = useState(currentUser?.display_name || '');
  const [curPwd, setCurPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [busySelf, setBusySelf] = useState(false);

  // Super Admin: create new user state
  const [newUsername, setNewUsername] = useState('');
  const [newDisplay, setNewDisplay] = useState('');
  const [newUserPwd, setNewUserPwd] = useState('');
  const [newRole, setNewRole] = useState('admin');
  const [busyCreate, setBusyCreate] = useState(false);

  // Super Admin: reset password inline modal/state
  const [resetTarget, setResetTarget] = useState(null);
  const [resetPwd, setResetPwd] = useState('');

  const loadUsers = useCallback(async () => {
    if (!isSuper) return;
    setLoading(true);
    const r = await api('/api/admin/users', { pin: token });
    setLoading(false);
    if (r.ok && r.users) setUsers(r.users);
  }, [isSuper, token]);

  useEffect(() => {
    setMyDisplayName(currentUser?.display_name || '');
  }, [currentUser?.display_name]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleSelfPassword = async (e) => {
    e.preventDefault();
    if (newPwd !== confirmPwd) {
      notify({ type: 'error', text: 'Konfirmasi password baru tidak cocok' });
      return;
    }
    setBusySelf(true);
    const r = await api('/api/admin/me/password', {
      method: 'POST',
      pin: token,
      body: {
        current_password: curPwd,
        new_password: newPwd,
        display_name: myDisplayName,
      },
    });
    setBusySelf(false);
    if (r.ok) {
      setCurPwd('');
      setNewPwd('');
      setConfirmPwd('');
      if (r.user) onUserUpdated?.(r.user);
      loadUsers();
      notify({ type: 'ok', text: 'Password & profil Anda berhasil diperbarui' });
    } else {
      notify({ type: 'error', text: r.error || 'Gagal mengubah password' });
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setBusyCreate(true);
    const r = await api('/api/admin/users', {
      method: 'POST',
      pin: token,
      body: {
        username: newUsername.trim(),
        display_name: newDisplay.trim() || newUsername.trim(),
        password: newUserPwd,
        role: newRole,
      },
    });
    setBusyCreate(false);
    if (r.ok) {
      setNewUsername('');
      setNewDisplay('');
      setNewUserPwd('');
      setNewRole('admin');
      if (r.users) setUsers(r.users);
      notify({ type: 'ok', text: `User admin "${r.user?.username}" berhasil dibuat` });
    } else {
      notify({ type: 'error', text: r.error || 'Gagal membuat user' });
    }
  };

  const handleUpdateUser = async (uname, patch, msg) => {
    const r = await api(`/api/admin/users/${encodeURIComponent(uname)}`, {
      method: 'PATCH',
      pin: token,
      body: patch,
    });
    if (r.ok) {
      if (r.users) setUsers(r.users);
      if (uname === currentUser?.username && r.user) onUserUpdated?.(r.user);
      notify({ type: 'ok', text: msg || `User "${uname}" diperbarui` });
      return true;
    }
    notify({ type: 'error', text: r.error || 'Gagal memperbarui user' });
    return false;
  };

  const handleDeleteUser = async (uname) => {
    if (!window.confirm(`Hapus permanen akun admin "${uname}"?`)) return;
    const r = await api(`/api/admin/users/${encodeURIComponent(uname)}`, {
      method: 'DELETE',
      pin: token,
    });
    if (r.ok) {
      if (r.users) setUsers(r.users);
      notify({ type: 'ok', text: `Akun "${uname}" dihapus` });
    } else {
      notify({ type: 'error', text: r.error || 'Gagal menghapus user' });
    }
  };

  return (
    <div className="col" style={{ gap: '1rem' }}>
      {/* Card 1: Current User Profile & Change Own Password (Available to ALL Admin levels) */}
      <div className="card col">
        <div className="row">
          <h3 style={{ margin: 0 }}>🔑 Profil &amp; Ubah Password Saya</h3>
          <span className={`badge ${isSuper ? 'gold' : 'blue'}`}>
            {isSuper ? '👑 Super Admin (Akses Penuh + Kelola User)' : '🛡️ Admin Operasional (Kelola Pertandingan)'}
          </span>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          Anda login sebagai <b>{currentUser?.display_name}</b> (<span className="mono">@{currentUser?.username}</span>).{' '}
          {isSuper
            ? 'Sebagai Super Admin, Anda memiliki hak penuh untuk mengendalikan aplikasi sekaligus membuat atau mengatur akun Admin lainnya di bawah.'
            : 'Sebagai Admin Operasional, Anda dapat mengendalikan penuh jalannya pertandingan & jadwal aplikasi, serta mengubah password akun Anda sendiri.'}
        </p>
        <form className="col" onSubmit={handleSelfPassword} style={{ maxWidth: 560, marginTop: '.4rem' }}>
          <div className="row">
            <label className="field" style={{ flex: 1 }}>
              Nama Tampilan
              <input
                className="input"
                value={myDisplayName}
                onChange={(e) => setMyDisplayName(e.target.value)}
                placeholder="Nama lengkap / jabatan"
              />
            </label>
            <label className="field" style={{ flex: 1 }}>
              Password Saat Ini
              <input
                className="input"
                type="password"
                value={curPwd}
                onChange={(e) => setCurPwd(e.target.value)}
                placeholder="Wajib diisi"
              />
            </label>
          </div>
          <div className="row">
            <label className="field" style={{ flex: 1 }}>
              Password Baru (min. 4 karakter)
              <input
                className="input"
                type="password"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                placeholder="Password baru"
              />
            </label>
            <label className="field" style={{ flex: 1 }}>
              Konfirmasi Password Baru
              <input
                className="input"
                type="password"
                value={confirmPwd}
                onChange={(e) => setConfirmPwd(e.target.value)}
                placeholder="Ulangi password baru"
              />
            </label>
          </div>
          <div>
            <button className="btn btn-primary" disabled={!curPwd || !newPwd || !confirmPwd || busySelf}>
              {busySelf ? 'Menyimpan…' : '💾 Simpan Password Baru'}
            </button>
          </div>
        </form>
      </div>

      {/* Card 2: Super Admin Only — Manage Admin Users */}
      {isSuper ? (
        <div className="setup-grid" style={{ gridTemplateColumns: 'minmax(300px, 420px) 1fr' }}>
          <form className="card col" onSubmit={handleCreateUser}>
            <h3 style={{ margin: 0 }}>➕ Tambah Akun Admin Baru</h3>
            <p className="muted small" style={{ margin: 0 }}>
              Buat akun untuk panitia lain. Pilih level <b>Admin Operasional</b> jika hanya boleh mengelola jadwal &amp; skor tanpa bisa mengubah daftar user.
            </p>
            <label className="field">
              Username Login (huruf/angka tanpa spasi)
              <input
                className="input mono"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))}
                placeholder="contoh: panitia_lapangan"
              />
            </label>
            <label className="field">
              Nama Lengkap / Jabatan
              <input
                className="input"
                value={newDisplay}
                onChange={(e) => setNewDisplay(e.target.value)}
                placeholder="contoh: Koordinator Pertandingan"
              />
            </label>
            <label className="field">
              Password Awal (min. 4 karakter)
              <input
                className="input"
                type="password"
                value={newUserPwd}
                onChange={(e) => setNewUserPwd(e.target.value)}
                placeholder="Minimal 4 karakter"
              />
            </label>
            <label className="field">
              Level Hak Akses (Role)
              <select className="input" value={newRole} onChange={(e) => setNewRole(e.target.value)}>
                <option value="admin">🛡️ Admin Operasional (Kelola Aplikasi, Tanpa Kelola User)</option>
                <option value="super_admin">👑 Super Admin (Akses Penuh + Kelola Semua User)</option>
              </select>
            </label>
            <button
              className="btn btn-green"
              disabled={!newUsername.trim() || newUserPwd.length < 4 || busyCreate}
            >
              {busyCreate ? 'Membuat…' : '➕ Buat Akun Admin'}
            </button>
          </form>

          <div className="card col">
            <div className="row">
              <h3 style={{ margin: 0 }}>👥 Daftar Akun Admin ({users.length})</h3>
              <div className="spacer" />
              <button type="button" className="btn btn-sm" onClick={loadUsers} disabled={loading}>
                ⟳ Muat Ulang
              </button>
            </div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Nama Tampilan</th>
                    <th>Level / Role</th>
                    <th>Status</th>
                    <th>Login Terakhir</th>
                    <th>Aksi Super Admin</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const isMe = u.username === currentUser?.username;
                    return (
                      <tr key={u.username}>
                        <td className="mono">
                          <b>@{u.username}</b> {isMe && <span className="badge green">Anda</span>}
                        </td>
                        <td>{u.display_name}</td>
                        <td>
                          <select
                            className="inline-input"
                            style={{ width: '11.5rem' }}
                            value={u.role}
                            onChange={(e) =>
                              handleUpdateUser(u.username, { role: e.target.value }, `Level @${u.username} diubah`)
                            }
                          >
                            <option value="super_admin">👑 Super Admin</option>
                            <option value="admin">🛡️ Admin Operasional</option>
                          </select>
                        </td>
                        <td>
                          <span className={`badge ${u.active ? 'green' : 'red'}`}>
                            {u.active ? 'Aktif' : 'Nonaktif'}
                          </span>
                        </td>
                        <td className="small muted">
                          {u.last_login ? new Date(u.last_login).toLocaleString('id-ID') : 'Belum pernah'}
                        </td>
                        <td>
                          <div className="row" style={{ gap: '.3rem' }}>
                            <button
                              type="button"
                              className="btn btn-sm btn-yellow"
                              onClick={() => {
                                setResetTarget(u.username);
                                setResetPwd('');
                              }}
                            >
                              🔑 Reset Password
                            </button>
                            {!isMe && (
                              <>
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  onClick={() =>
                                    handleUpdateUser(
                                      u.username,
                                      { active: !u.active },
                                      `Status @${u.username} ${!u.active ? 'diaktifkan' : 'dinonaktifkan'}`
                                    )
                                  }
                                >
                                  {u.active ? 'Nonaktifkan' : 'Aktifkan'}
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-red"
                                  onClick={() => handleDeleteUser(u.username)}
                                >
                                  🗑 Hapus
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {resetTarget && (
              <div className="row" style={{ background: '#0a1328', padding: '.75rem 1rem', borderRadius: 10, border: '1px solid var(--gold)' }}>
                <span className="small">
                  Reset Password untuk <b>@{resetTarget}</b>:
                </span>
                <input
                  className="input"
                  style={{ width: 200 }}
                  type="password"
                  placeholder="Password baru (min 4)"
                  value={resetPwd}
                  onChange={(e) => setResetPwd(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-sm btn-green"
                  disabled={resetPwd.length < 4}
                  onClick={async () => {
                    const ok = await handleUpdateUser(
                      resetTarget,
                      { password: resetPwd },
                      `Password @${resetTarget} berhasil direset`
                    );
                    if (ok) {
                      setResetTarget(null);
                      setResetPwd('');
                    }
                  }}
                >
                  ✔ Simpan Password
                </button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setResetTarget(null)}>
                  Batal
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="notice info">
          ℹ️ Pengelolaan daftar pengguna (membuat, mengubah role, atau menghapus akun admin lain) hanya tersedia untuk akun berlevel <b>Super Admin</b>.
        </div>
      )}
    </div>
  );
}

function TournamentProfileBar({ token, activeProfile, profiles = [], onSwitched, notify }) {
  const [expanded, setExpanded] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [activateOnCreate, setActivateOnCreate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');

  const handleSwitch = async (id) => {
    if (!id || id === activeProfile?.id) return;
    const target = profiles.find((p) => p.id === id);
    if (
      !window.confirm(
        `Pindah ke Profil Turnamen "${target?.name || id}"?\n\nSeluruh progres pertandingan di profil "${activeProfile?.name || 'saat ini'}" akan disimpan (auto-saved) dengan aman dan dapat dilanjutkan kembali kapan saja.`
      )
    ) {
      return;
    }
    setBusy(true);
    const r = await api(`/api/admin/profiles/${encodeURIComponent(id)}/activate`, {
      method: 'POST',
      pin: token,
    });
    setBusy(false);
    if (r.ok) {
      onSwitched?.(r);
      notify({
        type: 'ok',
        text: `📂 Berhasil memuat Profil Turnamen "${r.active_profile?.name}". Progres profil sebelumnya tersimpan aman.`,
      });
    } else {
      notify({ type: 'error', text: r.error || 'Gagal berpindah profil turnamen' });
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    const r = await api('/api/admin/profiles', {
      method: 'POST',
      pin: token,
      body: {
        name: newName.trim(),
        description: newDesc.trim(),
        activate: activateOnCreate,
      },
    });
    setBusy(false);
    if (r.ok) {
      setNewName('');
      setNewDesc('');
      onSwitched?.(r);
      notify({
        type: 'ok',
        text: activateOnCreate
          ? `✅ Profil Turnamen "${r.profile?.name}" dibuat dan langsung diaktifkan!`
          : `✅ Profil Turnamen "${r.profile?.name}" berhasil dibuat.`,
      });
    } else {
      notify({ type: 'error', text: r.error || 'Gagal membuat profil turnamen' });
    }
  };

  const handleSaveEdit = async (id) => {
    if (!editName.trim()) return;
    setBusy(true);
    const r = await api(`/api/admin/profiles/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      pin: token,
      body: { name: editName.trim(), description: editDesc.trim() },
    });
    setBusy(false);
    if (r.ok) {
      setEditingId(null);
      onSwitched?.(r);
      notify({ type: 'ok', text: 'Profil turnamen diperbarui' });
    } else {
      notify({ type: 'error', text: r.error || 'Gagal mengubah profil' });
    }
  };

  const handleDelete = async (p) => {
    if (
      !window.confirm(
        `Hapus permanen profil turnamen "${p.name}" (${p.stats?.total || 0} pertandingan)?\nTindakan ini tidak dapat dibatalkan.`
      )
    ) {
      return;
    }
    setBusy(true);
    const r = await api(`/api/admin/profiles/${encodeURIComponent(p.id)}`, {
      method: 'DELETE',
      pin: token,
    });
    setBusy(false);
    if (r.ok) {
      onSwitched?.(r);
      notify({ type: 'ok', text: `Profil "${p.name}" dihapus` });
    } else {
      notify({ type: 'error', text: r.error || 'Gagal menghapus profil' });
    }
  };

  return (
    <div className="card col" style={{ borderColor: 'rgba(250, 204, 21, 0.45)', background: 'linear-gradient(180deg, #132247 0%, #0b152c 100%)' }}>
      <div className="row">
        <div className="row" style={{ gap: '.55rem' }}>
          <span className="badge gold" style={{ fontSize: '.82rem', padding: '.28rem .7rem' }}>
            🏆 PROFIL TURNAMEN AKTIF
          </span>
          <strong style={{ fontSize: '1.15rem', color: '#fff' }}>
            {activeProfile?.name || 'Turnamen Utama'}
          </strong>
          {activeProfile?.description && (
            <span className="small muted">({activeProfile.description})</span>
          )}
        </div>

        <div className="spacer" />

        {/* Quick Switcher Dropdown */}
        <div className="row" style={{ gap: '.45rem' }}>
          <span className="small muted" style={{ fontWeight: 700 }}>Pindah Profil (Auto-Save):</span>
          <select
            className="input"
            style={{ width: 250, padding: '.4rem .7rem', fontWeight: 700, borderColor: 'var(--gold)' }}
            value={activeProfile?.id || ''}
            disabled={busy}
            onChange={(e) => handleSwitch(e.target.value)}
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.active ? '● ' : '○ '}
                {p.name} ({p.stats?.finished || 0}/{p.stats?.total || 0} selesai)
              </option>
            ))}
          </select>
          <button
            type="button"
            className={`btn btn-sm ${expanded ? 'btn-primary' : 'btn-yellow'}`}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? '▲ Tutup Kelola Profil' : `📂 Kelola / Buat Profil Turnamen (${profiles.length})`}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="setup-grid" style={{ marginTop: '.5rem', paddingTop: '.75rem', borderTop: '1px solid var(--line)', gridTemplateColumns: 'minmax(290px, 380px) 1fr' }}>
          {/* Create New Tournament Profile Form (Available to all Admin levels) */}
          <form className="col" onSubmit={handleCreate} style={{ background: '#0a1328', padding: '.85rem', borderRadius: 12, border: '1px solid var(--line)' }}>
            <h4 style={{ margin: 0, color: 'var(--gold)' }}>➕ Buat Profil Turnamen Baru</h4>
            <p className="muted small" style={{ margin: 0 }}>
              Cocok jika terdapat beberapa turnamen berbeda di hari yang sama (Pagi / Siang / Malam). Progres setiap turnamen tersimpan terpisah.
            </p>
            <label className="field">
              Nama Profil Turnamen *
              <input
                className="input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Contoh: Turnamen B - Sesi Siang"
                maxLength={80}
              />
            </label>
            <label className="field">
              Keterangan / Jadwal Sesi (Opsional)
              <input
                className="input"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Contoh: 7-12 Nov · Sesi 13:00 - 18:00 WIB"
                maxLength={160}
              />
            </label>
            <label className="row small" style={{ cursor: 'pointer', color: 'var(--text)' }}>
              <input
                type="checkbox"
                checked={activateOnCreate}
                onChange={(e) => setActivateOnCreate(e.target.checked)}
              />
              Langsung aktifkan profil ini setelah dibuat
            </label>
            <button className="btn btn-green" disabled={!newName.trim() || busy}>
              {busy ? 'Menyimpan…' : '➕ Buat & Simpan Profil Turnamen'}
            </button>
          </form>

          {/* Saved Tournament Profiles List */}
          <div className="col" style={{ gap: '.5rem' }}>
            <div className="small muted" style={{ fontWeight: 700 }}>
              📚 Daftar Profil Turnamen Tersimpan ({profiles.length}) — Klik &quot;Muat / Aktifkan&quot; untuk melanjutkan progres:
            </div>
            <div className="col" style={{ maxHeight: 280, overflow: 'auto', gap: '.45rem' }}>
              {profiles.map((p) => {
                const isEditing = editingId === p.id;
                return (
                  <div
                    key={p.id}
                    className="row"
                    style={{
                      padding: '.65rem .85rem',
                      borderRadius: 10,
                      background: p.active ? 'rgba(34, 197, 94, 0.12)' : '#0a1328',
                      border: `1px solid ${p.active ? '#22c55e' : 'var(--line)'}`,
                    }}
                  >
                    {isEditing ? (
                      <div className="row" style={{ flex: 1, gap: '.4rem' }}>
                        <input
                          className="input"
                          style={{ flex: 1 }}
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          placeholder="Nama Profil"
                        />
                        <input
                          className="input"
                          style={{ flex: 1 }}
                          value={editDesc}
                          onChange={(e) => setEditDesc(e.target.value)}
                          placeholder="Keterangan"
                        />
                        <button type="button" className="btn btn-sm btn-green" onClick={() => handleSaveEdit(p.id)}>
                          ✔ Simpan
                        </button>
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditingId(null)}>
                          Batal
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="col" style={{ gap: '.15rem', flex: 1, minWidth: 200 }}>
                          <div className="row" style={{ gap: '.45rem' }}>
                            <strong style={{ fontSize: '1rem', color: p.active ? '#4ade80' : 'var(--text)' }}>
                              {p.name}
                            </strong>
                            {p.active && <span className="badge green">● SEDANG AKTIF</span>}
                            {p.description && <span className="small muted">· {p.description}</span>}
                          </div>
                          <div className="row small muted" style={{ gap: '.6rem' }}>
                            <span>Total: <b>{p.stats?.total || 0}</b> match</span>
                            <span>Live: <b>{p.stats?.live || 0}</b></span>
                            <span>Setup: <b>{p.stats?.setup || 0}</b></span>
                            <span>Selesai: <b>{p.stats?.finished || 0}</b></span>
                            <span>Dibuat oleh: @{p.created_by}</span>
                          </div>
                        </div>
                        <div className="row" style={{ gap: '.35rem' }}>
                          {!p.active && (
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              disabled={busy}
                              onClick={() => handleSwitch(p.id)}
                            >
                              📂 Muat / Aktifkan
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => {
                              setEditingId(p.id);
                              setEditName(p.name);
                              setEditDesc(p.description || '');
                            }}
                          >
                            ✏️ Ubah Nama
                          </button>
                          {!p.active && profiles.length > 1 && (
                            <button
                              type="button"
                              className="btn btn-sm btn-red"
                              disabled={busy}
                              onClick={() => handleDelete(p)}
                            >
                              🗑
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Grouped Match Board (`Papan Jadwal & Progres`) for quick visual scanning.
 * Groups all matches (finished, live/setup, upcoming) into clean, straight-aligned
 * cards based on the admin's chosen criterion:
 *  - 'court': Per-Lapangan (Court 1, Court 2, ...)
 *  - 'category': Per-Kategori & Disiplin
 *  - 'date': Per-Tanggal Pertandingan (sorted chronologically)
 *  - 'discipline': Per-Disiplin (MS, WS, MD, WD, XD)
 *  - 'status': Per-Status Pertandingan (Live, Setup, Terjadwal, Selesai)
 */
function GroupedMatchBoard({ matches, now, onEdit, onLogs }) {
  const [groupBy, setGroupBy] = useState('court'); // 'court' | 'category' | 'date' | 'discipline' | 'status'
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'active_upcoming' | 'in_progress' | 'scheduled' | 'finished'
  const [cols, setCols] = useState(2); // 1 | 2 | 3 | 4 columns of cards
  const [q, setQ] = useState('');

  const filteredMatches = useMemo(() => {
    return matches.filter((m) => {
      const st = m.session_management?.status || 'scheduled';
      if (statusFilter === 'active_upcoming' && st === 'finished') return false;
      if (statusFilter === 'in_progress' && st !== 'in_progress' && st !== 'locked') return false;
      if (statusFilter === 'scheduled' && st !== 'scheduled') return false;
      if (statusFilter === 'finished' && st !== 'finished') return false;
      if (q.trim()) {
        const hay = `${m.match_number} ${m.category_name} ${m.discipline} ${m.scheduled_date || ''} ${m.scheduled_time || ''} ${teamLabel(m, 'a')} ${teamLabel(m, 'b')} ${m.teams.team_a.club || ''} ${m.teams.team_b.club || ''} ${teamSeedBadge(m, 'a') || ''} ${teamSeedBadge(m, 'b') || ''}`.toLowerCase();
        if (!hay.includes(q.trim().toLowerCase())) return false;
      }
      return true;
    });
  }, [matches, statusFilter, q]);

  const groups = useMemo(() => {
    const map = new Map();

    const add = (key, title, subtitle, sortOrder, m) => {
      if (!map.has(key)) {
        map.set(key, { key, title, subtitle, sortOrder, list: [] });
      }
      map.get(key).list.push(m);
    };

    for (const m of filteredMatches) {
      if (groupBy === 'court') {
        const c = m.court_number || 0;
        add(`court-${c}`, `Lapangan ${c}`, `Court ${c}`, c, m);
      } else if (groupBy === 'category') {
        const cat = (m.category_name || 'Tanpa Kategori').trim();
        const disc = m.discipline || '';
        const key = `${cat}||${disc}`;
        add(
          key,
          cat,
          disc ? `${disc} · ${DISCIPLINE_LABEL[disc] || disc}` : '',
          0,
          m
        );
      } else if (groupBy === 'date') {
        const dRaw = (m.scheduled_date || '').trim() || 'Tanpa Tanggal';
        const dVal = parseScheduleDateValue(dRaw);
        add(dRaw, dRaw, 'Jadwal Harian', dVal, m);
      } else if (groupBy === 'discipline') {
        const disc = m.discipline || '-';
        add(
          disc,
          `${disc} — ${DISCIPLINE_LABEL[disc] || disc}`,
          'Disiplin Pertandingan',
          DISCIPLINES.indexOf(disc) >= 0 ? DISCIPLINES.indexOf(disc) : 99,
          m
        );
      } else if (groupBy === 'status') {
        const st = m.session_management?.status || 'scheduled';
        const labelMap = {
          in_progress: ['Sedang Berlangsung (LIVE)', 'Pertandingan aktif di lapangan', 1],
          locked: ['Persiapan / Setup Wasit', 'Wasit sedang undian & posisi', 2],
          scheduled: ['Akan Datang (Terjadwal)', 'Menunggu giliran bermain', 3],
          finished: ['Sudah Selesai (Finished)', 'Pertandingan telah berakhir', 4],
        };
        const [title, sub, ord] = labelMap[st] || [st, '', 99];
        add(st, title, sub, ord, m);
      }
    }

    // Sort matches inside each card in logical chronological / queue order:
    // Date -> Time -> Court -> Natural Match Number
    const result = Array.from(map.values());
    for (const g of result) {
      g.list.sort((x, y) => {
        return (
          parseScheduleDateValue(x.scheduled_date) - parseScheduleDateValue(y.scheduled_date) ||
          parseScheduleMins(x.scheduled_time) - parseScheduleMins(y.scheduled_time) ||
          x.court_number - y.court_number ||
          cmpStr(x.match_number, y.match_number)
        );
      });
      g.stats = {
        total: g.list.length,
        live: g.list.filter((m) => m.session_management?.status === 'in_progress').length,
        setup: g.list.filter((m) => m.session_management?.status === 'locked').length,
        scheduled: g.list.filter((m) => m.session_management?.status === 'scheduled').length,
        finished: g.list.filter((m) => m.session_management?.status === 'finished').length,
      };
    }

    // Sort cards themselves
    result.sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return cmpStr(a.title, b.title) || cmpStr(a.subtitle, b.subtitle);
    });

    return result;
  }, [filteredMatches, groupBy]);

  const formatScoreCompact = (m) => {
    const st = m.live_state;
    const sm = m.session_management;
    if (sm.status === 'scheduled') {
      return { main: '— : —', sub: m.rules.scoring_type === 'sets' ? 'Best of 3' : `Target ${m.rules.win_point}`, isLive: false };
    }
    const isSets = m.rules.scoring_type === 'sets';
    const historyStr = st.set_history?.length
      ? st.set_history.map((s) => `${s.a}-${s.b}`).join(', ')
      : '';
    if (sm.status === 'finished' || st.phase === 'finished') {
      return {
        main: historyStr || `${st.score.a} - ${st.score.b}`,
        sub: isSets && st.set_history?.length > 1 ? `Set ${st.sets.a}-${st.sets.b}` : 'Final',
        isLive: false,
      };
    }
    return {
      main: `${st.score.a} - ${st.score.b}`,
      sub: historyStr ? `(${historyStr})` : isSets ? `Set ${st.current_set}` : 'Live',
      isLive: true,
    };
  };

  // Dynamic column layout based on current grouping
  const showCategory = groupBy !== 'category' && groupBy !== 'discipline';
  const showDate = groupBy !== 'date';
  const showCourt = groupBy !== 'court';
  const showStatus = groupBy !== 'status';

  const gridColumns = [
    '88px', // Col 1: Match No & Override Tag
    showCategory ? '120px' : null, // Col 2: Kategori
    showDate ? '135px' : null, // Col 3: Hari/Tanggal
    '75px', // Col 4: Jam
    showCourt ? '76px' : null, // Col 5: Lapangan
    'minmax(180px, 1fr)', // Col 6: Tim A vs Tim B
    '115px', // Col 7: Skor
    showStatus ? '95px' : null, // Col 8: Status
    '50px', // Col 9: Aksi (Edit / Log)
  ].filter(Boolean).join(' ');

  return (
    <div className="col" style={{ gap: '.9rem' }}>
      {/* Control Toolbar */}
      <div className="card gb-toolbar">
        <div className="gb-toolbar-group">
          <span className="gb-toolbar-label">🗂️ Susun Kartu Berdasarkan:</span>
          <div className="gb-pill-group">
            {[
              ['court', '🏟️ Per-Lapangan'],
              ['category', '🏅 Per-Kategori'],
              ['date', '📅 Per-Tanggal'],
              ['discipline', '🏸 Per-Disiplin'],
              ['status', '📊 Per-Status'],
            ].map(([val, lbl]) => (
              <button
                key={val}
                type="button"
                className={`gb-pill-btn ${groupBy === val ? 'active' : ''}`}
                onClick={() => setGroupBy(val)}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        <div className="gb-toolbar-group">
          <span className="gb-toolbar-label">🔍 Tampilkan Status:</span>
          <div className="gb-pill-group">
            {[
              ['all', `Semua (${matches.length})`],
              ['active_upcoming', 'Belum Selesai'],
              ['in_progress', 'Sedang Main (Live)'],
              ['scheduled', 'Akan Datang'],
              ['finished', 'Sudah Selesai'],
            ].map(([val, lbl]) => (
              <button
                key={val}
                type="button"
                className={`gb-pill-btn ${statusFilter === val ? 'active' : ''}`}
                onClick={() => setStatusFilter(val)}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        <div className="gb-toolbar-group" style={{ marginLeft: 'auto' }}>
          <input
            className="input"
            style={{ width: 210, padding: '.4rem .7rem', fontSize: '.88rem' }}
            placeholder="Cari nomor / pemain / klub…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="gb-pill-group" title="Jumlah kolom kartu per baris">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                type="button"
                className={`gb-pill-btn ${cols === n ? 'active' : ''}`}
                onClick={() => setCols(n)}
              >
                {n} Kolom
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Cards Grid */}
      {groups.length === 0 ? (
        <div className="card muted" style={{ textAlign: 'center', padding: '2.5rem' }}>
          Tidak ada data pertandingan yang sesuai dengan filter saat ini.
        </div>
      ) : (
        <div className={`gb-cards-grid cols-${cols}`}>
          {groups.map((g) => {
            const pct = g.stats.total > 0 ? Math.round((g.stats.finished / g.stats.total) * 100) : 0;
            return (
              <section key={g.key} className={`gb-card ${g.stats.live > 0 ? 'has-live' : ''}`}>
                {/* Card Header */}
                <header className="gb-card-header">
                  <div className="gb-card-title-wrap">
                    <h3 className="gb-card-title">{g.title}</h3>
                    {g.subtitle && <span className="gb-card-subtitle">{g.subtitle}</span>}
                  </div>
                  <div className="gb-card-badges">
                    {g.stats.live > 0 && <span className="badge green">● {g.stats.live} Live</span>}
                    {g.stats.setup > 0 && <span className="badge blue">{g.stats.setup} Setup</span>}
                    {g.stats.scheduled > 0 && <span className="badge">{g.stats.scheduled} Antre</span>}
                    <span className="badge gold">
                      {g.stats.finished}/{g.stats.total} Selesai ({pct}%)
                    </span>
                  </div>
                </header>

                {/* Thin Progress Bar */}
                <div className="gb-progress-track">
                  <div className="gb-progress-fill" style={{ width: `${pct}%` }} />
                </div>

                {/* Column Header Legend for Straight Visual Alignment */}
                <div className="gb-row gb-row-head" style={{ gridTemplateColumns: gridColumns }}>
                  <div>NO. MATCH</div>
                  {showCategory && <div>KATEGORI</div>}
                  {showDate && <div>HARI / TANGGAL</div>}
                  <div>JAM</div>
                  {showCourt && <div style={{ textAlign: 'center' }}>LAPANGAN</div>}
                  <div>PEMAIN / TIM</div>
                  <div style={{ textAlign: 'center' }}>SKOR</div>
                  {showStatus && <div style={{ textAlign: 'center' }}>STATUS</div>}
                  <div style={{ textAlign: 'right' }}>AKSI</div>
                </div>

                {/* Straight-Aligned Match Rows */}
                <div className="gb-rows-wrap">
                  {g.list.map((m) => {
                    const sm = m.session_management;
                    const st = m.live_state;
                    const isFinished = sm.status === 'finished' || st.phase === 'finished';
                    const isLive = sm.status === 'in_progress';
                    const isSetup = sm.status === 'locked';
                    const winSide = isFinished ? st.winner : null;
                    const seedA = teamSeedBadge(m, 'a');
                    const seedB = teamSeedBadge(m, 'b');
                    const sc = formatScoreCompact(m);
                    const dur = matchDurationText(m, now);

                    return (
                      <div
                        key={m.match_number}
                        className={`gb-row ${isLive ? 'row-live' : isSetup ? 'row-setup' : isFinished ? 'row-finished' : 'row-scheduled'}`}
                        style={{ gridTemplateColumns: gridColumns }}
                        onClick={() => onEdit?.(m)}
                        title="Klik untuk mengedit / melihat detail pertandingan ini"
                      >
                        {/* Col 1: Match Number & Lock/Override Indicator */}
                        <div className="gb-col-no">
                          <span className="gb-match-no">{m.match_number}</span>
                          {m.admin_override?.is_edited && (
                            <span
                              className="gb-override-tag"
                              title={`Manual edit oleh ${m.admin_override?.edited_by || 'admin'}. Terkunci dari auto-sync Sheet.`}
                            >
                              🔒 EDIT
                            </span>
                          )}
                        </div>

                        {/* Col 2: Kategori (dihilangkan jika groupBy === 'category' atau 'discipline') */}
                        {showCategory && (
                          <div className="gb-col-cat" title={`${m.category_name || '-'} (${m.discipline || '-'})`}>
                            <div style={{ fontWeight: 700, color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {m.category_name || '-'}
                            </div>
                            <div style={{ fontSize: '.68rem', color: 'var(--muted)' }}>
                              {m.discipline ? `${m.discipline} · ${DISCIPLINE_LABEL[m.discipline] || m.discipline}` : ''}
                            </div>
                          </div>
                        )}

                        {/* Col 3: Hari & Tanggal (dihilangkan jika groupBy === 'date') */}
                        {showDate && (
                          <div className="gb-col-date" title={m.scheduled_date || '-'}>
                            {m.scheduled_date || '-'}
                          </div>
                        )}

                        {/* Col 4: Jam */}
                        <div className="gb-col-time" title={m.scheduled_time || '-'}>
                          {m.scheduled_time || '-'}
                        </div>

                        {/* Col 5: Nomor Lapangan (dihilangkan jika groupBy === 'court') */}
                        {showCourt && (
                          <div className="gb-col-court" style={{ textAlign: 'center' }}>
                            <span className="gb-court-tag">Lap. {m.court_number || '-'}</span>
                          </div>
                        )}

                        {/* Col 6: Teams (Strictly aligned 2-line or straight horizontal pairing) */}
                        <div className="gb-col-teams">
                          <div className={`gb-team-line ${winSide === 'a' ? 'is-winner' : winSide === 'b' ? 'is-loser' : ''}`}>
                            <span className="gb-team-name">
                              {winSide === 'a' && '🏆 '}
                              {teamLabel(m, 'a')}
                            </span>
                            {seedA && <span className="seed-pill">{seedA}</span>}
                            {m.teams.team_a.club && <span className="gb-team-club">({m.teams.team_a.club})</span>}
                          </div>
                          <div className={`gb-team-line ${winSide === 'b' ? 'is-winner' : winSide === 'a' ? 'is-loser' : ''}`}>
                            <span className="gb-team-name">
                              {winSide === 'b' && '🏆 '}
                              {teamLabel(m, 'b')}
                            </span>
                            {seedB && <span className="seed-pill">{seedB}</span>}
                            {m.teams.team_b.club && <span className="gb-team-club">({m.teams.team_b.club})</span>}
                          </div>
                        </div>

                        {/* Col 7: Score, Duration & Shuttlecock Count */}
                        <div className="gb-col-score mono">
                          <div className={`gb-score-main ${sc.isLive ? 'live' : isFinished ? 'done' : 'idle'}`}>
                            {sc.main}
                          </div>
                          <div className="gb-score-sub">
                            {sc.sub}
                            {dur ? ` · ⏱${dur}` : ''}
                            {(st.shuttlecock_count ?? 0) > 0 ? ` · 🏸${st.shuttlecock_count}` : ''}
                          </div>
                        </div>

                        {/* Col 8: Status Badge (dihilangkan jika groupBy === 'status') */}
                        {showStatus && (
                          <div className="gb-col-status">
                            <StatusBadge match={m} />
                          </div>
                        )}

                        {/* Col 9: Aksi Cepat Edit & Log */}
                        <div className="gb-col-actions" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className="gb-action-btn"
                            onClick={() => onEdit?.(m)}
                            title="Edit Pertandingan"
                          >
                            ✏️
                          </button>
                          <button
                            type="button"
                            className="gb-action-btn"
                            onClick={() => onLogs?.(m.match_number)}
                            title="Riwayat Log Poin"
                          >
                            📜
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function AdminPage() {
  const [token, setToken] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard' | 'users'
  const [activeProfile, setActiveProfile] = useState(null);
  const [profiles, setProfiles] = useState([]);
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
    const savedTok = sessionStorage.getItem('sp_admin_token') || sessionStorage.getItem('sp_admin_pin');
    const savedUsr = sessionStorage.getItem('sp_admin_user');
    if (savedTok) setToken(savedTok);
    if (savedUsr) {
      try {
        setCurrentUser(JSON.parse(savedUsr));
      } catch { /* ignore */ }
    }
    api('/api/config').then((c) => c.court_count && setCourtCount(c.court_count));
  }, []);

  useEffect(() => {
    if (!token) return undefined;
    const s = getSocket();
    const sub = async () => {
      setConnected(true);
      const r = await emitAck('admin:watch', { token, pin: token });
      if (r.ok) {
        setMatches(r.matches);
        setExporter(r.exporter);
        if (r.sync) setSync(r.sync);
        if (r.active_profile) setActiveProfile(r.active_profile);
        if (r.profiles) setProfiles(r.profiles);
        if (r.user) {
          setCurrentUser(r.user);
          sessionStorage.setItem('sp_admin_user', JSON.stringify(r.user));
        }
      } else if (r.reason === 'bad_pin') {
        sessionStorage.removeItem('sp_admin_token');
        sessionStorage.removeItem('sp_admin_pin');
        sessionStorage.removeItem('sp_admin_user');
        setToken(null);
        setCurrentUser(null);
      }
    };
    const onState = (d) => {
      setMatches(d.matches);
      setExporter(d.exporter);
      if (d.sync) setSync(d.sync);
      if (d.active_profile) setActiveProfile(d.active_profile);
      if (d.profiles) setProfiles(d.profiles);
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
  }, [token]);

  const notify = useCallback((n) => {
    setNotice(n);
    setTimeout(() => setNotice((x) => (x === n ? null : x)), 4000);
  }, []);

  const applyProfileResponse = (r) => {
    if (r.active_profile) setActiveProfile(r.active_profile);
    if (r.profiles) setProfiles(r.profiles);
    if (r.matches) setMatches(r.matches);
    if (r.exporter) setExporter(r.exporter);
    if (r.sync) setSync(r.sync);
  };

  if (!token) {
    return (
      <LoginGate
        onOk={(tok, usr) => {
          setToken(tok);
          setCurrentUser(usr);
        }}
      />
    );
  }

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
        <div className="tabs" style={{ marginLeft: '1rem' }}>
          <button
            type="button"
            className={`btn btn-sm ${activeTab === 'dashboard' ? 'btn-primary' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            🏟️ Pengendalian Pertandingan
          </button>
          <button
            type="button"
            className={`btn btn-sm ${activeTab === 'board' ? 'btn-primary' : ''}`}
            onClick={() => setActiveTab('board')}
          >
            🗂️ Papan Jadwal &amp; Progres
          </button>
          <button
            type="button"
            className={`btn btn-sm ${activeTab === 'users' ? 'btn-primary' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            👥 Manajemen User &amp; Password ({currentUser?.role === 'super_admin' ? 'Super Admin' : 'Akun Saya'})
          </button>
        </div>
        <div className="spacer" />
        <Link href="/livescore" className="btn btn-sm btn-blue" target="_blank" title="Buka Tampilan Multi-Court LiveScore Venue/GOR">
          🏟️ Layar LiveScore Venue
        </Link>
        <span className="badge">Total {stats.total}</span>
        <span className="badge blue">Setup {stats.setup}</span>
        <span className="badge green">Live {stats.live}</span>
        <span className="badge gold">Selesai {stats.finished}</span>
        {currentUser && (
          <span className={`badge ${currentUser.role === 'super_admin' ? 'gold' : 'cyan'}`} title={currentUser.role_label}>
            {currentUser.role === 'super_admin' ? '👑' : '🛡️'} {currentUser.display_name || currentUser.username}
          </span>
        )}
        <span className="row small" style={{ gap: '.4rem' }}>
          <span className={`dot ${connected ? 'on' : ''}`} /> {connected ? 'Real-time' : 'Terputus'}
        </span>
        <button
          className="btn btn-sm btn-ghost"
          onClick={async () => {
            await api('/api/admin/logout', { method: 'POST', pin: token });
            sessionStorage.removeItem('sp_admin_token');
            sessionStorage.removeItem('sp_admin_pin');
            sessionStorage.removeItem('sp_admin_user');
            setToken(null);
            setCurrentUser(null);
          }}
        >
          Keluar
        </button>
      </div>
      {notice && <div className={`notice ${notice.type}`}>{notice.text}</div>}

      {/* Multi-Tournament Profile Switcher & Manager (Available to ALL Admin levels) */}
      <TournamentProfileBar
        token={token}
        activeProfile={activeProfile}
        profiles={profiles}
        onSwitched={applyProfileResponse}
        notify={notify}
      />

      {activeTab === 'users' ? (
        <UserManagementPanel
          token={token}
          currentUser={currentUser}
          onUserUpdated={(u) => {
            setCurrentUser(u);
            sessionStorage.setItem('sp_admin_user', JSON.stringify(u));
          }}
          notify={notify}
        />
      ) : activeTab === 'board' ? (
        <GroupedMatchBoard matches={matches} now={now} onEdit={setEditMatch} onLogs={setLogsFor} />
      ) : (
        <>
          <CourtGrid
            matches={matches}
            courtCount={courtCount}
            now={now}
            onUnlock={async (id) => {
              if (!window.confirm(`Lepas paksa kunci sesi ${id}? Perangkat wasit akan dialihkan ke mode pantau.`)) return;
              const r = await api(`/api/matches/${encodeURIComponent(id)}/unlock`, { method: 'POST', pin: token });
              notify(r.ok ? { type: 'ok', text: `Kunci ${id} dilepas` } : { type: 'error', text: r.error });
            }}
            onToggleHistory={async (id) => {
              const r = await api(`/api/matches/${encodeURIComponent(id)}/toggle_history`, { method: 'POST', pin: token });
              if (r.ok) {
                const isNow = r.match?.live_state?.show_rally_history;
                notify({ type: 'ok', text: `Histori reli OBS ${id}: ${isNow ? 'TAMPIL (ON)' : 'SEMBUNYI (OFF)'}` });
              } else {
                notify({ type: 'error', text: r.error });
              }
            }}
          />

          <div className="setup-grid">
            <ImportPanel pin={token} sync={sync} onSyncChange={setSync} onDone={() => notify({ type: 'ok', text: 'Import selesai' })} />
            <ExportCard pin={token} exporter={exporter} setExporter={setExporter} notify={notify} />
          </div>

          <MatchTable matches={matches} pin={token} courtCount={courtCount} now={now} onEdit={setEditMatch} onLogs={setLogsFor} notify={notify} />
        </>
      )}

      {editMatch && (
        <EditMatchModal
          match={matches.find((x) => x.match_number === editMatch.match_number) || editMatch}
          pin={token}
          courtCount={courtCount}
          onClose={() => setEditMatch(null)}
          notify={notify}
        />
      )}
      {logsFor && <LogsModal id={logsFor} onClose={() => setLogsFor(null)} />}
    </main>
  );
}
