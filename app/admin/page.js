'use client';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import CourtMap from '@/components/CourtMap';
import { Shuttle, Target } from '@/components/Icons';
import { api, emitAck, getSocket, lsGet, lsSet, useNow } from '@/lib/client';
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
  formatDuration,
  formatLocalDateTime,
  isDoubles,
  other,
  courtPositions,
  playerName,
  teamLabel,
  teamSeedBadge,
} from '@/lib/engine';
import { StatusBadge } from '@/components/referee/Entry';
import RallyHistoryStrip from '@/components/RallyHistoryStrip';

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
                : `Sinkron selesai${result.sheet_name ? ` dari Sheet "${result.sheet_name}"` : ''}: ${result.created} baru, ${result.updated} diperbarui dari ${result.total} baris.${
                    (result.restored_from_state || 0) + (result.restored_from_results || 0) > 0
                      ? ` 🔄 Progres dipulihkan: ${result.restored_from_state || 0} dari Cloud State & ${result.restored_from_results || 0} dari sheet Results!`
                      : ''
                  }`}
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
                    <span className={`badge ${l.event_type === 'UNDO' || l.event_type === 'YELLOW_CARD' ? 'gold' : l.event_type.startsWith('SIDE_OUT') ? 'blue' : l.event_type.includes('TAKEOVER') || l.event_type === 'RED_CARD' || l.event_type === 'BLACK_CARD' ? 'red' : l.event_type.startsWith('SHUTTLECOCK') ? 'cyan' : ''}`}>{l.event_type}</span>
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

/**
 * FinishedMatchDetailModal
 * Popup elegan & profesional ketika Admin mengklik pertandingan yang sudah selesai.
 * Menampilkan ringkasan eksekutif pertandingan, perbandingan pemenang vs lawan,
 * statistik poin & reli, kartu pelanggaran BWF (Kuning/Merah/Hitam), serta
 * seluruh histori reli pertandingan tersebut dari awal sampai akhir dalam multi-baris.
 */
