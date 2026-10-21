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
          <div className="icon">🖥️</div>
          <h2>Server Admin</h2>
          <p className="muted small">Import jadwal (CSV / Google Sheets), dashboard {COURTS} lapangan, koreksi jadwal, resolusi Session Lock, ekspor hasil.</p>
          <div className="spacer" />
          <Link className="btn btn-primary" href="/admin">
            Buka Dashboard Admin
          </Link>
        </div>
        <div className="card home-card">
          <div className="icon">📱</div>
          <h2>Wasit (Referee)</h2>
          <p className="muted small">Input Match ID, verifikasi data, undian & posisi, tombol reli, undo, override, takeover darurat.</p>
          <div className="spacer" />
          <Link className="btn btn-green" href="/referee">
            Buka Controller Wasit
          </Link>
        </div>
        <div className="card home-card">
          <div className="icon">📺</div>
          <h2>Court Display & OBS</h2>
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
      </section>
    </main>
  );
}
