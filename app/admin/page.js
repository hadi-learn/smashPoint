'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, emitAck, getSocket, useNow } from '@/lib/client';
import { matchDurationText, teamLabel } from '@/lib/engine';
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

function ImportPanel({ pin, onDone }) {
  const [tab, setTab] = useState('file');
  const [csv, setCsv] = useState('');
  const [url, setUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const run = async (dry) => {
    setBusy(true);
    setResult(null);
    const body = tab === 'url' ? { url } : { csv };
    const r = await api('/api/import', { method: 'POST', pin, body: { ...body, dry_run: dry } });
    setBusy(false);
    setResult(r);
    if (!dry && r.ok) onDone?.();
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

  return (
    <div className="card col">
      <div className="row">
        <h3 style={{ margin: 0 }}>📥 Import Jadwal Pertandingan</h3>
        <div className="spacer" />
        <a className="btn btn-sm" href="/api/template.csv">
          ⬇ Template CSV
        </a>
      </div>
      <div className="tabs">
        {[
          ['file', 'File CSV'],
          ['paste', 'Tempel dari Sheets/Excel'],
          ['url', 'URL Google Sheets'],
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
        <label className="field">
          Link Google Sheets (dibagikan &quot;Siapa saja yang memiliki link&quot;) atau link &quot;Publikasikan ke web → CSV&quot;
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=0" />
        </label>
      )}
      <div className="row">
        <button className="btn" disabled={!hasInput || busy} onClick={() => run(true)}>
          Validasi
        </button>
        <button className="btn btn-primary" disabled={!hasInput || busy} onClick={() => run(false)}>
          {busy ? 'Memproses…' : 'Import / Update'}
        </button>
        <span className="small muted">Match yang sudah dimulai hanya diperbarui metadata jadwalnya (lapangan/jam).</span>
      </div>
      {result && (
        <div className="col">
          {!result.ok && <div className="notice error">{result.error}</div>}
          {result.ok && (
            <div className={`notice ${result.errors?.length ? 'warn' : 'ok'}`}>
              {result.dry_run ? `Validasi: ${result.valid}/${result.total} baris valid.` : `Import selesai: ${result.created} baru, ${result.updated} diperbarui dari ${result.total} baris.`}
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

function MatchTable({ matches, pin, courtCount, now, onLogs, notify }) {
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
  const [connected, setConnected] = useState(false);
  const [courtCount, setCourtCount] = useState(15);
  const [logsFor, setLogsFor] = useState(null);
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
      } else if (r.reason === 'bad_pin') {
        sessionStorage.removeItem('sp_admin_pin');
        setPin(null);
      }
    };
    const onState = (d) => {
      setMatches(d.matches);
      setExporter(d.exporter);
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
        <ImportPanel pin={pin} onDone={() => notify({ type: 'ok', text: 'Import selesai' })} />
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

      <MatchTable matches={matches} pin={pin} courtCount={courtCount} now={now} onLogs={setLogsFor} notify={notify} />
      {logsFor && <LogsModal id={logsFor} onClose={() => setLogsFor(null)} />}
    </main>
  );
}
