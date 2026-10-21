'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { emitAck, getDeviceId, getSocket, lsGet, lsSet, useNow } from '@/lib/client';
import { matchDurationText } from '@/lib/engine';
import { EntryScreen, MatchInfo, StatusBadge } from '@/components/referee/Entry';
import SetupScreen from '@/components/referee/Setup';
import LiveScreen, { TakeoverModal } from '@/components/referee/Live';

const HEARTBEAT_MS = 10000;
const cacheKey = (id) => `sp_cache_${id}`;

export default function RefereePage() {
  const [deviceId, setDeviceId] = useState('');
  const [label, setLabelState] = useState('');
  const [matchNo, setMatchNo] = useState(null);
  const [mode, setMode] = useState('none'); // none | preview | controller | spectator
  const [match, setMatch] = useState(null);
  const [connected, setConnected] = useState(false);
  const [notice, setNotice] = useState(null);
  const [pending, setPending] = useState(false);
  const [showTakeover, setShowTakeover] = useState(false);
  const [ready, setReady] = useState(false);
  const now = useNow(1000);

  const refs = useRef({});
  refs.current = { deviceId, label, matchNo, mode, match };
  const pendingRef = useRef(false);

  // ---- boot: restore device identity, session & cached live_state (PRD 8.2)
  useEffect(() => {
    setDeviceId(getDeviceId());
    setLabelState(lsGet('sp_device_label', ''));
    const sess = lsGet('sp_ref_session');
    if (sess?.match_number) {
      setMatchNo(sess.match_number);
      setMode(sess.mode === 'controller' ? 'controller' : sess.mode || 'preview');
      const cached = lsGet(cacheKey(sess.match_number));
      if (cached) setMatch(cached);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) lsSet('sp_ref_session', matchNo ? { match_number: matchNo, mode } : null);
  }, [matchNo, mode, ready]);

  const setLabel = (v) => {
    setLabelState(v);
    lsSet('sp_device_label', v);
  };

  const applyMatch = useCallback((m) => {
    if (!m || m.match_number !== refs.current.matchNo) return;
    setMatch(m);
    lsSet(cacheKey(m.match_number), m);
  }, []);

  const watch = useCallback(async () => {
    const id = refs.current.matchNo;
    if (!id) return;
    const r = await emitAck('match:watch', { match_number: id });
    if (r.ok) applyMatch(r.match);
    else if (!r.offline) setNotice({ type: 'error', text: r.error });
  }, [applyMatch]);

  const lock = useCallback(
    async (silent = false) => {
      const { matchNo: id, deviceId: dev, label: lbl } = refs.current;
      if (!id) return;
      const r = await emitAck('match:lock', { match_number: id, device_id: dev, label: lbl });
      if (!r.ok) {
        if (!(silent && r.offline)) setNotice({ type: 'error', text: r.error });
        return;
      }
      applyMatch(r.match);
      if (r.mode === 'controller') {
        setMode('controller');
        if (!silent) setNotice(null);
      } else {
        setMode('spectator');
        setNotice({ type: r.reason === 'locked_by_other' ? 'error' : 'info', text: r.message });
      }
    },
    [applyMatch],
  );

  // ---- socket wiring
  useEffect(() => {
    if (!ready) return undefined;
    const s = getSocket();
    const onConnect = () => {
      setConnected(true);
      const { matchNo: id, mode: md } = refs.current;
      if (!id) return;
      if (md === 'controller') lock(true);
      else watch();
    };
    const onDisconnect = () => setConnected(false);
    const onState = (m) => applyMatch(m);
    const onKicked = ({ match_number, message }) => {
      if (match_number !== refs.current.matchNo) return;
      if (refs.current.mode === 'controller') setMode('spectator');
      setNotice({ type: 'error', text: message });
    };
    const onRemoved = ({ match_number }) => {
      if (match_number !== refs.current.matchNo) return;
      setNotice({ type: 'error', text: `Match ${match_number} dihapus dari server.` });
      setMode('none');
      setMatchNo(null);
      setMatch(null);
    };
    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    s.on('match:state', onState);
    s.on('session:kicked', onKicked);
    s.on('match:removed', onRemoved);
    if (s.connected) onConnect();
    return () => {
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      s.off('match:state', onState);
      s.off('session:kicked', onKicked);
      s.off('match:removed', onRemoved);
    };
  }, [ready, applyMatch, lock, watch]);

  // watch when a match is opened
  useEffect(() => {
    if (matchNo && connected && mode === 'preview') watch();
  }, [matchNo, connected, mode, watch]);

  // ---- heartbeat PING every 10s while controlling (PRD 8.2)
  useEffect(() => {
    if (mode !== 'controller' || !connected || !matchNo) return undefined;
    const ping = async () => {
      const r = await emitAck('PING', { match_number: matchNo, device_id: refs.current.deviceId }, 5000);
      if (r.ok === false && r.reason === 'not_controller') {
        setMode('spectator');
        if (refs.current.match?.session_management?.status !== 'finished') {
          setNotice({ type: 'warn', text: 'Kunci sesi tidak lagi dimiliki perangkat ini. Anda dalam mode pemantau.' });
        }
      }
    };
    ping();
    const t = setInterval(ping, HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [mode, connected, matchNo]);

  // ---- actions (idempotent: last_log_id + client-side in-flight lock)
  const send = useCallback(
    async (type, payload = {}) => {
      if (pendingRef.current) return { ok: false, error: 'busy' };
      const { matchNo: id, deviceId: dev, match: m } = refs.current;
      pendingRef.current = true;
      setPending(true);
      const r = await emitAck('match:action', { match_number: id, device_id: dev, last_log_id: m?.last_log_id ?? null, type, payload });
      pendingRef.current = false;
      setPending(false);
      if (r.match) applyMatch(r.match);
      if (!r.ok) {
        if (r.duplicate) return r;
        if (r.reason === 'not_controller') setMode('spectator');
        setNotice({ type: 'error', text: r.error || r.message || 'Aksi gagal' });
      } else if (type === 'CONFIRM_FINISH') {
        setNotice({ type: 'ok', text: 'Hasil pertandingan dikonfirmasi dan dikirim ke server ekspor.' });
      }
      return r;
    },
    [applyMatch],
  );

  const takeover = async (pin) => {
    const r = await emitAck('match:takeover', { match_number: matchNo, device_id: deviceId, label, pin });
    if (r.ok) {
      applyMatch(r.match);
      setMode('controller');
      setNotice({ type: 'ok', text: 'Takeover berhasil. Anda sekarang mengontrol pertandingan ini.' });
    }
    return r;
  };

  const exit = async () => {
    if (mode === 'controller' && match?.session_management?.status !== 'finished') {
      if (!window.confirm('Lepas kontrol pertandingan ini? Wasit lain dapat mengunci match setelahnya.')) return;
      await emitAck('match:release', { match_number: matchNo, device_id: deviceId });
    }
    if (matchNo) emitAck('match:unwatch', { match_number: matchNo });
    setMode('none');
    setMatchNo(null);
    setMatch(null);
    setNotice(null);
  };

  const open = (id) => {
    setNotice(null);
    setMatch(lsGet(cacheKey(id)) || null);
    setMatchNo(id);
    setMode('preview');
  };

  // ---- render
  const sm = match?.session_management;
  let body;
  if (!ready) body = null;
  else if (mode === 'none' || !matchNo) body = <EntryScreen label={label} setLabel={setLabel} deviceId={deviceId} onOpen={open} />;
  else if (!match) body = <div className="container muted">Memuat data match {matchNo}… {!connected && '(menunggu koneksi server)'}</div>;
  else if (mode === 'preview') {
    body = (
      <div className="container col" style={{ maxWidth: 1100 }}>
        <div className="card col">
          <div className="row">
            <h2 style={{ margin: 0 }}>Match {match.match_number}</h2>
            <StatusBadge match={match} />
            {sm.locked && <span className="badge red">🔒 Dikontrol: {sm.controller_label || `…${sm.controller_tag}`}</span>}
          </div>
          <MatchInfo match={match} />
          <div className="row">
            <button className="btn btn-green btn-lg" disabled={!connected || sm.status === 'finished'} onClick={() => lock(false)}>
              🔒 Kunci & Mulai Setup
            </button>
            <button className="btn btn-lg" onClick={() => setMode('spectator')}>
              👁 Mode Pantau
            </button>
            <div className="spacer" />
            <button className="btn btn-ghost" onClick={exit}>
              ← Kembali
            </button>
          </div>
        </div>
      </div>
    );
  } else if (mode === 'controller' && match.live_state.phase === 'setup' && sm.status !== 'finished') {
    body = <SetupScreen key={`${match.match_number}-${match.live_state.current_set}`} match={match} send={send} pending={pending} connected={connected} />;
  } else {
    const spectator = mode === 'spectator';
    body = (
      <LiveScreen
        match={match}
        now={now}
        readOnly={spectator}
        pending={pending}
        connected={connected}
        send={send}
        spectator={
          <>
            {spectator && sm.status !== 'finished' && (sm.locked ? (
              <button className="btn btn-grey" onClick={() => setShowTakeover(true)} disabled={!connected}>
                Ambil Alih Sesi (Takeover)
              </button>
            ) : (
              <button className="btn btn-green" onClick={() => lock(false)} disabled={!connected}>
                🔒 Kunci & Kontrol
              </button>
            ))}
            <button className="btn btn-grey" style={{ flex: '0 0 auto', minWidth: 120 }} onClick={exit}>
              {mode === 'controller' && sm.status !== 'finished' ? 'Lepas Kontrol' : 'Keluar'}
            </button>
          </>
        }
      />
    );
  }

  return (
    <div className="ref-shell">
      <div className="ref-topbar">
        <Link href="/" className="title" style={{ color: 'var(--text)' }}>
          🏸 SmashPoint <span className="muted small">Wasit</span>
        </Link>
        {matchNo && <span className="badge blue">Match {matchNo}</span>}
        {match && <span className="badge">Lapangan {match.court_number}</span>}
        {match?.live_state?.started_at && (
          <span className="badge cyan mono" title="Durasi Pertandingan">
            ⏱ {matchDurationText(match, now)}
          </span>
        )}
        {mode === 'controller' && <span className="badge green">● PENGONTROL</span>}
        {mode === 'spectator' && <span className="badge red">👁 MODE PANTAU (Read-Only)</span>}
        {pending && <span className="badge gold">mengirim…</span>}
        <div className="spacer" />
        {label && <span className="small muted">{label}</span>}
        <span className="row small" style={{ gap: '.4rem' }}>
          <span className={`dot ${connected ? 'on' : ''}`} /> {connected ? 'Online' : 'Offline - menyambung ulang…'}
        </span>
      </div>
      {notice && (
        <div style={{ padding: '.6rem .7rem 0' }}>
          <div className={`notice ${notice.type}`}>
            <span style={{ flex: 1 }}>{notice.text}</span>
            <button className="btn btn-sm btn-ghost" onClick={() => setNotice(null)}>
              ✕
            </button>
          </div>
        </div>
      )}
      {!connected && match && mode !== 'none' && (
        <div style={{ padding: '.6rem .7rem 0' }}>
          <div className="notice warn">Koneksi ke server terputus. Menampilkan state terakhir dari cache lokal; tombol skor dinonaktifkan sampai tersambung kembali.</div>
        </div>
      )}
      {body}
      {showTakeover && match && <TakeoverModal match={match} onClose={() => setShowTakeover(false)} onSubmit={takeover} />}
    </div>
  );
}