function FinishedMatchDetailModal({ match, now, onClose, onEdit, onLogs }) {
  const [matchBiTheme, setMatchBiTheme] = useState('dark'); // 'dark' | 'paper'
  const [perRow, setPerRow] = useState(25);

  useEffect(() => {
    document.body.classList.add('fm-detail-open');
    return () => document.body.classList.remove('fm-detail-open', 'fm-paper-print');
  }, []);

  useEffect(() => {
    document.body.classList.toggle('fm-paper-print', matchBiTheme === 'paper');
  }, [matchBiTheme]);

  const st = match.live_state || {};
  const sm = match.session_management || {};
  const isSets = match.rules?.scoring_type === 'sets';
  const winSide = st.winner || (st.score?.a >= st.score?.b ? 'a' : 'b');
  const loseSide = winSide === 'a' ? 'b' : 'a';
  const duration = matchDurationText(match, now);
  const rallies = Array.isArray(st.rally_history) ? st.rally_history : [];
  const cards = Array.isArray(st.cards) ? st.cards : [];
  const setHist = Array.isArray(st.set_history) && st.set_history.length > 0
    ? st.set_history
    : [{ set: 1, a: st.score?.a || 0, b: st.score?.b || 0, winner: winSide }];

  // Hitung statistik pertandingan mendalam dari set_history & rally_history
  const stats = useMemo(() => {
    const totalPointsA = setHist.reduce((acc, s) => acc + (Number(s.a) || 0), 0);
    const totalPointsB = setHist.reduce((acc, s) => acc + (Number(s.b) || 0), 0);
    const totalPts = totalPointsA + totalPointsB;
    let rWonA = 0;
    let rWonB = 0;
    let srvWonA = 0;
    let srvWonB = 0;
    let rcvWonA = 0; // break / point won when receiving
    let rcvWonB = 0;
    let totalServesA = 0;
    let totalServesB = 0;
    let maxStreakA = 0;
    let maxStreakB = 0;
    let curA = 0;
    let curB = 0;

    for (const r of rallies) {
      if (r.server_side === 'a') totalServesA += 1;
      else if (r.server_side === 'b') totalServesB += 1;

      if (r.winner === 'a') {
        rWonA += 1;
        curA += 1;
        curB = 0;
        if (curA > maxStreakA) maxStreakA = curA;
        if (r.server_side === 'a') srvWonA += 1;
        else rcvWonA += 1;
      } else if (r.winner === 'b') {
        rWonB += 1;
        curB += 1;
        curA = 0;
        if (curB > maxStreakB) maxStreakB = curB;
        if (r.server_side === 'b') srvWonB += 1;
        else rcvWonB += 1;
      }
    }

    const winRateA = rallies.length > 0 ? Math.round((rWonA / rallies.length) * 100) : totalPts > 0 ? Math.round((totalPointsA / totalPts) * 100) : 50;
    const winRateB = rallies.length > 0 ? Math.round((rWonB / rallies.length) * 100) : totalPts > 0 ? Math.round((totalPointsB / totalPts) * 100) : 50;
    const srvHoldPctA = totalServesA > 0 ? Math.round((srvWonA / totalServesA) * 100) : 0;
    const srvHoldPctB = totalServesB > 0 ? Math.round((srvWonB / totalServesB) * 100) : 0;

    return {
      totalPointsA,
      totalPointsB,
      totalPoints: totalPts,
      totalRallies: rallies.length,
      rWonA,
      rWonB,
      winRateA,
      winRateB,
      srvWonA,
      srvWonB,
      rcvWonA,
      rcvWonB,
      srvHoldPctA,
      srvHoldPctB,
      maxStreakA,
      maxStreakB,
    };
  }, [setHist, rallies]);

  const winningTeamName = teamLabel(match, winSide);
  const runnerUpTeamName = teamLabel(match, loseSide);
  const isTeamAWin = winSide === 'a';

  return (
    <div className={`modal-bg md-overlay ${matchBiTheme === 'paper' ? 'md-theme-paper' : 'md-theme-dark'}`} onClick={onClose}>
      <div className="modal col md-shell" style={{ width: 'min(1440px, 98vw)' }} onClick={(e) => e.stopPropagation()}>
        {/* Sticky Executive Toolbar */}
        <div className="md-toolbar tr-no-print">
          <div className="md-toolbar-left">
            <span className="bi-brand-pill">MATCH INTELLIGENCE</span>
            <span className="badge blue mono" style={{ fontWeight: 800 }}>{match.match_number}</span>
            <span className="badge">Lapangan {match.court_number}</span>
            <span className={`badge ${isTeamAWin ? 'bi-win-badge-a' : 'bi-win-badge-b'}`}>
              🏆 {isTeamAWin ? 'Tim A Menang' : 'Tim B Menang'}
            </span>
            {match.admin_override?.is_edited && <span className="badge gold">🔒 Manual Edit</span>}
          </div>
          <div className="md-toolbar-actions">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setMatchBiTheme((t) => (t === 'dark' ? 'paper' : 'dark'))}
              title="Ganti tema tampilan gelap vs kertas putih (siap cetak)"
            >
              {matchBiTheme === 'dark' ? '☀️ Executive Paper' : '🌙 Executive Dark'}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-yellow"
              onClick={() => {
                onClose();
                onEdit?.(match);
              }}
              title="Buka editor lengkap untuk koreksi skor, pemain, atau status laga"
            >
              ✏️ Edit Laga
            </button>
            <button
              type="button"
              className="btn btn-sm btn-blue"
              onClick={() => onLogs?.(match.match_number)}
              title="Audit trail lengkap seluruh reli, perubahan skor, wasit, dan kartu"
            >
              📜 Audit Log
            </button>
            <button
              type="button"
              className="btn btn-sm btn-green"
              onClick={() => window.print()}
              title="Cetak atau simpan laporan eksekutif pertandingan ini sebagai PDF"
            >
              🖨️ Cetak / PDF Laga
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
              ✕ Tutup
            </button>
          </div>
        </div>

        {/* Executive Match Header */}
        <header className="md-header">
          <div className="md-header-main">
            <div className="bi-eyebrow">OFFICIAL MATCH REPORT &amp; PERFORMANCE ANALYTICS</div>
            <h1 className="md-title">
              {match.tournament_name || 'Turnamen Bulutangkis'}
            </h1>
            <div className="md-subtitle">
              <span className="badge blue">{match.discipline}</span> <b>{match.category_name}</b> · {DISCIPLINE_LABEL[match.discipline] || match.discipline}
            </div>
            <p className="md-narrative">
              Pertandingan nomor <b>{match.match_number}</b> di Lapangan <b>{match.court_number}</b> dimenangkan oleh <b className={isTeamAWin ? 'bi-winner-a' : 'bi-winner-b'}>Tim {winSide.toUpperCase()} ({winningTeamName})</b> atas <b>Tim {loseSide.toUpperCase()} ({runnerUpTeamName})</b> dalam waktu efektif <b>{duration || '-'}</b> dengan <b>{stats.totalRallies} reli</b> dan konsumsi <b>{st.shuttlecock_count ?? 0} shuttlecock</b>.
            </p>
          </div>

          <div className="md-meta-box">
            <div className="bi-meta-row">
              <span>Nomor Pertandingan</span>
              <b className="mono">{match.match_number}</b>
            </div>
            <div className="bi-meta-row">
              <span>Lapangan &amp; Jadwal</span>
              <b>Lap. {match.court_number} · {[match.scheduled_date, match.scheduled_time].filter(Boolean).join(' ') || '-'}</b>
            </div>
            <div className="bi-meta-row">
              <span>Wasit Bertugas</span>
              <b>👤 {sm.controller_label || 'Tidak Tercatat'}</b>
            </div>
            <div className="bi-meta-row">
              <span>Waktu Mulai</span>
              <b className="mono">{st.started_at ? formatLocalDateTime(st.started_at) : '-'}</b>
            </div>
            <div className="bi-meta-row">
              <span>Waktu Selesai</span>
              <b className="mono">{formatLocalDateTime(match.finished_at || st.ended_at) || '-'}</b>
            </div>
            <div className="bi-meta-row">
              <span>Status Pelanggaran</span>
              <b>{cards.length > 0 ? `${cards.length} Kartu BWF` : '✔ 100% Fair Play'}</b>
            </div>
          </div>
        </header>

        {/* Dual Team Showdown Banner (Distinct Winner & Colors for Team A vs Team B) */}
        <div className="md-duel-grid">
          {['a', 'b'].map((t) => {
            const isWin = winSide === t;
            const isTeamA = t === 'a';
            const tmObj = match.teams?.[`team_${t}`] || {};
            const seed = teamSeedBadge(match, t);
            const tCards = cards.filter((c) => c.team === t);
            const mainScore = isSets
              ? st.sets?.[t] ?? 0
              : setHist[setHist.length - 1]?.[t] ?? st.score?.[t] ?? 0;
            const teamTotalPts = isTeamA ? stats.totalPointsA : stats.totalPointsB;
            const teamRWon = isTeamA ? stats.rWonA : stats.rWonB;
            const teamWinRate = isTeamA ? stats.winRateA : stats.winRateB;
            const teamMaxStreak = isTeamA ? stats.maxStreakA : stats.maxStreakB;

            return (
              <div
                key={t}
                className={`md-team-card ${isWin ? 'winner' : 'loser'} ${isTeamA ? 'team-a' : 'team-b'} ${isWin ? (isTeamA ? 'win-a' : 'win-b') : ''}`}
              >
                <div className="md-team-top">
                  <div className="row" style={{ gap: '.45rem', flexWrap: 'wrap' }}>
                    <span className={`badge ${isWin ? (isTeamA ? 'bi-win-badge-a' : 'bi-win-badge-b') : ''}`}>
                      {isWin ? '🏆 PEMENANG (WINNER)' : 'RUNNER-UP LAGA'}
                    </span>
                    <span className="badge" style={{ fontWeight: 800 }}>TIM {t.toUpperCase()}</span>
                    {seed && <span className="seed-pill">{seed}</span>}
                    {tCards.map((c) => (
                      <span key={c.card_id} className={`badge ${c.type === 'yellow' ? 'gold' : 'red'}`}>
                        {c.type === 'yellow' ? '🟨 Kuning' : c.type === 'red' ? '🟥 Merah' : '⬛ DSQ'}
                      </span>
                    ))}
                  </div>

                  <div className="md-team-names">{teamLabel(match, t)}</div>
                  <div className="md-club-name">
                    🏛️ {tmObj.club || 'Tanpa Klub / Independen'}
                  </div>

                  {/* Micro stats under team */}
                  <div className="md-team-stats-row mono">
                    <span><b>{teamTotalPts}</b> Total Poin</span>
                    <span>·</span>
                    <span><b>{teamRWon}</b> Reli Dimenangkan ({teamWinRate}%)</span>
                    <span>·</span>
                    <span>🔥 Streak <b>{teamMaxStreak}</b></span>
                  </div>
                </div>

                <div className="md-team-score-box">
                  <div className="md-main-score mono">{mainScore}</div>
                  <div className="md-score-lbl">{isSets ? 'SET MENANG' : 'SKOR AKHIR'}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* 6 Executive KPI Metrics */}
        <section className="bi-kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
          <div className="bi-kpi-card accent-purple">
            <div className="bi-kpi-top">
              <span>DURASI PERMAINAN</span>
              <span className="bi-kpi-pill">Efektif</span>
            </div>
            <div className="bi-kpi-val mono" style={{ color: 'var(--cyan)' }}>{duration || '-'}</div>
            <div className="bi-kpi-sub">
              {st.started_at && st.ended_at ? 'Waktu tercatat otomatis' : 'Durasi total laga'}
            </div>
          </div>

          <div className="bi-kpi-card accent-gold">
            <div className="bi-kpi-top">
              <span>SHUTTLECOCK DIGUNAKAN</span>
              <span className="bi-kpi-pill">Wasit</span>
            </div>
            <div className="bi-kpi-val mono" style={{ color: 'var(--bi-accent-gold)' }}>
              🏸 {st.shuttlecock_count ?? 0} <small>Cock</small>
            </div>
            <div className="bi-kpi-sub">Dikelola oleh wasit utama</div>
          </div>

          <div className="bi-kpi-card accent-cyan">
            <div className="bi-kpi-top">
              <span>TOTAL RELI / RALLY</span>
              <span className="bi-kpi-pill">{stats.totalRallies} Reli</span>
            </div>
            <div className="bi-kpi-val mono">{stats.totalRallies} <small>Bursa Angka</small></div>
            <div className="bi-kpi-sub">{stats.totalPoints} total poin terkumpul</div>
          </div>

          <div className="bi-kpi-card accent-blue">
            <div className="bi-kpi-top">
              <span>DOMINASI SERVIS &amp; BREAK</span>
              <span className="bi-kpi-pill">A vs B</span>
            </div>
            <div className="bi-kpi-val mono" style={{ fontSize: '1.25rem' }}>
              <span className="bi-winner-a">{stats.srvWonA}</span> / <span className="bi-winner-b">{stats.srvWonB}</span> <small>Poin Servis</small>
            </div>
            <div className="bi-kpi-sub">
              Break: Tim A {stats.rcvWonA} · Tim B {stats.rcvWonB}
            </div>
          </div>

          <div className="bi-kpi-card accent-emerald">
            <div className="bi-kpi-top">
              <span>STREAK POIN MAKSIMAL</span>
              <span className="bi-kpi-pill">Beruntun</span>
            </div>
            <div className="bi-kpi-val mono" style={{ fontSize: '1.25rem' }}>
              🔥 <span className="bi-winner-a">{stats.maxStreakA}</span> vs <span className="bi-winner-b">{stats.maxStreakB}</span>
            </div>
            <div className="bi-kpi-sub">Laju poin tanpa henti terpanjang</div>
          </div>

          <div className="bi-kpi-card accent-rose">
            <div className="bi-kpi-top">
              <span>KARTU PELANGGARAN BWF</span>
              <span className="bi-kpi-pill">{cards.length > 0 ? `${cards.length} Kartu` : 'Bersih'}</span>
            </div>
            <div className="bi-kpi-val mono" style={{ color: cards.length > 0 ? '#f87171' : '#22c55e' }}>
              {cards.length} <small>Kartu</small>
            </div>
            <div className="bi-kpi-sub">
              🟨 {cards.filter((c) => c.type === 'yellow').length} Kuning · 🟥 {cards.filter((c) => c.type === 'red').length} Merah · ⬛ {cards.filter((c) => c.type === 'black').length} Hitam
            </div>
          </div>
        </section>

        {/* Set-by-Set Score Table & Visual Progression Bar */}
        <section className="bi-card">
          <div className="bi-card-head">
            <div>
              <h3>📊 Rincian Skor &amp; Performa Per Set</h3>
              <p>
                Sistem Skor: <b>{match.rules?.scoring_method === 'side_out' ? 'Side-Out (Pindah Bola Klasik)' : 'Rally Point'}</b> · Format <b>{match.rules?.scoring_type === 'sets' ? 'Best of 3 Sets' : 'Continuous 1 Game'}</b> · Target <b>{match.rules?.win_point} Poin</b>
              </p>
            </div>
          </div>

          <div className="bi-tbl-wrap">
            <table className="bi-tbl">
              <thead>
                <tr>
                  <th style={{ minWidth: 220 }}>Tim &amp; Pemain</th>
                  {setHist.map((s) => (
                    <th key={s.set} style={{ textAlign: 'center', minWidth: 90 }}>
                      {isSets ? `SET ${s.set}` : 'SKOR GAME'}
                    </th>
                  ))}
                  <th style={{ textAlign: 'center' }}>Total Poin</th>
                  <th style={{ width: 180 }}>Persentase Reli Won</th>
                  <th style={{ textAlign: 'center' }}>Servis Menang</th>
                  <th style={{ textAlign: 'center' }}>Break Lawan</th>
                  <th style={{ textAlign: 'center' }}>Streak Terpanjang</th>
                </tr>
              </thead>
              <tbody>
                {['a', 'b'].map((t) => {
                  const isWin = winSide === t;
                  const isTeamA = t === 'a';
                  const totalPts = isTeamA ? stats.totalPointsA : stats.totalPointsB;
                  const rWon = isTeamA ? stats.rWonA : stats.rWonB;
                  const winRate = isTeamA ? stats.winRateA : stats.winRateB;
                  const srvWon = isTeamA ? stats.srvWonA : stats.srvWonB;
                  const rcvWon = isTeamA ? stats.rcvWonA : stats.rcvWonB;
                  const maxStreak = isTeamA ? stats.maxStreakA : stats.maxStreakB;

                  return (
                    <tr key={t} className={isWin ? (isTeamA ? 'md-row-win-a' : 'md-row-win-b') : ''}>
                      <td className="bi-wrap-cell">
                        <div className={`bi-player-full ${isWin ? (isTeamA ? 'bi-winner-a' : 'bi-winner-b') : ''}`}>
                          {isWin ? '🏆 ' : ''}{teamLabel(match, t)}
                        </div>
                        <div className="bi-cell-sub">
                          TIM {t.toUpperCase()} · {match.teams?.[`team_${t}`]?.club || 'Tanpa Klub'}
                        </div>
                      </td>

                      {setHist.map((s) => {
                        const sWon = (s.winner || (s.a >= s.b ? 'a' : 'b')) === t;
                        return (
                          <td
                            key={s.set}
                            className="mono"
                            style={{
                              textAlign: 'center',
                              fontWeight: sWon ? 900 : 600,
                              fontSize: '1.2rem',
                              color: sWon ? (isTeamA ? '#34d399' : '#38bdf8') : undefined,
                            }}
                          >
                            {s[t]}
                            {s.note === 'DSQ' && !sWon ? ' (DSQ)' : ''}
                          </td>
                        );
                      })}

                      <td className="mono" style={{ textAlign: 'center', fontWeight: 900, fontSize: '1.1rem' }}>
                        {totalPts}
                      </td>

                      <td>
                        <div className="bi-winrate-cell">
                          <div className="bi-progress-track">
                            <div
                              className={`bi-progress-fill ${isTeamA ? 'emerald' : 'cyan'}`}
                              style={{ width: `${winRate}%` }}
                            />
                          </div>
                          <span className="mono">{winRate}%</span>
                        </div>
                      </td>

                      <td className="mono" style={{ textAlign: 'center' }}>
                        {srvWon} reli
                      </td>

                      <td className="mono" style={{ textAlign: 'center' }}>
                        {rcvWon} reli
                      </td>

                      <td className="mono" style={{ textAlign: 'center', fontWeight: 800 }}>
                        🔥 {maxStreak} beruntun
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* BWF Disciplinary Cards Table (if any) */}
        {cards.length > 0 && (
          <section className="bi-card">
            <div className="bi-card-head">
              <div>
                <h3 style={{ color: '#f87171' }}>🟨🟥 Catatan Pelanggaran &amp; Kartu Disiplin BWF Law 16</h3>
                <p>Kartu resmi yang dikeluarkan wasit selama pertandingan ini berlangsung</p>
              </div>
            </div>

            <div className="bi-tbl-wrap">
              <table className="bi-tbl">
                <thead>
                  <tr>
                    <th>Kartu</th>
                    <th>Pemain &amp; Tim</th>
                    <th>Club / PB</th>
                    <th>Set &amp; Skor Saat Pelanggaran</th>
                    <th>Alasan Pelanggaran</th>
                    <th>Konsekuensi Terhadap Pertandingan</th>
                    <th>Waktu Kejadian</th>
                  </tr>
                </thead>
                <tbody>
                  {cards.map((c) => (
                    <tr key={c.card_id}>
                      <td>
                        <span className={`badge ${c.type === 'yellow' ? 'gold' : 'red'}`}>
                          {c.type === 'yellow' ? '🟨 KUNING' : c.type === 'red' ? '🟥 MERAH (FAULT)' : '⬛ HITAM (DSQ)'}
                        </span>
                      </td>
                      <td className="bi-wrap-cell">
                        <b>{c.player_name}</b>
                        <div className="bi-cell-sub">Tim {(c.team || '').toUpperCase()}</div>
                      </td>
                      <td className="bi-wrap-cell">{c.club || '-'}</td>
                      <td className="mono">
                        Set {c.set} ({c.score_before?.a}-{c.score_before?.b} ➔ <b>{c.score_after?.a}-{c.score_after?.b}</b>)
                      </td>
                      <td className="bi-wrap-cell">{c.reason}</td>
                      <td className="bi-wrap-cell small muted">{c.consequence}</td>
                      <td className="mono small">{c.timestamp || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Complete Multi-Row Full Canvas Rally History (Maximized Width & Print Area) */}
        <section className="bi-card md-rally-history-card">
          <div className="bi-card-head" style={{ flexWrap: 'wrap', gap: '.65rem' }}>
            <div>
              <h3>📈 Histori Reli Lengkap Seluruh Pertandingan ({rallies.length} Reli)</h3>
              <p>
                Visualisasi progres perolehan angka dari Reli #1 hingga reli penutup per-set secara multi-baris memaksimalkan lebar layar dan area cetak
              </p>
            </div>
            {rallies.length > 0 && (
              <div className="row tr-no-print" style={{ gap: '.35rem', alignItems: 'center' }}>
                <span className="small muted">Kerapatan Kolom:</span>
                {[15, 20, 25, 30, 40].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`btn btn-sm ${perRow === n ? 'btn-primary' : ''}`}
                    onClick={() => setPerRow(n)}
                  >
                    {n}/Baris
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="md-rally-strip-container">
            {rallies.length > 0 ? (
              <RallyHistoryStrip
                match={match}
                multiRow={true}
                perRow={perRow}
                groupBySet={true}
                topSide="a"
                bottomSide="b"
                showLabel={true}
                showTeamNames={true}
                title={`PROGRESI RELI LENGKAP · ${teamLabel(match, 'a')} (Tim A) vs ${teamLabel(match, 'b')} (Tim B)`}
              />
            ) : (
              <div className="bi-empty-box" style={{ background: 'var(--bi-surface-2)', borderRadius: 12 }}>
                Pertandingan ini diselesaikan melalui input skor langsung / keputusan panitia sehingga tidak memiliki rekaman reli per-poin.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function CourtGrid({ matches, courtCount, now, onUnlock, onToggleHistory, onRemoteSetup, onClearSetupRequest }) {
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

  const activeRequests = useMemo(
    () => matches.filter((m) => Boolean(m.session_management?.setup_request)),
    [matches]
  );

  return (
    <div className="col" style={{ gap: '.75rem' }}>
      {activeRequests.length > 0 && (
        <div className="admin-setup-alert-banner">
          <div className="row" style={{ gap: '.6rem', flexWrap: 'wrap' }}>
            <span className="badge" style={{ background: '#dc2626', color: '#fff', fontWeight: 900 }}>
              🚨 {activeRequests.length} REQUEST SETUP / BANTUAN WASIT
            </span>
            {activeRequests.map((rm) => (
              <button
                key={rm.match_number}
                type="button"
                className="btn btn-sm btn-yellow"
                onClick={() => onRemoteSetup?.(rm)}
              >
                Lap. {rm.court_number} · {rm.match_number} ({rm.session_management.setup_request.by}): &ldquo;{rm.session_management.setup_request.note}&rdquo; → 🛠️ Setup Sekarang
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="admin-courts">
        {courts.map(({ c, featured: m, extraActive, next, queue, done }) => {
          const age = m ? heartbeatAge(m, now) : null;
          const stale = m && m.session_management.locked && age > 30;
          const st = m?.live_state;
          const req = m?.session_management?.setup_request || null;
          return (
            <div key={c} className={`court-card ${m ? 'active' : ''} ${stale || extraActive > 0 ? 'warn' : ''} ${req ? 'setup-requested' : ''}`}>
              <div className="row" style={{ gap: '.4rem' }}>
                <span className="cnum">Lap. {c}</span>
                {req && (
                  <span className="badge" style={{ background: '#ef4444', color: '#fff', fontWeight: 900, animation: 'pulse 1.5s infinite' }}>
                    🚨 REQUEST SETUP
                  </span>
                )}
                <div className="spacer" />
                <Link className="small" href={`/display?court=${c}`} target="_blank">
                  📺
                </Link>
              </div>
              {req && (
                <div className="court-req-box">
                  <div className="small" style={{ fontWeight: 800, color: '#fef08a' }}>
                    🆘 {req.by}: &ldquo;{req.note}&rdquo;
                  </div>
                  <div className="row" style={{ gap: '.35rem', marginTop: '.25rem' }}>
                    <button type="button" className="btn btn-sm btn-yellow" onClick={() => onRemoteSetup?.(m)}>
                      🛠️ Bantu Setup / Edit
                    </button>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => onClearSetupRequest?.(m.match_number)}>
                      Tutup Alert
                    </button>
                  </div>
                </div>
              )}
              {m ? (
                <>
                  <div className="row" style={{ gap: '.4rem' }}>
                    <b>{m.match_number}</b>
                    <StatusBadge match={m} />
                    {st.phase === 'interval' && <span className="badge gold">INTERVAL</span>}
                    {st.phase === 'set_break' && <span className="badge blue">SET BREAK</span>}
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
                      className="btn btn-sm btn-blue"
                      onClick={() => onRemoteSetup?.(m)}
                      title="Setup awal atau koreksi live skor, posisi pemain, dan servis langsung dari Admin"
                    >
                      🛠️ Setup / Edit Live
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm ${m.live_state?.show_rally_history ? 'btn-yellow' : 'btn-ghost'}`}
                      onClick={() => onToggleHistory?.(m.match_number)}
                      title="Aktifkan / Sembunyikan tampilan 10 servis terakhir pada overlay YouTube Lapangan ini"
                    >
                      📊 OBS: {m.live_state?.show_rally_history ? 'ON' : 'OFF'}
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
                      <div style={{ marginTop: '.35rem' }}>
                        <button type="button" className="btn btn-sm btn-blue" onClick={() => onRemoteSetup?.(next)}>
                          🛠️ Pre-Setup Match Ini
                        </button>
                      </div>
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
    </div>
  );
}

/**
 * AdminRemoteSetupModal
 * Admin dapat melakukan Setup Awal (SETUP_START) maupun Koreksi Live (OVERRIDE, SWITCH_SIDE, CONFIRM_INTERVAL, NEXT_SET, UNDO)
 * secara remote untuk membantu tablet wasit di lapangan.
 */
function AdminRemoteSetupModal({ match, token, onClose, notify }) {
  const st = match.live_state;
  const dbl = isDoubles(match);
  const isSetup = st.phase === 'setup';
  const [busy, setBusy] = useState(false);

  // Setup state
  const [left, setLeft] = useState(st.sides?.left || 'a');
  const [pos, setPos] = useState(() => ({
    a: { even: st.positions?.a?.even || 'a1', odd: st.positions?.a?.odd || (dbl ? 'a2' : null) },
    b: { even: st.positions?.b?.even || 'b1', odd: st.positions?.b?.odd || (dbl ? 'b2' : null) },
  }));
  const [server, setServer] = useState(st.service_status?.player_id || 'a1');
  const [receiver, setReceiver] = useState(st.service_status?.receiver_id || 'b1');

  // Live override state
  const [score, setScore] = useState({ ...st.score });
  const [side, setSide] = useState(st.service_status?.side || 'a');
  const [turn, setTurn] = useState(st.service_status?.turn || 1);
  const [cockCount, setCockCount] = useState(Number(st.shuttlecock_count ?? 0));

  const runRemote = async (type, payload = {}, closeAfter = true) => {
    setBusy(true);
    const r = await api(`/api/matches/${encodeURIComponent(match.match_number)}/remote_action`, {
      method: 'POST',
      pin: token,
      body: { type, payload },
    });
    setBusy(false);
    if (r.ok) {
      notify({ type: 'ok', text: `🛠️ Remote aksi (${type}) untuk ${match.match_number} berhasil diterapkan ke tablet wasit & display!` });
      if (closeAfter) onClose();
    } else {
      notify({ type: 'error', text: r.error || 'Gagal menjalankan aksi remote' });
    }
  };

  const req = match.session_management?.setup_request;
  const right = other(left);

  const previewMatch = useMemo(() => {
    const srvSide = isSetup ? (server ? server[0] : 'a') : side;
    const srvPid = isSetup ? server : server || pos[side]?.even || `${side}1`;
    const rcvPid = isSetup ? receiver : null;
    return {
      ...match,
      live_state: {
        ...st,
        score: isSetup ? { a: 0, b: 0 } : { a: parseInt(score.a, 10) || 0, b: parseInt(score.b, 10) || 0 },
        sides: { left, right },
        positions: pos,
        service_status: { side: srvSide, turn: isSetup ? 1 : turn, player_id: srvPid, receiver_id: rcvPid },
      },
    };
  }, [match, st, isSetup, left, right, pos, server, receiver, side, turn, score]);
  const previewPositions = useMemo(() => courtPositions(previewMatch), [previewMatch]);

  const moveToEven = (p, pid) => {
    const t = pid[0];
    if (p[t]?.odd === pid) return { ...p, [t]: { even: pid, odd: p[t].even } };
    return p;
  };

  const pickServer = (pid) => {
    if (!pid) return;
    const srvTeam = pid[0];
    const rcvTeam = other(srvTeam);
    setSide(srvTeam);
    setServer(pid);
    if (isSetup) {
      if (dbl) {
        setPos((p) => {
          const nextP = moveToEven(p, pid);
          if (!receiver || receiver[0] === srvTeam) {
            setReceiver(nextP[rcvTeam]?.even || `${rcvTeam}1`);
          }
          return nextP;
        });
      } else {
        setReceiver(`${rcvTeam}1`);
      }
    }
  };

  const pickReceiver = (pid) => {
    if (!pid || !server || pid[0] === server[0]) return;
    setReceiver(pid);
    if (isSetup && dbl) {
      setPos((p) => moveToEven(p, pid));
    }
  };

  const swapTeamVertical = (t) => {
    setPos((p) => {
      const nextEven = p[t].odd;
      const nextOdd = p[t].even;
      if (isSetup) {
        if (server?.[0] === t && nextEven) setServer(nextEven);
        if (receiver?.[0] === t && nextEven) setReceiver(nextEven);
      }
      return { ...p, [t]: { even: nextEven, odd: nextOdd } };
    });
  };

  const renderSidePositionCol = (screenSide) => {
    const t = screenSide === 'left' ? left : right;
    const topSlot = screenSide === 'left' ? 'left_top' : 'right_top';
    const bottomSlot = screenSide === 'left' ? 'left_bottom' : 'right_bottom';
    const topPid = previewPositions[topSlot];
    const bottomPid = previewPositions[bottomSlot];
    const topBoxLabel = screenSide === 'left' ? 'Atas (Kiri/Ganjil)' : 'Atas (Kanan/Genap)';
    const bottomBoxLabel = screenSide === 'left' ? 'Bawah (Kanan/Genap)' : 'Bawah (Kiri/Ganjil)';

    return (
      <div className={`setup-side-col ${screenSide}`}>
        <div className="setup-side-hdr">
          {screenSide === 'left' ? '◀ SISI KIRI' : 'SISI KANAN ▶'} · TIM {t.toUpperCase()}
        </div>

        {!isSetup && (
          <div className="ov-score-stepper" style={{ padding: '.35rem .5rem' }}>
            <button type="button" className="btn btn-sm" onClick={() => setScore((s) => ({ ...s, [t]: Math.max(0, (parseInt(s[t], 10) || 0) - 1) }))}>−</button>
            <input
              className="input ov-score-input mono"
              style={{ width: 64, fontSize: '1.35rem', padding: '.2rem' }}
              type="number"
              min={0}
              value={score[t]}
              onChange={(e) => setScore((s) => ({ ...s, [t]: e.target.value }))}
            />
            <button type="button" className="btn btn-sm btn-green" onClick={() => setScore((s) => ({ ...s, [t]: (parseInt(s[t], 10) || 0) + 1 }))}>+</button>
          </div>
        )}

        {/* Top Player Slot */}
        <div className={`setup-slot-card ${server === topPid ? 'is-srv' : isSetup && receiver === topPid ? 'is-rcv' : ''}`}>
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
              {isSetup && dbl && (
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
            onClick={() => swapTeamVertical(t)}
            title={`Tukar posisi Atas ⇅ Bawah untuk pasangan Tim ${t.toUpperCase()}`}
          >
            ⇅ Tukar Atas ↕ Bawah ({screenSide === 'left' ? 'Kiri' : 'Kanan'})
          </button>
        )}

        {/* Bottom Player Slot */}
        <div className={`setup-slot-card ${server === bottomPid ? 'is-srv' : isSetup && receiver === bottomPid ? 'is-rcv' : ''}`}>
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
              {isSetup && dbl && (
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
    <div className="modal-bg" onClick={onClose}>
      <div className="modal col" style={{ width: 'min(1080px, 98vw)' }} onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2 style={{ margin: 0 }}>🛠️ Remote Setup &amp; Kendali Wasit: {match.match_number} (Lap. {match.court_number})</h2>
          <div className="spacer" />
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>✕</button>
        </div>

        {req && (
          <div className="notice warn small">
            🆘 <b>Permintaan Wasit ({req.by}):</b> &ldquo;{req.note}&rdquo; — Menerapkan perubahan di sini akan otomatis menyelesaikan alert ini.
          </div>
        )}

        <div className="row small muted" style={{ gap: '1rem' }}>
          <span>Kategori: <b style={{ color: 'var(--text)' }}>{match.category_name} ({match.discipline})</b></span>
          <span>Fase: <b className="mono" style={{ color: 'var(--gold)' }}>{st.phase.toUpperCase()}</b></span>
          <span>Wasit: <b style={{ color: 'var(--text)' }}>{match.session_management?.controller_label || '-'}</b></span>
        </div>

        {/* BAGIAN ATAS LAPANGAN: Pemilihan Sisi Lapangan Kiri <-> Kanan di Tengah Atas */}
        <div className="setup-top-sides-bar">
          <div className="setup-side-team left">
            <span className="setup-side-badge left">◀ LAPANGAN KIRI · TIM {left.toUpperCase()}</span>
            <span className="tname">{teamLabel(match, left)}</span>
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
            <span className="setup-side-badge right">LAPANGAN KANAN · TIM {right.toUpperCase()} ▶</span>
            <span className="tname">{teamLabel(match, right)}</span>
            <span className="tclub">{match.teams[`team_${right}`].club || '-'}</span>
          </div>
        </div>

        {/* BAGIAN TENGAH: Kontrol Atas/Bawah Kiri | Ilustrasi Lapangan + Tombol Servis/Terima dekat Nama Pemain | Kontrol Atas/Bawah Kanan */}
        <div className="setup-court-stage">
          {renderSidePositionCol('left')}

          <div className="setup-court-center">
            <CourtMap
              match={previewMatch}
              positions={previewPositions}
              serverId={server}
              receiverId={isSetup ? receiver : previewMatch.live_state.service_status.receiver_id}
              serveTurn={isSetup ? 1 : turn}
              spinKey={left}
              renderActions={(pid) => (
                <>
                  <button
                    type="button"
                    className={`icon-btn shuttle ${server === pid ? 'on' : ''}`}
                    onClick={() => pickServer(pid)}
                    title="Pilih sebagai pemain servis"
                  >
                    <Shuttle size={16} /> Servis
                  </button>
                  {isSetup && dbl && (
                    <button
                      type="button"
                      className={`icon-btn target ${receiver === pid ? 'on' : ''}`}
                      onClick={() => pickReceiver(pid)}
                      disabled={!server || pid[0] === server[0]}
                      title="Pilih sebagai penerima servis"
                    >
                      <Target /> Terima
                    </button>
                  )}
                </>
              )}
            />
          </div>

          {renderSidePositionCol('right')}
        </div>

        {isSetup ? (
          <div className="col" style={{ gap: '.75rem' }}>
            <button
              type="button"
              className="btn btn-green btn-lg btn-block"
              disabled={busy}
              onClick={() => runRemote('SETUP_START', { left, positions: pos, server_id: server, receiver_id: receiver })}
            >
              ▶ Terapkan Setup &amp; Mulai Pertandingan (Live ke Tablet Wasit)
            </button>
          </div>
        ) : (
          <div className="col" style={{ gap: '.75rem' }}>
            <div className="row" style={{ gap: '1rem', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center' }}>
              {dbl && match.rules.scoring_method === 'side_out' && (
                <div className="row" style={{ gap: '.35rem', alignItems: 'center' }}>
                  <span className="small muted" style={{ fontWeight: 800 }}>Giliran Servis (Side-Out):</span>
                  {[1, 2].map((n) => (
                    <button key={n} type="button" className={`btn btn-sm ${turn === n ? 'btn-blue' : ''}`} onClick={() => setTurn(n)}>
                      {n === 1 ? '● Servis ke-1 (1st)' : '● ● Servis ke-2 (2nd)'}
                    </button>
                  ))}
                </div>
              )}
              <div className="row" style={{ gap: '.35rem', alignItems: 'center' }}>
                <span className="small muted" style={{ fontWeight: 800 }}>🏸 Shuttlecock:</span>
                <button type="button" className="btn btn-sm" onClick={() => setCockCount((c) => Math.max(0, c - 1))}>−</button>
                <b className="mono">{cockCount}</b>
                <button type="button" className="btn btn-sm" onClick={() => setCockCount((c) => c + 1)}>+</button>
              </div>
            </div>

            <div className="row" style={{ gap: '.45rem', flexWrap: 'wrap' }}>
              {['live', 'interval', 'set_break'].includes(st.phase) && (
                <button
                  type="button"
                  className="btn btn-green btn-lg"
                  style={{ flex: 1 }}
                  disabled={busy}
                  onClick={() =>
                    runRemote('OVERRIDE', {
                      sides: { left },
                      score,
                      service: { side, player_id: server, turn },
                      positions: dbl ? pos : undefined,
                      shuttlecock_count: cockCount,
                    })
                  }
                >
                  ✔ Simpan Koreksi Live ke Tablet Wasit
                </button>
              )}
              {st.phase === 'interval' && (
                <button type="button" className="btn btn-yellow" disabled={busy} onClick={() => runRemote('CONFIRM_INTERVAL')}>
                  ▶ Lanjutkan Interval
                </button>
              )}
              {st.phase === 'set_break' && (
                <button type="button" className="btn btn-yellow" disabled={busy} onClick={() => runRemote('NEXT_SET')}>
                  ▶ Lanjut Set Berikutnya
                </button>
              )}
              <button type="button" className="btn btn-yellow" disabled={busy || !match.can_undo} onClick={() => runRemote('UNDO', {}, false)}>
                ↶ Undo Terakhir
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * RefereeRosterPanel
 * Admin mengelola daftar nama resmi wasit agar seragam di modul wasit, log & laporan.
 */
function RefereeRosterPanel({ token, notify }) {
  const [referees, setReferees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [license, setLicense] = useState('');
  const [phone, setPhone] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editLicense, setEditLicense] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await api('/api/admin/referees', { pin: token });
    setLoading(false);
    if (r.ok && Array.isArray(r.referees)) setReferees(r.referees);
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const r = await api('/api/admin/referees', { method: 'POST', pin: token, body: { name, license, phone } });
    setBusy(false);
    if (r.ok) {
      setReferees(r.referees || []);
      setName('');
      setLicense('');
      setPhone('');
      notify({ type: 'ok', text: `✅ Wasit "${r.referee.name}" ditambahkan ke daftar resmi.` });
    } else {
      notify({ type: 'error', text: r.error || 'Gagal menambah wasit' });
    }
  };

  const handleBulk = async (e) => {
    e.preventDefault();
    if (!bulkText.trim()) return;
    setBusy(true);
    const r = await api('/api/admin/referees', { method: 'POST', pin: token, body: { bulk_text: bulkText } });
    setBusy(false);
    if (r.ok) {
      setReferees(r.referees || []);
      setBulkText('');
      notify({
        type: 'ok',
        text: `✅ Ditambahkan: ${r.added?.length || 0} wasit${r.skipped?.length ? ` · Dilewati (duplikat): ${r.skipped.length}` : ''}`,
      });
    } else {
      notify({ type: 'error', text: r.error || 'Gagal import massal' });
    }
  };

  const handleSaveEdit = async (id) => {
    if (!editName.trim()) return;
    setBusy(true);
    const r = await api(`/api/admin/referees/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      pin: token,
      body: { name: editName, license: editLicense },
    });
    setBusy(false);
    if (r.ok) {
      setReferees(r.referees || []);
      setEditingId(null);
      notify({ type: 'ok', text: 'Nama wasit diperbarui' });
    } else {
      notify({ type: 'error', text: r.error || 'Gagal mengubah' });
    }
  };

  const handleToggleActive = async (refItem) => {
    const r = await api(`/api/admin/referees/${encodeURIComponent(refItem.id)}`, {
      method: 'PATCH',
      pin: token,
      body: { active: refItem.active === false },
    });
    if (r.ok) setReferees(r.referees || []);
  };

  const handleDelete = async (refItem) => {
    if (!window.confirm(`Hapus "${refItem.name}" dari daftar wasit resmi?`)) return;
    const r = await api(`/api/admin/referees/${encodeURIComponent(refItem.id)}`, { method: 'DELETE', pin: token });
    if (r.ok) {
      setReferees(r.referees || []);
      notify({ type: 'ok', text: `Wasit "${refItem.name}" dihapus` });
    }
  };

  const filtered = referees.filter((r) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return r.name.toLowerCase().includes(q) || (r.license && r.license.toLowerCase().includes(q));
  });

  return (
    <div className="col" style={{ gap: '1rem' }}>
      <div className="setup-grid" style={{ gridTemplateColumns: 'minmax(300px, 420px) 1fr' }}>
        <div className="col" style={{ gap: '1rem' }}>
          <form className="card col" onSubmit={handleAdd}>
            <h3 style={{ margin: 0, color: 'var(--gold)' }}>➕ Tambah Wasit Resmi</h3>
            <p className="muted small" style={{ margin: 0 }}>
              Nama yang didaftarkan di sini akan langsung tampil sebagai pilihan cepat &amp; pencarian di tablet Wasit agar penulisan nama seragam tanpa typo.
            </p>
            <label className="field">
              Nama Lengkap / Panggilan Wasit *
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Contoh: Budi Santoso" required />
            </label>
            <div className="row" style={{ gap: '.5rem' }}>
              <label className="field" style={{ flex: 1 }}>
                Lisensi / Grade (Opsional)
                <input className="input" value={license} onChange={(e) => setLicense(e.target.value)} placeholder="PBSI Nasional / Daerah" />
              </label>
              <label className="field" style={{ flex: 1 }}>
                No. HP (Opsional)
                <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0812…" />
              </label>
            </div>
            <button type="submit" className="btn btn-green" disabled={busy}>
              + Tambah ke Daftar Wasit
            </button>
          </form>

          <form className="card col" onSubmit={handleBulk}>
            <h3 style={{ margin: 0 }}>📋 Import Banyak Nama Sekaligus</h3>
            <p className="muted small" style={{ margin: 0 }}>
              Tempel daftar nama wasit (pisahkan dengan baris baru / Enter atau koma).
            </p>
            <textarea
              className="input"
              rows={5}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder={'Ahmad Fauzi\nBudi Santoso\nCitra Lestari\nDedi Kurniawan'}
            />
            <button type="submit" className="btn btn-blue" disabled={busy || !bulkText.trim()}>
              ⬆ Import Daftar Wasit
            </button>
          </form>
        </div>

        <div className="card col">
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem' }}>
            <div>
              <h3 style={{ margin: 0 }}>👨‍⚖️ Daftar Wasit Bertugas ({referees.length})</h3>
              <span className="small muted">Aktif: {referees.filter((r) => r.active !== false).length} wasit</span>
            </div>
            <input
              className="input"
              style={{ width: 240 }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="🔍 Cari nama wasit…"
            />
          </div>

          {loading ? (
            <div className="muted small">Memuat daftar wasit…</div>
          ) : filtered.length === 0 ? (
            <div className="muted small" style={{ padding: '1rem', textAlign: 'center' }}>
              Belum ada nama wasit terdaftar. Tambahkan di sebelah kiri.
            </div>
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Nama Wasit</th>
                    <th>Lisensi</th>
                    <th>Status</th>
                    <th style={{ width: 210 }}>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {editingId === r.id ? (
                          <input className="input" value={editName} onChange={(e) => setEditName(e.target.value)} />
                        ) : (
                          <b>👤 {r.name}</b>
                        )}
                      </td>
                      <td>
                        {editingId === r.id ? (
                          <input className="input" value={editLicense} onChange={(e) => setEditLicense(e.target.value)} placeholder="Lisensi" />
                        ) : (
                          <span className="small muted">{r.license || '-'}</span>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${r.active !== false ? 'green' : ''}`}>
                          {r.active !== false ? 'Aktif' : 'Nonaktif'}
                        </span>
                      </td>
                      <td>
                        <div className="row" style={{ gap: '.3rem' }}>
                          {editingId === r.id ? (
                            <>
                              <button type="button" className="btn btn-sm btn-green" onClick={() => handleSaveEdit(r.id)}>Simpan</button>
                              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditingId(null)}>Batal</button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() => {
                                  setEditingId(r.id);
                                  setEditName(r.name);
                                  setEditLicense(r.license || '');
                                }}
                              >
                                Edit
                              </button>
                              <button type="button" className="btn btn-sm btn-yellow" onClick={() => handleToggleActive(r)}>
                                {r.active !== false ? 'Nonaktifkan' : 'Aktifkan'}
                              </button>
                              <button type="button" className="btn btn-sm btn-red" onClick={() => handleDelete(r)}>
                                Hapus
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
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

function MatchTable({ matches, pin, courtCount, now, onEdit, onViewDetail, onLogs, notify, prefs, setPrefs }) {
  const { q, status, court, category, sorts } = prefs;
  const setQ = (val) => setPrefs((p) => ({ ...p, q: val }));
  const setStatus = (val) => setPrefs((p) => ({ ...p, status: val }));
  const setCourt = (val) => setPrefs((p) => ({ ...p, court: val }));
  const setCategory = (val) => setPrefs((p) => ({ ...p, category: val }));
  const setSorts = (updater) =>
    setPrefs((p) => ({
      ...p,
      sorts: typeof updater === 'function' ? updater(p.sorts || []) : updater,
    }));
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
              const isFin = sm.status === 'finished' || st.phase === 'finished';
              const cards = Array.isArray(st.cards) ? st.cards : [];
              return (
                <tr key={m.match_number}>
                  <td
                    style={{ cursor: isFin ? 'pointer' : 'default' }}
                    onClick={() => isFin && onViewDetail?.(m)}
                    title={isFin ? 'Klik untuk membuka Detail & Histori Reli Lengkap pertandingan ini' : ''}
                  >
                    <b>{m.match_number}</b>
                    {cards.length > 0 && (
                      <div className="small" title={cards.map((c) => `${c.type.toUpperCase()} (${c.player_name}): ${c.reason}`).join(' | ')}>
                        {cards.map((c) => (c.type === 'yellow' ? '🟨' : c.type === 'red' ? '🟥' : '⬛')).join('')}
                      </div>
                    )}
                  </td>
                  <td className="small">
                    {m.category_name}
                    <br />
                    <span className="muted">{m.discipline}</span>
                  </td>
                  <td
                    className="small"
                    style={{ cursor: isFin ? 'pointer' : 'default' }}
                    onClick={() => isFin && onViewDetail?.(m)}
                    title={isFin ? 'Klik untuk membuka Detail & Histori Reli Lengkap pertandingan ini' : ''}
                  >
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
                  <td
                    className="mono"
                    style={{ cursor: isFin ? 'pointer' : 'default' }}
                    onClick={() => isFin && onViewDetail?.(m)}
                    title={isFin ? 'Klik untuk membuka Detail & Histori Reli Lengkap pertandingan ini' : ''}
                  >
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
                      {isFin && (
                        <button
                          className="btn btn-sm btn-green"
                          onClick={() => onViewDetail?.(m)}
                          title="Lihat Detail Lengkap Pertandingan & Seluruh Histori Reli"
                        >
                          📊 Detail &amp; Reli
                        </button>
                      )}
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

function ExportCard({ pin, exporter, setExporter, notify, onRestored }) {
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyPushState, setBusyPushState] = useState(false);
  const [busyBackup, setBusyBackup] = useState(false);
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
        ? `✅ Koneksi Webhook Berhasil! ${r.test?.message || 'Siap mengunggah hasil, log & progres state ke Google Sheets.'}`
        : '✅ Konfigurasi Webhook Google Sheets disimpan.';
      setTestMsg({ type: 'ok', text: msg });
      notify({ type: 'ok', text: msg });
    } else {
      setTestMsg({ type: 'error', text: r.error || 'Gagal menghubungi Webhook Google Sheets' });
    }
  };

  const pushCloudStateNow = async () => {
    setBusyPushState(true);
    const r = await api('/api/admin/export/push-state', { method: 'POST', pin });
    setBusyPushState(false);
    if (r.exporter) setExporter(r.exporter);
    if (r.ok) {
      notify({
        type: 'ok',
        text: `☁️ Progres turnamen (${r.synced_matches || 0} match & ${r.synced_results || 0} hasil selesai) berhasil disimpan ke Cloud Google Sheets! Siap dibuka di laptop manapun.`,
      });
    } else {
      notify({ type: 'error', text: r.error || 'Gagal mengunggah progres turnamen ke Google Sheets' });
    }
  };

  const downloadBackupBundle = async () => {
    setBusyBackup(true);
    try {
      const res = await fetch('/api/admin/backup/export', {
        headers: { 'x-admin-token': pin, 'x-admin-pin': pin },
      });
      if (!res.ok) throw new Error('Gagal mengunduh file backup state turnamen');
      const blob = await res.blob();
      const cd = res.headers.get('content-disposition') || '';
      const fnMatch = cd.match(/filename="([^"]+)"/i);
      const filename = fnMatch ? fnMatch[1] : `smashpoint-state-${new Date().toISOString().slice(0, 10)}.json`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify({ type: 'ok', text: `💾 File State Turnamen (${filename}) berhasil diunduh!` });
    } catch (e) {
      notify({ type: 'error', text: e.message || 'Gagal mengunduh backup' });
    } finally {
      setBusyBackup(false);
    }
  };

  const onRestoreFile = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!window.confirm(`Pulihkan (Restore) progres turnamen dari file "${f.name}"?\n\nSeluruh skor, status pertandingan, riwayat reli, dan log pada profil aktif akan dilanjutkan sesuai isi file ini.`)) {
      return;
    }
    const rd = new FileReader();
    rd.onload = async () => {
      try {
        const bundle = JSON.parse(String(rd.result || '{}'));
        setBusyBackup(true);
        const r = await api('/api/admin/backup/import', {
          method: 'POST',
          pin,
          body: { bundle, merge: false },
        });
        setBusyBackup(false);
        if (r.ok) {
          onRestored?.(r);
          notify({
            type: 'ok',
            text: `✅ Berhasil memulihkan progres ${r.restored_matches || 0} pertandingan dari file "${f.name}"!`,
          });
        } else {
          notify({ type: 'error', text: r.error || 'Gagal memulihkan file state turnamen' });
        }
      } catch {
        setBusyBackup(false);
        notify({ type: 'error', text: 'File JSON backup tidak valid' });
      }
    };
    rd.readAsText(f);
  };

  return (
    <div className="card col">
      <h3 style={{ margin: 0 }}>📤 Ekspor, Cloud Sync &amp; Pindah Laptop</h3>
      <div className="row">
        <a className="btn" href="/api/export/results.csv">
          ⬇ Hasil (CSV)
        </a>
        <a className="btn" href="/api/export/logs.csv">
          ⬇ Semua Log (CSV)
        </a>
        <button type="button" className="btn btn-yellow" onClick={openScriptModal} title="Lihat & salin kode terbaru Google Apps Script (mendukung Cloud State Sync antar-laptop + kolom referee_name & shuttlecock_count)">
          📜 Kode Google Apps Script Terbaru
        </button>
      </div>

      {/* Fitur Pindah Laptop / Multi-PC Sync (Cloud via Google Sheets + File Backup JSON) */}
      <div className="col" style={{ background: 'rgba(14, 116, 144, 0.14)', padding: '.7rem .85rem', borderRadius: 10, border: '1px solid rgba(34, 211, 238, 0.35)' }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="small" style={{ fontWeight: 900, color: 'var(--cyan)' }}>
            💻 Lanjutkan Progres Turnamen di Laptop / PC Lain:
          </span>
          <span className="badge cyan">Auto-Restore Aktif</span>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Saat Anda menarik jadwal dari Google Sheets di laptop lain, aplikasi otomatis membaca tab <b>Results</b> &amp; <b>SmashPoint_State</b> agar pertandingan yang sudah selesai atau sedang berjalan tidak mengulang dari awal.
        </p>
        <div className="row" style={{ gap: '.45rem', marginTop: '.2rem' }}>
          <button
            type="button"
            className="btn btn-sm btn-green"
            disabled={!exporter?.webhook_configured || busyPushState}
            onClick={pushCloudStateNow}
            title="Simpan seluruh progres skor, status pertandingan, dan hasil saat ini ke Google Sheets (tab SmashPoint_State & Results) agar bisa langsung ditarik di laptop lain"
          >
            {busyPushState ? '☁️ Menyimpan ke Cloud…' : '☁️ Simpan Progres ke Cloud Sheet Sekarang'}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-blue"
            disabled={busyBackup}
            onClick={downloadBackupBundle}
            title="Unduh seluruh database progres turnamen (.json) untuk dipindahkan via Flashdisk / WhatsApp ke laptop lain"
          >
            💾 Backup Progres (.json)
          </button>
          <label className="btn btn-sm" style={{ cursor: 'pointer', margin: 0 }} title="Muat file Backup Progres (.json) dari laptop sebelumnya">
            📂 Restore dari File (.json)
            <input type="file" accept=".json" style={{ display: 'none' }} onChange={onRestoreFile} />
          </label>
        </div>
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

/**
 * CloseTournamentModal
 * Modal untuk melakukan Closing Turnamen secara resmi dan melengkapi metadata laporan (Venue, Chief Referee, Ketua Panitia, Catatan Penutupan).
 */
function CloseTournamentModal({ profile, matches, token, onClose, onSaved, onOpenReport, notify }) {
  const [venue, setVenue] = useState(profile?.venue || '');
  const [chiefReferee, setChiefReferee] = useState(profile?.chief_referee || '');
  const [committeeHead, setCommitteeHead] = useState(profile?.committee_head || '');
  const [closingNotes, setClosingNotes] = useState(
    profile?.closing_notes ||
      'Turnamen berjalan lancar, tertib, dan menjunjung tinggi sportivitas sesuai regulasi BWF & PBSI.'
  );
  const [busy, setBusy] = useState(false);

  const total = matches.length;
  const finished = matches.filter((m) => m.session_management?.status === 'finished').length;
  const unfinished = total - finished;

  const submit = async (e) => {
    e.preventDefault();
    if (!profile?.id) return;
    if (
      unfinished > 0 &&
      !window.confirm(
        `Masih ada ${unfinished} dari ${total} pertandingan yang belum berstatus Selesai (Finished).\n\nTetap lakukan Closing Turnamen "${profile.name}" sekarang?`
      )
    ) {
      return;
    }
    setBusy(true);
    const r = await api(`/api/admin/profiles/${encodeURIComponent(profile.id)}/close`, {
      method: 'POST',
      pin: token,
      body: {
        venue: venue.trim(),
        chief_referee: chiefReferee.trim(),
        committee_head: committeeHead.trim(),
        closing_notes: closingNotes.trim(),
      },
    });
    setBusy(false);
    if (r.ok) {
      onSaved?.(r);
      notify({
        type: 'ok',
        text: `🏁 Turnamen "${profile.name}" resmi ditutup (Closed)! Membuka Laporan Pelaksanaan Turnamen…`,
      });
      onClose();
      onOpenReport?.();
    } else {
      notify({ type: 'error', text: r.error || 'Gagal menutup turnamen' });
    }
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal col" style={{ width: 'min(680px, 100%)' }} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="row">
          <h2 style={{ margin: 0 }}>🏁 Closing Turnamen &amp; Pengesahan Laporan</h2>
          <div className="spacer" />
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <p className="muted small" style={{ margin: 0 }}>
          Anda akan melakukan <b>Closing (Penutupan Resmi)</b> untuk profil turnamen <b>{profile?.name}</b>. Sistem akan menghasilkan <b>Laporan Pelaksanaan Turnamen Lengkap</b> yang merangkum seluruh hasil, juara kategori, klasemen klub, durasi, penggunaan shuttlecock, kinerja wasit, dan kartu pelanggaran.
        </p>

        {unfinished > 0 ? (
          <div className="notice warn small">
            ⚠️ Perhatian: Terdapat <b>{unfinished} pertandingan</b> yang belum selesai ({finished}/{total} selesai). Anda tetap dapat menutup turnamen atau menyelesaikan pertandingan terlebih dahulu.
          </div>
        ) : (
          <div className="notice ok small">
            ✅ Seluruh <b>{total} pertandingan</b> pada turnamen ini telah selesai (100% Completed). Turnamen siap ditutup!
          </div>
        )}

        <div className="info-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <label className="field">
            Lokasi / Venue GOR
            <input
              className="input"
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder="Contoh: GOR Bulutangkis Djarum / Hall A"
            />
          </label>
          <label className="field">
            Referee Utama (Chief Referee)
            <input
              className="input"
              value={chiefReferee}
              onChange={(e) => setChiefReferee(e.target.value)}
              placeholder="Nama Referee Utama PBSI/BWF"
            />
          </label>
          <label className="field" style={{ gridColumn: '1 / -1' }}>
            Ketua Panitia Pelaksana
            <input
              className="input"
              value={committeeHead}
              onChange={(e) => setCommitteeHead(e.target.value)}
              placeholder="Nama Ketua Panitia / Penanggung Jawab"
            />
          </label>
          <label className="field" style={{ gridColumn: '1 / -1' }}>
            Catatan Evaluasi &amp; Berita Acara Penutupan Turnamen
            <textarea
              className="input"
              rows={3}
              value={closingNotes}
              onChange={(e) => setClosingNotes(e.target.value)}
              placeholder="Ringkasan jalannya turnamen, evaluasi teknis, atau apresiasi pemenang…"
            />
          </label>
        </div>

        <div className="row">
          <button type="submit" className="btn btn-green btn-lg" style={{ flex: 1 }} disabled={busy}>
            {busy ? 'Memproses Closing…' : '🏁 Konfirmasi Closing Turnamen & Buat Laporan'}
          </button>
          <button type="button" className="btn btn-ghost btn-lg" onClick={onClose}>
            Batal
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * TournamentReportModal
 * Executive Business Intelligence (BI) Tournament Report:
 * KPI Cards, SVG Charts (Donut, Court Utilization, Duration Histogram, Category & Club Bars),
 * Full Podiums, Club Leaderboard, Umpire Scorecard, BWF Fair Play Audit & Zero-Truncation Match Register.
 * Dapat dilihat & di-regenerate kapan saja walaupun turnamen berstatus CLOSED.
 */
function TournamentReportModal({ profile, matches, token, now, onClose, onSelectMatch, onOpenCloseModal, onRegenerate, notify }) {
  const [reportTab, setReportTab] = useState('all'); // 'all' | 'analytics' | 'champions' | 'logistics' | 'matches'
  const [biTheme, setBiTheme] = useState('dark'); // 'dark' | 'paper'
  const [regenerating, setRegenerating] = useState(false);
  const [generatedAt, setGeneratedAt] = useState(() => formatLocalDateTime(new Date()));
  const [matchSearch, setMatchSearch] = useState('');
  const [matchStatusFilter, setMatchStatusFilter] = useState('all');
  const [matchCatFilter, setMatchCatFilter] = useState('all');

  useEffect(() => {
    document.body.classList.add('bi-report-open');
    return () => {
      document.body.classList.remove('bi-report-open', 'bi-paper-print');
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle('bi-paper-print', biTheme === 'paper');
  }, [biTheme]);

  const handleRegenerate = async () => {
    if (regenerating) return;
    setRegenerating(true);
    try {
      if (onRegenerate) {
        await onRegenerate();
      } else if (token) {
        await emitAck('admin:watch', { token, pin: token });
      }
      setGeneratedAt(formatLocalDateTime(new Date()));
      notify?.({
        type: 'ok',
        text: '🔄 Laporan Executive BI berhasil di-regenerate dari data server terbaru.',
      });
    } finally {
      setRegenerating(false);
    }
  };

  const report = useMemo(() => {
    const totalMatches = matches.length;
    const finishedMatches = matches.filter((m) => m.session_management?.status === 'finished');
    const liveMatches = matches.filter((m) => m.session_management?.status === 'in_progress');
    const scheduledMatches = matches.filter(
      (m) => m.session_management?.status === 'scheduled' || m.session_management?.status === 'locked'
    );
    const completionPct = totalMatches > 0 ? Math.round((finishedMatches.length / totalMatches) * 100) : 0;

    let totalSets = 0;
    let totalPoints = 0;
    let totalRallies = 0;
    let totalCock = 0;
    let totalDurationSec = 0;
    let durationCount = 0;
    let longestMatch = null;
    let fastestMatch = null;
    let highestCockMatch = null;
    let rubberSetCount = 0;
    let straightSetCount = 0;
    let continuousCount = 0;

    const durationBuckets = [
      { label: '< 15 mnt', min: 0, max: 15 * 60, count: 0 },
      { label: '15–25 mnt', min: 15 * 60, max: 25 * 60, count: 0 },
      { label: '25–35 mnt', min: 25 * 60, max: 35 * 60, count: 0 },
      { label: '35–45 mnt', min: 35 * 60, max: 45 * 60, count: 0 },
      { label: '> 45 mnt', min: 45 * 60, max: Infinity, count: 0 },
    ];

    const categoryMap = new Map();
    const clubMap = new Map();
    const courtMap = new Map();
    const refereeMap = new Map();
    const allCards = [];
    const dateSet = new Set();

    const ensureClub = (clubName) => {
      const key = (clubName || 'Independen / Tanpa Klub').trim();
      if (!clubMap.has(key)) {
        clubMap.set(key, {
          club: key,
          matchesPlayed: 0,
          wins: 0,
          losses: 0,
          setsWon: 0,
          setsLost: 0,
          pointsWon: 0,
          pointsLost: 0,
          titles: 0,
          runnerUps: 0,
        });
      }
      return clubMap.get(key);
    };

    for (const m of matches) {
      const st = m.live_state || {};
      const sm = m.session_management || {};
      const isFin = sm.status === 'finished' || st.phase === 'finished';
      if (m.scheduled_date) dateSet.add(m.scheduled_date);

      const cock = Number(st.shuttlecock_count) || 0;
      totalCock += cock;
      if (cock > 0 && (!highestCockMatch || cock > (highestCockMatch.live_state?.shuttlecock_count || 0))) {
        highestCockMatch = m;
      }

      const ralliesLen = Array.isArray(st.rally_history) ? st.rally_history.length : 0;
      totalRallies += ralliesLen;

      const setHist =
        Array.isArray(st.set_history) && st.set_history.length > 0
          ? st.set_history
          : isFin
          ? [{ set: 1, a: st.score?.a || 0, b: st.score?.b || 0, winner: st.winner || 'a' }]
          : [];
      totalSets += setHist.length;
      if (isFin) {
        if (m.rules?.scoring_type === 'continuous') continuousCount += 1;
        else if (setHist.length >= 3) rubberSetCount += 1;
        else if (setHist.length > 0) straightSetCount += 1;
      }

      const ptsA = setHist.reduce((acc, s) => acc + (Number(s.a) || 0), 0);
      const ptsB = setHist.reduce((acc, s) => acc + (Number(s.b) || 0), 0);
      totalPoints += ptsA + ptsB;

      const durSec = matchDurationSec(m, now);
      if (isFin && durSec !== null && durSec > 0) {
        totalDurationSec += durSec;
        durationCount += 1;
        if (!longestMatch || durSec > longestMatch.durSec) longestMatch = { match: m, durSec };
        if (!fastestMatch || durSec < fastestMatch.durSec) fastestMatch = { match: m, durSec };
        const bkt = durationBuckets.find((b) => durSec >= b.min && durSec < b.max);
        if (bkt) bkt.count += 1;
      }

      if (Array.isArray(st.cards)) {
        for (const c of st.cards) {
          allCards.push({
            ...c,
            match_number: m.match_number,
            category_name: m.category_name,
            discipline: m.discipline,
            court_number: m.court_number,
            referee_name: sm.controller_label || '-',
          });
        }
      }

      const catKey = `${m.category_name || 'Umum'}||${m.discipline || 'MD'}`;
      if (!categoryMap.has(catKey)) {
        categoryMap.set(catKey, {
          key: catKey,
          category_name: m.category_name || 'Umum',
          discipline: m.discipline || '-',
          discipline_label: DISCIPLINE_LABEL[m.discipline] || m.discipline || '-',
          total: 0,
          finished: 0,
          cock: 0,
          rallies: 0,
          durationSec: 0,
          matches: [],
        });
      }
      const catObj = categoryMap.get(catKey);
      catObj.total += 1;
      catObj.cock += cock;
      catObj.rallies += ralliesLen;
      if (isFin) {
        catObj.finished += 1;
        if (durSec) catObj.durationSec += durSec;
      }
      catObj.matches.push(m);

      const cNo = m.court_number || 1;
      if (!courtMap.has(cNo)) {
        courtMap.set(cNo, { court: cNo, total: 0, finished: 0, live: 0, cock: 0, durationSec: 0, rallies: 0 });
      }
      const crt = courtMap.get(cNo);
      crt.total += 1;
      crt.cock += cock;
      crt.rallies += ralliesLen;
      if (isFin) {
        crt.finished += 1;
        if (durSec) crt.durationSec += durSec;
      } else if (sm.status === 'in_progress') {
        crt.live += 1;
      }

      const refName = (sm.controller_label || '').trim();
      if (refName) {
        if (!refereeMap.has(refName)) {
          refereeMap.set(refName, {
            name: refName,
            matches: 0,
            finished: 0,
            durationSec: 0,
            cock: 0,
            yellowCards: 0,
            redCards: 0,
            blackCards: 0,
          });
        }
        const rf = refereeMap.get(refName);
        rf.matches += 1;
        if (isFin) rf.finished += 1;
        if (durSec) rf.durationSec += durSec;
        rf.cock += cock;
        if (Array.isArray(st.cards)) {
          rf.yellowCards += st.cards.filter((c) => c.type === 'yellow').length;
          rf.redCards += st.cards.filter((c) => c.type === 'red').length;
          rf.blackCards += st.cards.filter((c) => c.type === 'black').length;
        }
      }

      if (isFin && (st.winner === 'a' || st.winner === 'b')) {
        const winSide = st.winner;
        const clubA = ensureClub(m.teams?.team_a?.club);
        const clubB = ensureClub(m.teams?.team_b?.club);

        clubA.matchesPlayed += 1;
        clubB.matchesPlayed += 1;
        if (winSide === 'a') {
          clubA.wins += 1;
          clubB.losses += 1;
        } else {
          clubB.wins += 1;
          clubA.losses += 1;
        }
        const sA = setHist.filter((s) => s.winner === 'a').length || (winSide === 'a' ? 1 : 0);
        const sB = setHist.filter((s) => s.winner === 'b').length || (winSide === 'b' ? 1 : 0);
        clubA.setsWon += sA;
        clubA.setsLost += sB;
        clubB.setsWon += sB;
        clubB.setsLost += sA;
        clubA.pointsWon += ptsA;
        clubA.pointsLost += ptsB;
        clubB.pointsWon += ptsB;
        clubB.pointsLost += ptsA;
      }
    }

    const categories = Array.from(categoryMap.values()).map((c) => {
      const finList = c.matches
        .filter((m) => m.session_management?.status === 'finished')
        .sort(
          (x, y) =>
            (x.finished_at || x.updated_at || '').localeCompare(y.finished_at || y.updated_at || '') ||
            cmpStr(x.match_number, y.match_number)
        );
      const lastFin = finList[finList.length - 1] || null;
      let champion = null;
      let runnerUp = null;
      let finalMatch = null;
      if (lastFin && (lastFin.live_state?.winner === 'a' || lastFin.live_state?.winner === 'b')) {
        const w = lastFin.live_state.winner;
        const l = w === 'a' ? 'b' : 'a';
        const fSt = lastFin.live_state || {};
        const fSm = lastFin.session_management || {};
        const fSets = Array.isArray(fSt.set_history) && fSt.set_history.length > 0
          ? fSt.set_history
          : [{ set: 1, a: fSt.score?.a || 0, b: fSt.score?.b || 0, winner: w }];
        const fScoreStr = fSets.map((s) => `${s.a}-${s.b}`).join(', ');
        const fTotalPts = fSets.reduce((acc, s) => acc + (Number(s.a) || 0) + (Number(s.b) || 0), 0);
        const fCards = Array.isArray(fSt.cards) ? fSt.cards : [];
        champion = {
          name: teamLabel(lastFin, w),
          club: lastFin.teams?.[`team_${w}`]?.club || '-',
          match_number: lastFin.match_number,
          score: fScoreStr,
        };
        runnerUp = {
          name: teamLabel(lastFin, l),
          club: lastFin.teams?.[`team_${l}`]?.club || '-',
        };
        finalMatch = {
          match: lastFin,
          match_number: lastFin.match_number,
          court: lastFin.court_number || '-',
          score: fScoreStr,
          duration: matchDurationText(lastFin, now) || '-',
          cock: fSt.shuttlecock_count ?? 0,
          rallies: Array.isArray(fSt.rally_history) ? fSt.rally_history.length : 0,
          totalPoints: fTotalPts,
          referee: fSm.controller_label || '-',
          cards: fCards,
          winnerSide: w,
        };
        if (c.finished === c.total && c.total > 0) {
          const chClub = ensureClub(lastFin.teams?.[`team_${w}`]?.club);
          const ruClub = ensureClub(lastFin.teams?.[`team_${l}`]?.club);
          chClub.titles += 1;
          ruClub.runnerUps += 1;
        }
      }
      return {
        ...c,
        champion,
        runnerUp,
        finalMatch,
      };
    });

    const clubs = Array.from(clubMap.values()).sort(
      (a, b) =>
        b.titles - a.titles ||
        b.wins - a.wins ||
        b.setsWon - b.setsLost - (a.setsWon - a.setsLost) ||
        b.pointsWon - b.pointsLost - (a.pointsWon - a.pointsLost)
    );

    const courts = Array.from(courtMap.values()).sort((a, b) => a.court - b.court);
    const referees = Array.from(refereeMap.values()).sort((a, b) => b.matches - a.matches || b.durationSec - a.durationSec);
    const cleanMatches = Math.max(0, finishedMatches.length - new Set(allCards.map((c) => c.match_number)).size);
    const fairPlayPct = finishedMatches.length > 0 ? Math.round((cleanMatches / finishedMatches.length) * 100) : 100;

    return {
      totalMatches,
      finishedCount: finishedMatches.length,
      liveCount: liveMatches.length,
      scheduledCount: scheduledMatches.length,
      completionPct,
      totalSets,
      rubberSetCount,
      straightSetCount,
      continuousCount,
      totalPoints,
      totalRallies,
      avgRalliesPerMatch: finishedMatches.length > 0 ? (totalRallies / finishedMatches.length).toFixed(1) : '0.0',
      totalCock,
      avgCockPerMatch: finishedMatches.length > 0 ? (totalCock / finishedMatches.length).toFixed(1) : '0.0',
      totalDurationSec,
      avgDurationSec: durationCount > 0 ? Math.round(totalDurationSec / durationCount) : null,
      longestMatch,
      fastestMatch,
      highestCockMatch,
      durationBuckets,
      categories,
      clubs,
      courts,
      referees,
      allCards,
      fairPlayPct,
      dates: Array.from(dateSet),
    };
  }, [matches, now]);

  const isClosed = profile?.status === 'closed';
  const filteredMatches = useMemo(() => {
    const q = matchSearch.trim().toLowerCase();
    return matches.filter((m) => {
      const st = m.session_management?.status || 'scheduled';
      if (matchStatusFilter !== 'all' && st !== matchStatusFilter) return false;
      if (matchCatFilter !== 'all' && `${m.category_name}||${m.discipline}` !== matchCatFilter) return false;
      if (!q) return true;
      const hay = [
        m.match_number,
        m.category_name,
        m.discipline,
        teamLabel(m, 'a'),
        teamLabel(m, 'b'),
        m.teams?.team_a?.club,
        m.teams?.team_b?.club,
        m.session_management?.controller_label,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [matches, matchSearch, matchStatusFilter, matchCatFilter]);

  // Helper for SVG Donut geometry
  const donutSegments = (items, radius = 48) => {
    const circ = 2 * Math.PI * radius;
    const sum = items.reduce((a, b) => a + b.value, 0) || 1;
    let offset = 0;
    return items.map((it) => {
      const len = (it.value / sum) * circ;
      const seg = { ...it, dasharray: `${len} ${circ - len}`, dashoffset: -offset };
      offset += len;
      return seg;
    });
  };

  const statusDonut = donutSegments([
    { label: 'Selesai', value: report.finishedCount, color: '#22c55e' },
    { label: 'Live', value: report.liveCount, color: '#38bdf8' },
    { label: 'Terjadwal', value: report.scheduledCount, color: '#64748b' },
  ]);

  const formatDonut = donutSegments([
    { label: 'Straight (2 Set)', value: report.straightSetCount, color: '#38bdf8' },
    { label: 'Rubber (3 Set)', value: report.rubberSetCount, color: '#facc15' },
    { label: 'Continuous', value: report.continuousCount, color: '#a855f7' },
  ]);

  const maxCourtMatches = Math.max(1, ...report.courts.map((c) => c.total));
  const maxCourtCock = Math.max(1, ...report.courts.map((c) => c.cock));
  const maxBucketCount = Math.max(1, ...report.durationBuckets.map((b) => b.count));
  const maxClubWins = Math.max(1, ...report.clubs.map((c) => c.wins));
  const topClubs = report.clubs.slice(0, 8);

  return (
    <div className={`bi-overlay ${biTheme === 'paper' ? 'bi-theme-paper' : 'bi-theme-dark'}`} onClick={onClose}>
      <div className="bi-shell" onClick={(e) => e.stopPropagation()}>
        {/* Sticky Executive Toolbar */}
        <div className="bi-toolbar tr-no-print">
          <div className="bi-toolbar-left">
            <span className="bi-brand-pill">SMASHPOINT BI</span>
            <span className={`badge ${isClosed ? 'gold' : 'green'}`}>
              {isClosed ? '🏁 CLOSED (FINAL)' : '🟢 ACTIVE'}
            </span>
            <span className="bi-gen-time">
              Terakhir di-generate: <b className="mono">{generatedAt}</b>
            </span>
          </div>
          <div className="bi-toolbar-actions">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={regenerating}
              onClick={handleRegenerate}
              title="Hitung ulang & tarik data server terbaru (dapat dijalankan kapan saja meskipun turnamen sudah Closed)"
            >
              {regenerating ? '⏳ Generating…' : '🔄 Re-generate Laporan'}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setBiTheme((t) => (t === 'dark' ? 'paper' : 'dark'))}
              title="Ganti tampilan antara Executive Dark BI dan Executive Paper (Putih / Siap Cetak)"
            >
              {biTheme === 'dark' ? '☀️ Executive Paper' : '🌙 Executive Dark'}
            </button>
            {!isClosed && (
              <button
                type="button"
                className="btn btn-sm btn-green"
                onClick={() => {
                  onClose();
                  onOpenCloseModal?.();
                }}
              >
                🏁 Closing Turnamen
              </button>
            )}
            <a className="btn btn-sm" href="/api/export/results.csv">
              ⬇ CSV
            </a>
            <button type="button" className="btn btn-sm btn-yellow" onClick={() => window.print()}>
              🖨️ Cetak / PDF
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
              ✕ Tutup
            </button>
          </div>
        </div>

        {/* Executive Masthead Banner */}
        <header className="bi-masthead">
          <div className="bi-masthead-main">
            <div className="bi-eyebrow">EXECUTIVE TOURNAMENT INTELLIGENCE &amp; PERFORMANCE REPORT</div>
            <h1 className="bi-title">{profile?.name || 'Turnamen Utama'}</h1>
            {profile?.description && <p className="bi-subtitle">{profile.description}</p>}
            <p className="bi-narrative">
              Laporan ini merangkum <b>{report.totalMatches} pertandingan</b> pada <b>{report.categories.length} kategori</b> yang diikuti oleh <b>{report.clubs.length} klub/PB</b>, dengan tingkat penyelesaian <b>{report.completionPct}%</b> ({report.finishedCount} selesai), total <b>{report.totalRallies.toLocaleString('id-ID')} reli</b>, konsumsi <b>{report.totalCock} shuttlecock</b>, dan indeks sportivitas Fair Play <b>{report.fairPlayPct}%</b>.
            </p>
          </div>
          <div className="bi-masthead-meta">
            <div className="bi-meta-row">
              <span>Status Turnamen</span>
              <b>{isClosed ? '🏁 Selesai & Ditutup Resmi' : '🟢 Aktif Berlangsung'}</b>
            </div>
            <div className="bi-meta-row">
              <span>Tanggal Pelaksanaan</span>
              <b>{report.dates.length > 0 ? report.dates.join(' — ') : '-'}</b>
            </div>
            <div className="bi-meta-row">
              <span>Venue / GOR</span>
              <b>{profile?.venue || '-'}</b>
            </div>
            <div className="bi-meta-row">
              <span>Referee Utama</span>
              <b>{profile?.chief_referee || '-'}</b>
            </div>
            <div className="bi-meta-row">
              <span>Ketua Panitia</span>
              <b>{profile?.committee_head || '-'}</b>
            </div>
            <div className="bi-meta-row">
              <span>Report Generated</span>
              <b className="mono">{generatedAt}</b>
            </div>
          </div>
        </header>

        {/* Section Filter Tabs */}
        <nav className="bi-tabs tr-no-print">
          {[
            ['all', '📊 Executive Overview (Lengkap)'],
            ['analytics', '📈 Visual Analytics & Grafik'],
            ['champions', '🏆 Podium Juara & Klasemen Klub'],
            ['logistics', '🏟️ Operasional Lapangan, Wasit & Fair Play'],
            ['matches', `📋 Register Pertandingan (${matches.length})`],
          ].map(([id, lbl]) => (
            <button
              key={id}
              type="button"
              className={`bi-tab ${reportTab === id ? 'active' : ''}`}
              onClick={() => setReportTab(id)}
            >
              {lbl}
            </button>
          ))}
        </nav>

        {/* Closing Notes / Berita Acara */}
        {profile?.closing_notes && (
          <div className="bi-closing-note">
            <div className="bi-closing-note-title">📜 BERITA ACARA &amp; CATATAN PENUTUPAN RESMI</div>
            <div className="bi-closing-note-body">{profile.closing_notes}</div>
            {profile?.closed_at && (
              <div className="bi-closing-note-foot">
                Disahkan pada <span className="mono">{formatLocalDateTime(profile.closed_at)}</span> oleh <b>@{profile.closed_by || 'admin'}</b>
              </div>
            )}
          </div>
        )}

        {/* 1. EXECUTIVE KPI SCORECARD (6 CARDS) */}
        <section className="bi-kpi-grid">
          <div className="bi-kpi-card accent-emerald">
            <div className="bi-kpi-top">
              <span>TINGKAT PENYELESAIAN</span>
              <span className="bi-kpi-pill">{report.completionPct}%</span>
            </div>
            <div className="bi-kpi-val mono">
              {report.finishedCount} <small>/ {report.totalMatches} Laga</small>
            </div>
            <div className="bi-progress-track">
              <div className="bi-progress-fill emerald" style={{ width: `${report.completionPct}%` }} />
            </div>
            <div className="bi-kpi-sub">{report.liveCount} Live · {report.scheduledCount} Antre</div>
          </div>

          <div className="bi-kpi-card accent-cyan">
            <div className="bi-kpi-top">
              <span>TOTAL SET &amp; RUBBER GAME</span>
              <span className="bi-kpi-pill">{report.totalSets} Set</span>
            </div>
            <div className="bi-kpi-val mono">
              {report.rubberSetCount} <small>Rubber (3 Set)</small>
            </div>
            <div className="bi-progress-track">
              <div
                className="bi-progress-fill cyan"
                style={{
                  width: `${report.finishedCount > 0 ? Math.min(100, Math.round((report.rubberSetCount / report.finishedCount) * 100)) : 0}%`,
                }}
              />
            </div>
            <div className="bi-kpi-sub">{report.straightSetCount} Straight Set · {report.continuousCount} Continuous</div>
          </div>

          <div className="bi-kpi-card accent-blue">
            <div className="bi-kpi-top">
              <span>INTENSITAS RELI &amp; POIN</span>
              <span className="bi-kpi-pill">~{report.avgRalliesPerMatch}/laga</span>
            </div>
            <div className="bi-kpi-val mono">{report.totalRallies.toLocaleString('id-ID')} <small>Reli</small></div>
            <div className="bi-kpi-sub">{report.totalPoints.toLocaleString('id-ID')} total poin tercetak</div>
          </div>

          <div className="bi-kpi-card accent-purple">
            <div className="bi-kpi-top">
              <span>TOTAL JAM BERMAIN</span>
              <span className="bi-kpi-pill">Avg {report.avgDurationSec ? formatDuration(report.avgDurationSec) : '-'}</span>
            </div>
            <div className="bi-kpi-val mono">{formatDuration(report.totalDurationSec) || '00:00'}</div>
            <div className="bi-kpi-sub">Akumulasi durasi efektif lapangan</div>
          </div>

          <div className="bi-kpi-card accent-gold">
            <div className="bi-kpi-top">
              <span>LOGISTIK SHUTTLECOCK</span>
              <span className="bi-kpi-pill">~{report.avgCockPerMatch}/laga</span>
            </div>
            <div className="bi-kpi-val mono">🏸 {report.totalCock} <small>Cock</small></div>
            <div className="bi-kpi-sub">
              Estimasi {Math.ceil(report.totalCock / 12)} slop (isi 12) terpakai
            </div>
          </div>

          <div className="bi-kpi-card accent-rose">
            <div className="bi-kpi-top">
              <span>INDEKS FAIR PLAY (BWF)</span>
              <span className="bi-kpi-pill">{report.fairPlayPct}% Bersih</span>
            </div>
            <div className="bi-kpi-val mono">{report.allCards.length} <small>Kartu</small></div>
            <div className="bi-kpi-sub">
              🟨 {report.allCards.filter((c) => c.type === 'yellow').length} · 🟥 {report.allCards.filter((c) => c.type === 'red').length} · ⬛ {report.allCards.filter((c) => c.type === 'black').length}
            </div>
          </div>
        </section>

        {/* 2. VISUAL BI CHARTS GRID */}
        {(reportTab === 'all' || reportTab === 'analytics') && (
          <section className="bi-charts-grid">
            {/* Chart 1: Dual Donut Charts (Status & Set Format) */}
            <div className="bi-card">
              <div className="bi-card-head">
                <div>
                  <h3>Komposisi Progres &amp; Format Set</h3>
                  <p>Distribusi status pertandingan dan intensitas rubber game</p>
                </div>
              </div>
              <div className="bi-donuts-pair">
                <div className="bi-donut-box">
                  <svg viewBox="0 0 120 120" className="bi-donut-svg">
                    <circle cx="60" cy="60" r="48" className="bi-donut-track" />
                    {statusDonut.map((seg) => (
                      <circle
                        key={seg.label}
                        cx="60"
                        cy="60"
                        r="48"
                        fill="none"
                        stroke={seg.color}
                        strokeWidth="13"
                        strokeDasharray={seg.dasharray}
                        strokeDashoffset={seg.dashoffset}
                        transform="rotate(-90 60 60)"
                      />
                    ))}
                    <text x="60" y="57" textAnchor="middle" className="bi-donut-center-val">
                      {report.completionPct}%
                    </text>
                    <text x="60" y="72" textAnchor="middle" className="bi-donut-center-lbl">
                      SELESAI
                    </text>
                  </svg>
                  <div className="bi-legend">
                    {statusDonut.map((s) => (
                      <div key={s.label} className="bi-legend-row">
                        <span className="bi-dot" style={{ background: s.color }} />
                        <span>{s.label}</span>
                        <b className="mono">{s.value}</b>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bi-donut-box">
                  <svg viewBox="0 0 120 120" className="bi-donut-svg">
                    <circle cx="60" cy="60" r="48" className="bi-donut-track" />
                    {formatDonut.map((seg) => (
                      <circle
                        key={seg.label}
                        cx="60"
                        cy="60"
                        r="48"
                        fill="none"
                        stroke={seg.color}
                        strokeWidth="13"
                        strokeDasharray={seg.dasharray}
                        strokeDashoffset={seg.dashoffset}
                        transform="rotate(-90 60 60)"
                      />
                    ))}
                    <text x="60" y="57" textAnchor="middle" className="bi-donut-center-val">
                      {report.finishedCount}
                    </text>
                    <text x="60" y="72" textAnchor="middle" className="bi-donut-center-lbl">
                      LAGA FINAL
                    </text>
                  </svg>
                  <div className="bi-legend">
                    {formatDonut.map((s) => (
                      <div key={s.label} className="bi-legend-row">
                        <span className="bi-dot" style={{ background: s.color }} />
                        <span>{s.label}</span>
                        <b className="mono">{s.value}</b>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Chart 2: Duration Histogram */}
            <div className="bi-card">
              <div className="bi-card-head">
                <div>
                  <h3>Distribusi Durasi Pertandingan</h3>
                  <p>Sebaran lama pertandingan selesai (rata-rata: {report.avgDurationSec ? formatDuration(report.avgDurationSec) : '-'})</p>
                </div>
              </div>
              <div className="bi-histogram">
                {report.durationBuckets.map((b) => {
                  const pct = Math.round((b.count / maxBucketCount) * 100);
                  return (
                    <div key={b.label} className="bi-hist-col">
                      <div className="bi-hist-val mono">{b.count}</div>
                      <div className="bi-hist-track">
                        <div className="bi-hist-bar" style={{ height: `${Math.max(b.count > 0 ? 10 : 0, pct)}%` }} />
                      </div>
                      <div className="bi-hist-lbl">{b.label}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Chart 3: Court Utilization & Cock Consumption */}
            <div className="bi-card bi-card-wide">
              <div className="bi-card-head">
                <div>
                  <h3>Utilisasi Lapangan &amp; Konsumsi Shuttlecock</h3>
                  <p>Perbandingan jumlah pertandingan (biru) dan penggunaan shuttlecock (emas) per lapangan</p>
                </div>
                <div className="bi-inline-legend">
                  <span><i className="bi-dot" style={{ background: '#38bdf8' }} /> Pertandingan</span>
                  <span><i className="bi-dot" style={{ background: '#facc15' }} /> Shuttlecock</span>
                </div>
              </div>
              <div className="bi-hbar-list">
                {report.courts.map((c) => (
                  <div key={c.court} className="bi-hbar-item">
                    <div className="bi-hbar-label">
                      <b>Lapangan {c.court}</b>
                      <span className="mono muted">{c.finished}/{c.total} laga · {formatDuration(c.durationSec) || '00:00'}</span>
                    </div>
                    <div className="bi-hbar-tracks">
                      <div className="bi-hbar-row">
                        <div className="bi-hbar-fill cyan" style={{ width: `${Math.max(4, Math.round((c.total / maxCourtMatches) * 100))}%` }} />
                        <span className="mono">{c.total} laga</span>
                      </div>
                      <div className="bi-hbar-row">
                        <div className="bi-hbar-fill gold" style={{ width: `${Math.max(c.cock > 0 ? 4 : 0, Math.round((c.cock / maxCourtCock) * 100))}%` }} />
                        <span className="mono">🏸 {c.cock} cock</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Highlight Records Cards (Zero Truncation) */}
        {(report.longestMatch || report.fastestMatch || report.highestCockMatch) && (
          <section className="bi-records-grid">
            {report.longestMatch && (
              <div
                className="bi-record-card clickable"
                onClick={() => onSelectMatch?.(report.longestMatch.match)}
                title="Klik untuk membuka Detail & Histori Reli lengkap"
              >
                <div className="bi-record-badge cyan">⏳ PARTAI MARATHON TERLAMA</div>
                <div className="bi-record-val mono">{formatDuration(report.longestMatch.durSec)}</div>
                <div className="bi-record-match">
                  <b>{report.longestMatch.match.match_number}</b> · {report.longestMatch.match.category_name} ({report.longestMatch.match.discipline})
                </div>
                <div className="bi-record-players">
                  {teamLabel(report.longestMatch.match, 'a')} <span className="muted">vs</span> {teamLabel(report.longestMatch.match, 'b')}
                </div>
              </div>
            )}
            {report.fastestMatch && (
              <div
                className="bi-record-card clickable"
                onClick={() => onSelectMatch?.(report.fastestMatch.match)}
                title="Klik untuk membuka Detail & Histori Reli lengkap"
              >
                <div className="bi-record-badge emerald">⚡ PARTAI TERCEPAT</div>
                <div className="bi-record-val mono">{formatDuration(report.fastestMatch.durSec)}</div>
                <div className="bi-record-match">
                  <b>{report.fastestMatch.match.match_number}</b> · {report.fastestMatch.match.category_name} ({report.fastestMatch.match.discipline})
                </div>
                <div className="bi-record-players">
                  {teamLabel(report.fastestMatch.match, 'a')} <span className="muted">vs</span> {teamLabel(report.fastestMatch.match, 'b')}
                </div>
              </div>
            )}
            {report.highestCockMatch && (
              <div
                className="bi-record-card clickable"
                onClick={() => report.highestCockMatch.session_management?.status === 'finished' && onSelectMatch?.(report.highestCockMatch)}
              >
                <div className="bi-record-badge gold">🏸 KONSUMSI COCK TERTINGGI</div>
                <div className="bi-record-val mono">{report.highestCockMatch.live_state?.shuttlecock_count || 0} Cock</div>
                <div className="bi-record-match">
                  <b>{report.highestCockMatch.match_number}</b> · {report.highestCockMatch.category_name} ({report.highestCockMatch.discipline})
                </div>
                <div className="bi-record-players">
                  {teamLabel(report.highestCockMatch, 'a')} <span className="muted">vs</span> {teamLabel(report.highestCockMatch, 'b')}
                </div>
              </div>
            )}
          </section>
        )}

        {/* 3. PODIUM JUARA & HASIL PER KATEGORI (CARDS — ZERO NAME TRUNCATION) */}
        {(reportTab === 'all' || reportTab === 'champions') && (
          <section className="bi-card">
            <div className="bi-card-head">
              <div>
                <h3>🏆 Podium Juara &amp; Ringkasan Per Kategori ({report.categories.length} Kategori)</h3>
                <p>Nama lengkap seluruh pasangan pemenang, runner-up, klub asal, dan skor pertandingan puncak</p>
              </div>
            </div>
            <div className="bi-podium-grid">
              {report.categories.map((cat) => {
                const catPct = cat.total > 0 ? Math.round((cat.finished / cat.total) * 100) : 0;
                return (
                  <div key={cat.key} className="bi-podium-card">
                    <div className="bi-podium-head">
                      <div>
                        <div className="bi-podium-cat">{cat.category_name}</div>
                        <div className="bi-podium-disc">
                          <span className="badge blue">{cat.discipline}</span> {cat.discipline_label}
                        </div>
                      </div>
                      <span className={`badge ${catPct === 100 ? 'green' : 'gold'}`}>
                        {cat.finished}/{cat.total} ({catPct}%)
                      </span>
                    </div>

                    <div className="bi-podium-slots">
                      <div className="bi-podium-slot winner">
                        <div className="bi-slot-rank">🏆 JUARA / PEMENANG</div>
                        {cat.champion ? (
                          <>
                            <div className="bi-slot-name">{cat.champion.name}</div>
                            <div className="bi-slot-meta">
                              <span>🏛️ {cat.champion.club}</span>
                              <span className="mono">{cat.champion.match_number} ({cat.champion.score})</span>
                            </div>
                          </>
                        ) : (
                          <div className="bi-slot-empty">Menunggu partai selesai</div>
                        )}
                      </div>

                      <div className="bi-podium-slot runnerup">
                        <div className="bi-slot-rank">🥈 RUNNER-UP</div>
                        {cat.runnerUp ? (
                          <>
                            <div className="bi-slot-name">{cat.runnerUp.name}</div>
                            <div className="bi-slot-meta">
                              <span>🏛️ {cat.runnerUp.club}</span>
                            </div>
                          </>
                        ) : (
                          <div className="bi-slot-empty">-</div>
                        )}
                      </div>
                    </div>

                    {cat.finalMatch && (
                      <div
                        className="bi-final-summary clickable"
                        onClick={() => onSelectMatch?.(cat.finalMatch.match)}
                        title="Klik untuk membuka Detail & Histori Reli Partai Puncak ini"
                      >
                        <div className="bi-final-head">
                          <span>📌 <b>Ringkasan Partai Final ({cat.finalMatch.match_number})</b> · Lap. {cat.finalMatch.court}</span>
                          <span className="bi-final-link tr-no-print">Detail Reli ↗</span>
                        </div>
                        <div className="bi-final-grid">
                          <div><span>Skor Set</span><b className="mono">{cat.finalMatch.score}</b></div>
                          <div><span>Durasi</span><b className="mono">{cat.finalMatch.duration}</b></div>
                          <div><span>Shuttlecock</span><b className="mono">🏸 {cat.finalMatch.cock}</b></div>
                          <div><span>Reli &amp; Poin</span><b className="mono">{cat.finalMatch.rallies} ({cat.finalMatch.totalPoints} pts)</b></div>
                          <div><span>Wasit</span><b>👤 {cat.finalMatch.referee}</b></div>
                          <div>
                            <span>Kartu BWF</span>
                            <b>
                              {cat.finalMatch.cards.length > 0
                                ? cat.finalMatch.cards.map((c) => (c.type === 'yellow' ? '🟨' : c.type === 'red' ? '🟥' : '⬛')).join(' ')
                                : 'Bersih'}
                            </b>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="bi-podium-foot mono">
                      <span>Total Kategori:</span>
                      <span>🔥 {cat.rallies} Reli</span>
                      <span>🏸 {cat.cock} Cock</span>
                      <span>⏱ {formatDuration(cat.durationSec) || '-'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* 4. CLUB / PB PERFORMANCE CHART & LEADERBOARD */}
        {(reportTab === 'all' || reportTab === 'champions' || reportTab === 'analytics') && report.clubs.length > 0 && (
          <section className="bi-card">
            <div className="bi-card-head">
              <div>
                <h3>🏛️ Analisis Performa &amp; Klasemen Klub / PB ({report.clubs.length} Klub)</h3>
                <p>Peringkat berdasarkan gelar juara, jumlah kemenangan, selisih set, dan selisih poin</p>
              </div>
            </div>

            {topClubs.length > 0 && (
              <div className="bi-club-chart">
                {topClubs.map((cl, idx) => {
                  const winPct = cl.matchesPlayed > 0 ? Math.round((cl.wins / cl.matchesPlayed) * 100) : 0;
                  return (
                    <div key={cl.club} className="bi-club-bar-row">
                      <div className="bi-club-bar-name">
                        <span className="mono muted">#{idx + 1}</span> <b>{cl.club}</b>
                      </div>
                      <div className="bi-club-bar-track">
                        <div
                          className="bi-club-bar-fill"
                          style={{ width: `${Math.max(cl.wins > 0 ? 6 : 0, Math.round((cl.wins / maxClubWins) * 100))}%` }}
                        />
                      </div>
                      <div className="bi-club-bar-stat mono">
                        <b>{cl.wins}W</b>-{cl.losses}L ({winPct}%)
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="bi-tbl-wrap">
              <table className="bi-tbl">
                <thead>
                  <tr>
                    <th style={{ width: 64, textAlign: 'center' }}>Rank</th>
                    <th>Nama Klub / PB</th>
                    <th style={{ textAlign: 'center' }}>Main</th>
                    <th style={{ textAlign: 'center' }}>Menang</th>
                    <th style={{ textAlign: 'center' }}>Kalah</th>
                    <th style={{ width: 170 }}>Win Rate</th>
                    <th style={{ textAlign: 'center' }}>Set (W-L)</th>
                    <th style={{ textAlign: 'center' }}>Poin (W-L)</th>
                    <th style={{ textAlign: 'center' }}>Selisih Poin</th>
                  </tr>
                </thead>
                <tbody>
                  {report.clubs.map((cl, idx) => {
                    const winRate = cl.matchesPlayed > 0 ? Math.round((cl.wins / cl.matchesPlayed) * 100) : 0;
                    const diffPts = cl.pointsWon - cl.pointsLost;
                    return (
                      <tr key={cl.club}>
                        <td className="mono" style={{ textAlign: 'center', fontWeight: 900 }}>
                          {idx === 0 ? '🥇 1' : idx === 1 ? '🥈 2' : idx === 2 ? '🥉 3' : idx + 1}
                        </td>
                        <td className="bi-wrap-cell"><b>{cl.club}</b></td>
                        <td className="mono" style={{ textAlign: 'center' }}>{cl.matchesPlayed}</td>
                        <td className="mono" style={{ textAlign: 'center', fontWeight: 800, color: '#22c55e' }}>{cl.wins}</td>
                        <td className="mono" style={{ textAlign: 'center', color: '#f87171' }}>{cl.losses}</td>
                        <td>
                          <div className="bi-winrate-cell">
                            <div className="bi-progress-track">
                              <div className="bi-progress-fill emerald" style={{ width: `${winRate}%` }} />
                            </div>
                            <span className="mono">{winRate}%</span>
                          </div>
                        </td>
                        <td className="mono" style={{ textAlign: 'center' }}>{cl.setsWon} - {cl.setsLost}</td>
                        <td className="mono" style={{ textAlign: 'center' }}>{cl.pointsWon} - {cl.pointsLost}</td>
                        <td className="mono" style={{ textAlign: 'center', fontWeight: 800, color: diffPts >= 0 ? '#22c55e' : '#f87171' }}>
                          {diffPts > 0 ? `+${diffPts}` : diffPts}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* 5. UMPIRE SCORECARD & BWF DISCIPLINARY AUDIT */}
        {(reportTab === 'all' || reportTab === 'logistics') && (
          <div className="bi-two-col">
            <section className="bi-card">
              <div className="bi-card-head">
                <div>
                  <h3>⚖️ Beban Tugas &amp; Kinerja Wasit ({report.referees.length})</h3>
                  <p>Distribusi partai yang dipimpin, durasi, cock, dan kartu</p>
                </div>
              </div>
              {report.referees.length > 0 ? (
                <div className="bi-tbl-wrap">
                  <table className="bi-tbl">
                    <thead>
                      <tr>
                        <th>Nama Wasit</th>
                        <th style={{ textAlign: 'center' }}>Laga</th>
                        <th style={{ textAlign: 'center' }}>Durasi</th>
                        <th style={{ textAlign: 'center' }}>Cock</th>
                        <th style={{ textAlign: 'center' }}>Kartu</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.referees.map((rf) => (
                        <tr key={rf.name}>
                          <td className="bi-wrap-cell"><b>👤 {rf.name}</b></td>
                          <td className="mono" style={{ textAlign: 'center' }}>{rf.finished}/{rf.matches}</td>
                          <td className="mono" style={{ textAlign: 'center' }}>{formatDuration(rf.durationSec) || '00:00'}</td>
                          <td className="mono" style={{ textAlign: 'center' }}>🏸 {rf.cock}</td>
                          <td className="mono" style={{ textAlign: 'center' }}>
                            {rf.yellowCards + rf.redCards + rf.blackCards > 0
                              ? `${rf.yellowCards > 0 ? `🟨${rf.yellowCards} ` : ''}${rf.redCards > 0 ? `🟥${rf.redCards} ` : ''}${rf.blackCards > 0 ? `⬛${rf.blackCards}` : ''}`
                              : '0'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="bi-empty-box">Belum ada data wasit yang tercatat.</div>
              )}
            </section>

            <section className="bi-card">
              <div className="bi-card-head">
                <div>
                  <h3>🟨🟥 Audit Disiplin BWF Law 16 / PBSI</h3>
                  <p>Catatan pelanggaran resmi Kartu Kuning, Merah, dan Hitam</p>
                </div>
              </div>
              {report.allCards.length > 0 ? (
                <div className="bi-tbl-wrap">
                  <table className="bi-tbl">
                    <thead>
                      <tr>
                        <th>Match</th>
                        <th>Kartu</th>
                        <th>Pemain / Klub</th>
                        <th>Set &amp; Skor</th>
                        <th>Alasan &amp; Wasit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.allCards.map((c, idx) => (
                        <tr key={`${c.match_number}-c-${idx}`}>
                          <td className="mono"><b>{c.match_number}</b></td>
                          <td>
                            <span className={`badge ${c.type === 'yellow' ? 'gold' : 'red'}`}>
                              {c.type === 'yellow' ? '🟨 KUNING' : c.type === 'red' ? '🟥 MERAH' : '⬛ DSQ'}
                            </span>
                          </td>
                          <td className="bi-wrap-cell">
                            <b>{c.player_name}</b>
                            <div className="bi-cell-sub">{c.club || '-'} · Tim {(c.team || '').toUpperCase()}</div>
                          </td>
                          <td className="mono">Set {c.set} ({c.score_after?.a}-{c.score_after?.b})</td>
                          <td className="bi-wrap-cell">
                            <div>{c.reason}</div>
                            <div className="bi-cell-sub">Wasit: {c.referee_name} · {c.timestamp || '-'}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="bi-fairplay-ok">
                  <div style={{ fontSize: '1.5rem' }}>🏅</div>
                  <div>
                    <b>Zero Incident — 100% Fair Play</b>
                    <div className="bi-cell-sub">Tidak ada Kartu Kuning, Kartu Merah, maupun Diskualifikasi sepanjang turnamen.</div>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        {/* 6. COMPLETE MATCH REGISTER (ZERO TRUNCATION FOR PLAYER NAMES) */}
        {(reportTab === 'all' || reportTab === 'matches') && (
          <section className="bi-card">
            <div className="bi-card-head" style={{ flexWrap: 'wrap', gap: '.75rem' }}>
              <div>
                <h3>📋 Register Lengkap Seluruh Pertandingan ({filteredMatches.length} dari {matches.length} Partai)</h3>
                <p>Klik baris pertandingan berstatus selesai untuk membuka detail statistik &amp; histori reli lengkap</p>
              </div>
              <div className="bi-filter-bar tr-no-print">
                <input
                  type="text"
                  className="input"
                  style={{ width: 220 }}
                  placeholder="Cari match / pemain / klub…"
                  value={matchSearch}
                  onChange={(e) => setMatchSearch(e.target.value)}
                />
                <select
                  className="input"
                  value={matchCatFilter}
                  onChange={(e) => setMatchCatFilter(e.target.value)}
                >
                  <option value="all">Semua Kategori</option>
                  {report.categories.map((c) => (
                    <option key={c.key} value={`${c.category_name}||${c.discipline}`}>
                      {c.category_name} ({c.discipline})
                    </option>
                  ))}
                </select>
                <select
                  className="input"
                  value={matchStatusFilter}
                  onChange={(e) => setMatchStatusFilter(e.target.value)}
                >
                  <option value="all">Semua Status</option>
                  <option value="finished">Selesai</option>
                  <option value="in_progress">Live</option>
                  <option value="scheduled">Terjadwal</option>
                </select>
              </div>
            </div>

            <div className="bi-tbl-wrap">
              <table className="bi-tbl bi-tbl-register">
                <thead>
                  <tr>
                    <th style={{ width: 85 }}>Match</th>
                    <th style={{ minWidth: 130 }}>Kategori &amp; Lap.</th>
                    <th style={{ minWidth: 210 }}>Tim A (Pemain &amp; Klub)</th>
                    <th style={{ minWidth: 210 }}>Tim B (Pemain &amp; Klub)</th>
                    <th style={{ minWidth: 145 }}>Pemenang / Status</th>
                    <th style={{ textAlign: 'center', minWidth: 95 }}>Skor Set</th>
                    <th style={{ textAlign: 'center' }}>Reli</th>
                    <th style={{ textAlign: 'center' }}>Durasi</th>
                    <th style={{ textAlign: 'center' }}>Cock</th>
                    <th style={{ minWidth: 115 }}>Wasit</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMatches.map((m) => {
                    const sm = m.session_management || {};
                    const st = m.live_state || {};
                    const isFin = sm.status === 'finished' || st.phase === 'finished';
                    const w = isFin ? st.winner : null;
                    const dur = matchDurationText(m, now);
                    const mCards = Array.isArray(st.cards) ? st.cards : [];
                    const scoreStr = st.set_history?.length
                      ? st.set_history.map((s) => `${s.a}-${s.b}`).join(', ')
                      : sm.status === 'scheduled'
                      ? '-'
                      : `${st.score?.a || 0}-${st.score?.b || 0}`;
                    return (
                      <tr
                        key={m.match_number}
                        className={isFin ? 'bi-row-clickable' : ''}
                        onClick={() => isFin && onSelectMatch?.(m)}
                        title={isFin ? 'Klik untuk melihat Detail Lengkap & Histori Reli pertandingan ini' : ''}
                      >
                        <td className="mono">
                          <b>{m.match_number}</b>
                          {mCards.length > 0 && (
                            <div style={{ marginTop: 2 }}>
                              {mCards.map((c) => (c.type === 'yellow' ? '🟨' : c.type === 'red' ? '🟥' : '⬛')).join('')}
                            </div>
                          )}
                        </td>
                        <td className="bi-wrap-cell">
                          <div><b>{m.category_name}</b> <span className="badge blue">{m.discipline}</span></div>
                          <div className="bi-cell-sub">Lap. {m.court_number} · {[m.scheduled_date, m.scheduled_time].filter(Boolean).join(' ')}</div>
                        </td>
                        <td className={`bi-wrap-cell ${w === 'a' ? 'bi-winner-cell bi-winner-a' : ''}`}>
                          <div className="bi-player-full">{w === 'a' ? '🏆 ' : ''}{teamLabel(m, 'a')}</div>
                          <div className="bi-cell-sub">{m.teams?.team_a?.club || '-'}</div>
                        </td>
                        <td className={`bi-wrap-cell ${w === 'b' ? 'bi-winner-cell bi-winner-b' : ''}`}>
                          <div className="bi-player-full">{w === 'b' ? '🏆 ' : ''}{teamLabel(m, 'b')}</div>
                          <div className="bi-cell-sub">{m.teams?.team_b?.club || '-'}</div>
                        </td>
                        <td className="bi-wrap-cell">
                          {isFin && w ? (
                            <span className={`badge ${w === 'a' ? 'bi-win-badge-a' : 'bi-win-badge-b'}`}>
                              Tim {w.toUpperCase()} Menang
                            </span>
                          ) : (
                            <StatusBadge match={m} />
                          )}
                        </td>
                        <td className="mono" style={{ textAlign: 'center', fontWeight: 800 }}>{scoreStr}</td>
                        <td className="mono" style={{ textAlign: 'center' }}>{st.rally_history?.length || 0}</td>
                        <td className="mono" style={{ textAlign: 'center' }}>{dur || '-'}</td>
                        <td className="mono" style={{ textAlign: 'center' }}>{st.shuttlecock_count ?? 0}</td>
                        <td className="bi-wrap-cell">{sm.controller_label || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function TournamentProfileBar({ token, activeProfile, profiles = [], onSwitched, onOpenCloseModal, onOpenReport, notify }) {
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

  const isClosed = activeProfile?.status === 'closed';

  const handleReopenTournament = async () => {
    if (!activeProfile?.id) return;
    if (!window.confirm(`Buka kembali status turnamen "${activeProfile.name}" menjadi AKTIF BERLANGSUNG?`)) return;
    setBusy(true);
    const r = await api(`/api/admin/profiles/${encodeURIComponent(activeProfile.id)}/reopen`, {
      method: 'POST',
      pin: token,
    });
    setBusy(false);
    if (r.ok) {
      onSwitched?.(r);
      notify({ type: 'ok', text: `🔓 Status turnamen "${activeProfile.name}" kembali AKTIF.` });
    } else {
      notify({ type: 'error', text: r.error || 'Gagal membuka kembali status turnamen' });
    }
  };

  return (
    <div className="card col" style={{ borderColor: isClosed ? 'rgba(34, 197, 94, 0.55)' : 'rgba(250, 204, 21, 0.45)', background: 'linear-gradient(180deg, #132247 0%, #0b152c 100%)' }}>
      <div className="row">
        <div className="row" style={{ gap: '.55rem' }}>
          <span className="badge gold" style={{ fontSize: '.82rem', padding: '.28rem .7rem' }}>
            🏆 PROFIL TURNAMEN AKTIF
          </span>
          <strong style={{ fontSize: '1.15rem', color: '#fff' }}>
            {activeProfile?.name || 'Turnamen Utama'}
          </strong>
          <span className={`badge ${isClosed ? 'gold' : 'green'}`}>
            {isClosed ? '🏁 STATUS: SELESAI (CLOSED)' : '🟢 STATUS: AKTIF BERLANGSUNG'}
          </span>
          {activeProfile?.description && (
            <span className="small muted">({activeProfile.description})</span>
          )}
        </div>

        <div className="spacer" />

        {/* Tournament Report & Closing Actions + Quick Switcher Dropdown */}
        <div className="row" style={{ gap: '.45rem' }}>
          <button
            type="button"
            className="btn btn-sm btn-blue"
            onClick={() => onOpenReport?.()}
            title="Lihat Laporan Pelaksanaan Turnamen Lengkap (Executive Summary, Juara Kategori, Klasemen Klub, Durasi, Cock, Wasit & Kartu)"
          >
            📑 Laporan Turnamen
          </button>
          {isClosed ? (
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy}
              onClick={handleReopenTournament}
              title="Buka kembali status turnamen menjadi Aktif Berlangsung"
            >
              🔓 Buka Kembali Turnamen
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-sm btn-green"
              disabled={busy}
              onClick={() => onOpenCloseModal?.()}
              title="Selesaikan & Tutup Turnamen (Closing Turnamen) serta buat Laporan Pelaksanaan Resmi"
            >
              🏁 Closing Turnamen
            </button>
          )}
          <span className="small muted" style={{ fontWeight: 700, marginLeft: '.25rem' }}>Pindah Profil:</span>
          <select
            className="input"
            style={{ width: 235, padding: '.4rem .7rem', fontWeight: 700, borderColor: 'var(--gold)' }}
            value={activeProfile?.id || ''}
            disabled={busy}
            onChange={(e) => handleSwitch(e.target.value)}
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.active ? '● ' : '○ '}
                {p.name} {p.status === 'closed' ? '[CLOSED]' : ''} ({p.stats?.finished || 0}/{p.stats?.total || 0} selesai)
              </option>
            ))}
          </select>
          <button
            type="button"
            className={`btn btn-sm ${expanded ? 'btn-primary' : 'btn-yellow'}`}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? '▲ Tutup Kelola Profil' : `📂 Kelola Profil (${profiles.length})`}
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
function GroupedMatchBoard({ matches, now, onEdit, onViewDetail, onLogs, prefs, setPrefs }) {
  const { groupBy, statusFilter, cols, q } = prefs;
  const setGroupBy = (val) => setPrefs((p) => ({ ...p, groupBy: val }));
  const setStatusFilter = (val) => setPrefs((p) => ({ ...p, statusFilter: val }));
  const setCols = (val) => setPrefs((p) => ({ ...p, cols: val }));
  const setQ = (val) => setPrefs((p) => ({ ...p, q: val }));

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
                        onClick={() => (isFinished && onViewDetail ? onViewDetail(m) : onEdit?.(m))}
                        title={isFinished ? 'Klik untuk membuka Detail Lengkap & Histori Reli pertandingan ini' : 'Klik untuk mengedit / melihat detail pertandingan ini'}
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
                          {Array.isArray(st.cards) && st.cards.length > 0 && (
                            <span className="gb-override-tag" style={{ background: 'rgba(239,68,68,0.2)', color: '#fca5a5' }}>
                              {st.cards.map((c) => (c.type === 'yellow' ? '🟨' : c.type === 'red' ? '🟥' : '⬛')).join('')}
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

                        {/* Col 9: Aksi Cepat Detail / Edit & Log */}
                        <div className="gb-col-actions" onClick={(e) => e.stopPropagation()}>
                          {isFinished && (
                            <button
                              type="button"
                              className="gb-action-btn"
                              onClick={() => onViewDetail?.(m)}
                              title="Lihat Detail Lengkap & Histori Reli Pertandingan"
                            >
                              📊
                            </button>
                          )}
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
  const [activeTab, setActiveTabState] = useState('dashboard'); // 'dashboard' | 'board' | 'users'
  const [boardPrefs, setBoardPrefsState] = useState({
    groupBy: 'court', // 'court' | 'category' | 'date' | 'discipline' | 'status'
    statusFilter: 'all', // 'all' | 'active_upcoming' | 'in_progress' | 'scheduled' | 'finished'
    cols: 2, // 1 | 2 | 3
    q: '',
  });
  const [tablePrefs, setTablePrefsState] = useState({
    q: '',
    status: '',
    court: '',
    category: '',
    sorts: [],
  });
  const [activeProfile, setActiveProfile] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [matches, setMatches] = useState([]);
  const [exporter, setExporter] = useState(null);
  const [sync, setSync] = useState(null);
  const [connected, setConnected] = useState(false);
  const [courtCount, setCourtCount] = useState(15);
  const [logsFor, setLogsFor] = useState(null);
  const [editMatch, setEditMatch] = useState(null);
  const [remoteSetupMatch, setRemoteSetupMatch] = useState(null);
  const [detailMatch, setDetailMatch] = useState(null);
  const [showCloseTournamentModal, setShowCloseTournamentModal] = useState(false);
  const [showTournamentReportModal, setShowTournamentReportModal] = useState(false);
  const [notice, setNotice] = useState(null);
  const now = useNow(1000);

  const setActiveTab = useCallback((tab) => {
    setActiveTabState(tab);
    lsSet('sp_admin_active_tab', tab);
  }, []);

  const setBoardPrefs = useCallback((updater) => {
    setBoardPrefsState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      lsSet('sp_admin_board_prefs', next);
      return next;
    });
  }, []);

  const setTablePrefs = useCallback((updater) => {
    setTablePrefsState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      lsSet('sp_admin_table_prefs', next);
      return next;
    });
  }, []);

  useEffect(() => {
    const savedTok = sessionStorage.getItem('sp_admin_token') || sessionStorage.getItem('sp_admin_pin');
    const savedUsr = sessionStorage.getItem('sp_admin_user');
    if (savedTok) setToken(savedTok);
    if (savedUsr) {
      try {
        setCurrentUser(JSON.parse(savedUsr));
      } catch { /* ignore */ }
    }
    const savedTab = lsGet('sp_admin_active_tab', 'dashboard');
    if (['dashboard', 'board', 'referees', 'users'].includes(savedTab)) setActiveTabState(savedTab);
    const savedBoard = lsGet('sp_admin_board_prefs', null);
    if (savedBoard && typeof savedBoard === 'object') {
      setBoardPrefsState((prev) => ({
        groupBy: ['court', 'category', 'date', 'discipline', 'status'].includes(savedBoard.groupBy) ? savedBoard.groupBy : prev.groupBy,
        statusFilter: ['all', 'active_upcoming', 'in_progress', 'scheduled', 'finished'].includes(savedBoard.statusFilter) ? savedBoard.statusFilter : prev.statusFilter,
        cols: [1, 2, 3].includes(Number(savedBoard.cols)) ? Number(savedBoard.cols) : prev.cols,
        q: typeof savedBoard.q === 'string' ? savedBoard.q : prev.q,
      }));
    }
    const savedTable = lsGet('sp_admin_table_prefs', null);
    if (savedTable && typeof savedTable === 'object') {
      setTablePrefsState((prev) => ({
        q: typeof savedTable.q === 'string' ? savedTable.q : prev.q,
        status: typeof savedTable.status === 'string' ? savedTable.status : prev.status,
        court: typeof savedTable.court === 'string' ? savedTable.court : prev.court,
        category: typeof savedTable.category === 'string' ? savedTable.category : prev.category,
        sorts: Array.isArray(savedTable.sorts) ? savedTable.sorts : prev.sorts,
      }));
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
            className={`btn btn-sm ${activeTab === 'referees' ? 'btn-primary' : ''}`}
            onClick={() => setActiveTab('referees')}
          >
            👨‍⚖️ Daftar Wasit
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
        onOpenCloseModal={() => setShowCloseTournamentModal(true)}
        onOpenReport={() => setShowTournamentReportModal(true)}
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
      ) : activeTab === 'referees' ? (
        <RefereeRosterPanel token={token} notify={notify} />
      ) : activeTab === 'board' ? (
        <GroupedMatchBoard
          matches={matches}
          now={now}
          onEdit={setEditMatch}
          onViewDetail={setDetailMatch}
          onLogs={setLogsFor}
          prefs={boardPrefs}
          setPrefs={setBoardPrefs}
        />
      ) : (
        <>
          <CourtGrid
            matches={matches}
            courtCount={courtCount}
            now={now}
            onRemoteSetup={(m) => setRemoteSetupMatch(m)}
            onClearSetupRequest={async (id) => {
              const r = await api(`/api/matches/${encodeURIComponent(id)}/clear_setup_request`, { method: 'POST', pin: token });
              if (r.ok) notify({ type: 'ok', text: `Alert request setup ${id} ditutup.` });
            }}
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
            <ImportPanel pin={token} sync={sync} onSyncChange={setSync} onDone={() => notify({ type: 'ok', text: 'Import & sinkronisasi progres selesai' })} />
            <ExportCard pin={token} exporter={exporter} setExporter={setExporter} notify={notify} onRestored={applyProfileResponse} />
          </div>

          <MatchTable
            matches={matches}
            pin={token}
            courtCount={courtCount}
            now={now}
            onEdit={setEditMatch}
            onViewDetail={setDetailMatch}
            onLogs={setLogsFor}
            notify={notify}
            prefs={tablePrefs}
            setPrefs={setTablePrefs}
          />
        </>
      )}

      {detailMatch && (
        <FinishedMatchDetailModal
          match={matches.find((x) => x.match_number === detailMatch.match_number) || detailMatch}
          now={now}
          onClose={() => setDetailMatch(null)}
          onEdit={setEditMatch}
          onLogs={setLogsFor}
        />
      )}
      {showCloseTournamentModal && (
        <CloseTournamentModal
          profile={activeProfile}
          matches={matches}
          token={token}
          onClose={() => setShowCloseTournamentModal(false)}
          onSaved={applyProfileResponse}
          onOpenReport={() => setShowTournamentReportModal(true)}
          notify={notify}
        />
      )}
      {showTournamentReportModal && (
        <TournamentReportModal
          profile={activeProfile}
          matches={matches}
          token={token}
          now={now}
          notify={notify}
          onRegenerate={async () => {
            const r = await emitAck('admin:watch', { token, pin: token });
            if (r?.ok) {
              if (r.matches) setMatches(r.matches);
              if (r.active_profile) setActiveProfile(r.active_profile);
              if (r.profiles) setProfiles(r.profiles);
              if (r.exporter) setExporter(r.exporter);
              if (r.sync) setSync(r.sync);
            }
          }}
          onClose={() => setShowTournamentReportModal(false)}
          onSelectMatch={(m) => setDetailMatch(m)}
          onOpenCloseModal={() => setShowCloseTournamentModal(true)}
        />
      )}
      {remoteSetupMatch && (
        <AdminRemoteSetupModal
          match={matches.find((x) => x.match_number === remoteSetupMatch.match_number) || remoteSetupMatch}
          token={token}
          onClose={() => setRemoteSetupMatch(null)}
          notify={notify}
        />
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
