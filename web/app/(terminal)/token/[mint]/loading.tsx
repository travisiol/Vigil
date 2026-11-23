// Écran affiché instantanément au clic, pendant que la page du token se prépare
export default function Loading() {
  return (
    <div className="tgrid" aria-busy="true">
      <div>
        <div className="thead">
          <span className="ph skel-box" style={{ width: 52, height: 52, borderRadius: 14 }} />
          <div style={{ display: "grid", gap: 8 }}>
            <span className="skel-line" style={{ width: 140, height: 24 }} />
            <span className="skel-line" style={{ width: 110, height: 16 }} />
          </div>
        </div>
        <div className="kpis">
          {[0, 1, 2, 3].map((i) => (
            <div key={i}><span className="skel-line" style={{ width: 70, height: 16 }} /><span className="skel-line" style={{ width: 90, height: 10, marginTop: 8 }} /></div>
          ))}
        </div>
        <section className="card"><div className="chart-skel"><span className="dotlive" aria-hidden="true" /> Loading chart…</div></section>
      </div>
      <aside className="card" style={{ height: 420 }} />
    </div>
  );
}
