export default function DropsLoading() {
  return (
    <main className="home-ng drops-page" aria-busy="true" aria-label="Loading Drops">
      <div className="ng-main">
        <header className="drops-hero">
          <span className="ng-kicker ng-kicker--violet">Collection gallery</span>
          <div className="drops-skeleton drops-skeleton-title" />
          <div className="drops-skeleton drops-skeleton-copy" />
        </header>
        <div className="drops-skeleton drops-skeleton-filters" />
        <section className="ng-section">
          <div className="ng-grid-3 drops-grid">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="drops-skeleton drops-skeleton-card" />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
