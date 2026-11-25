import {
  formatCount,
  formatHours,
  formatShare,
  weekLabel,
  type PreviewMeasures,
} from "../../lib/previewMeasures";

/** #2670: the figures of the preview measures page. */
export function PreviewMeasuresView({ data }: { data: PreviewMeasures }) {
  return (
    <div className="preview-measures__grid">
      <section aria-labelledby="pm-artists">
        <h2 id="pm-artists">Invited artists</h2>
        <dl>
          <dt>Joined with an artist invitation</dt>
          <dd>{formatCount(data.artists.invited)}</dd>
          <dt>Published a release within 14 days</dt>
          <dd>
            {formatCount(data.artists.publishedWithin14Days)} ({formatShare(data.artists.share)})
          </dd>
          <dt>Still inside their 14 days</dt>
          <dd>{formatCount(data.artists.stillWithin14Days)}</dd>
        </dl>
      </section>

      <section aria-labelledby="pm-listeners">
        <h2 id="pm-listeners">New listeners</h2>
        <dl>
          <dt>Joined</dt>
          <dd>{formatCount(data.listeners.joined)}</dd>
          <dt>Allowed product analytics</dt>
          <dd>{data.listeners.analyticsAvailable ? formatCount(data.listeners.consenting) : "not available"}</dd>
        </dl>
        <table className="preview-measures__table">
          <caption>Active in each of their first four weeks (accounts that allowed product analytics only)</caption>
          <thead>
            <tr>
              <th scope="col">Week</th>
              <th scope="col">Listeners</th>
              <th scope="col">Active</th>
              <th scope="col">Share</th>
            </tr>
          </thead>
          <tbody>
            {data.listeners.weeks.map((week) => (
              <tr key={week.week}>
                <th scope="row">Week {week.week}</th>
                <td>{formatCount(week.eligible)}</td>
                <td>{formatCount(week.active)}</td>
                <td>{formatShare(week.share)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="pm-features" className="preview-measures__wide">
        <h2 id="pm-features">People using each feature, per week</h2>
        <div className="preview-measures__scroll">
          <table className="preview-measures__table">
            <thead>
              <tr>
                <th scope="col">Feature</th>
                {data.features.weeks.map((week) => (
                  <th scope="col" key={week.start}>
                    Week of {weekLabel(week.start)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.features.rows.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  {row.recorded ? (
                    row.weekly.map((value, index) => <td key={index}>{formatCount(value)}</td>)
                  ) : (
                    <td colSpan={data.features.weeks.length}>Not recorded yet</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="pm-support">
        <h2 id="pm-support">Support</h2>
        <dl>
          <dt>Requests opened</dt>
          <dd>{formatCount(data.support.opened)}</dd>
          <dt>Answered or closed</dt>
          <dd>{formatCount(data.support.answered)}</dd>
          <dt>Median time to an answer</dt>
          <dd>{formatHours(data.support.medianHoursToAnswer)}</dd>
        </dl>
      </section>

      <section aria-labelledby="pm-safety">
        <h2 id="pm-safety">Limits and reports</h2>
        <dl>
          <dt>Uploads refused by a limit</dt>
          <dd>{formatCount(data.safety.uploadsRefusedByLimit)}</dd>
          <dt>Takedown reports</dt>
          <dd>{formatCount(data.safety.takedownReports)}</dd>
          <dt>Community reports</dt>
          <dd>{formatCount(data.safety.communityReports)}</dd>
        </dl>
      </section>
    </div>
  );
}
