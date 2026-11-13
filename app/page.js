import Link from 'next/link';

const COURTS = parseInt(process.env.COURT_COUNT || '15', 10);

export default function Home() {
  return (
    <main className="container">
      <section className="hero">
        <h1>
          Smash<span>Point</span> v2.1
        </h1>
        <p className="muted">Dedicated Multi-Court Match Scoring Engine · Offline-First LAN · Socket.io Real-time</p>
      </section>
      <section className="home-grid">
        <div className="card home-card">
          <div className="icon">📱</div>
          <h2>Wasit (Referee)</h2>
          <p className="muted small">Input identitas wasit &amp; Match ID, verifikasi data, undian &amp; posisi, tombol reli, undo, override, takeover darurat.</p>
          <div className="spacer" />
          <Link className="btn btn-green" href="/referee">
            Buka Controller Wasit
          </Link>
        </div>
        <div className="card home-card">
          <div className="icon">🏟️</div>
          <h2>Venue LiveScore (Multi-Court)</h2>
          <p className="muted small">
            Tampilan layar besar GOR/Venue dengan animasi lapangan bulutangkis live seperti layar wasit. Pilih 1 s/d 8 lapangan sekaligus dalam 1 monitor.
          </p>
          <div className="row" style={{ gap: '.35rem' }}>
            {[1, 2, 3, 4, 6, 8].map((n) => (
              <Link key={n} className="btn btn-sm" href={`/livescore?count=${n}`}>
                {n} Lap
              </Link>
            ))}
          </div>
          <div className="spacer" />
          <Link className="btn btn-blue" href="/livescore">
            Buka Multi-Court LiveScore
          </Link>
        </div>
        <div className="card home-card">
          <div className="icon">📺</div>
          <h2>Court Display &amp; OBS</h2>
          <p className="muted small">Papan skor TV Arena atau YouTube/OBS Scorebug Overlay (pojok kiri atas).</p>
          <div className="court-links">
            {Array.from({ length: COURTS }, (_, i) => (
              <Link key={i} href={`/display?court=${i + 1}`}>
                {i + 1}
              </Link>
            ))}
          </div>
          <div className="row" style={{ marginTop: '.35rem' }}>
            <Link className="btn btn-sm btn-primary" style={{ flex: 1, textAlign: 'center' }} href="/display">
              Pilih Mode TV / OBS Overlay
            </Link>
          </div>
        </div>
        <div className="card home-card">
          <div className="icon">🌐</div>
          <h2>Portal Publik Turnamen</h2>
          <p className="muted small">
            Halaman khusus penonton &amp; peserta: pantau Live Score real-time, Jadwal Pertandingan, serta Hasil &amp; Histori Reli lengkap.
          </p>
          <div className="spacer" />
          <Link className="btn btn-primary" href="/portal">
            Buka Portal Publik
          </Link>
        </div>
      </section>
    </main>
  );
}
