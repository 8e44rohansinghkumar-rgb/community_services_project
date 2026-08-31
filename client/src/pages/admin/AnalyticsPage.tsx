import { useState } from 'react';
import {
  useHotspots,
  useIssuesByCategory,
  useIssuesBySeverity,
  useIssuesByStatus,
  useIssuesOverTime,
  useOverview,
  useWorkerWorkload,
} from '@/hooks/useAnalytics';
import { BarChart, ErrorState, LoadingState, Sparkline, StatCard } from '@/components/ui';
import { PRIORITY_META, STATUS_META, formatDuration } from '@/utils/format';

const RANGES = [
  { days: 14, label: '14 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
];

/**
 * Every number here is computed in PostgreSQL — counts, medians, percentiles
 * and the day-by-day series all come from SQL aggregates over the live tables.
 */
export function AnalyticsPage(): JSX.Element {
  const [days, setDays] = useState(30);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const stats = useOverview();
  const series = useIssuesOverTime(days);
  const byCategory = useIssuesByCategory();
  const byStatus = useIssuesByStatus();
  const bySeverity = useIssuesBySeverity();
  const workload = useWorkerWorkload();
  const hotspots = useHotspots();

  /** Streams the CSV straight from the API (same-origin, cookies attached). */
  const downloadCsv = async (): Promise<void> => {
    setExporting(true);
    setExportError(null);
    try {
      const response = await fetch('/api/analytics/export', { credentials: 'include' });
      if (!response.ok) throw new Error(`Export failed with status ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `civic-issues-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportError('The export could not be generated. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="stack">
      <div className="row-between" style={{ gap: 12, flexWrap: 'wrap' }}>
        <div className="stack-sm">
          <h1>Analytics</h1>
          <p className="muted">Aggregated from the live database. No cached or sample figures.</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => void downloadCsv()} disabled={exporting}>
          {exporting ? (<><span className="spinner spinner-dark" aria-hidden="true" /> Preparing…</>) : '⬇ Export CSV'}
        </button>
      </div>

      {exportError && <div className="alert alert-error" role="alert"><span className="alert-icon" aria-hidden="true">⚠</span><div>{exportError}</div></div>}

      {stats.isLoading && <LoadingState label="Loading analytics…" rows={2} />}
      {stats.isError && <ErrorState message="Analytics could not be loaded." onRetry={() => void stats.refetch()} />}

      {stats.data && (
        <>
          <div className="grid-4">
            <StatCard label="Total reports" value={stats.data.total} />
            <StatCard label="Currently open" value={stats.data.open} tone={stats.data.open > 0 ? 'warning' : 'default'} />
            <StatCard label="Resolved and closed" value={stats.data.resolved + stats.data.closed} tone="success" />
            <StatCard label="Rejected" value={stats.data.rejected} hint="Duplicates and out-of-scope reports" />
          </div>
          <div className="grid-4">
            <StatCard label="New this week" value={stats.data.newLast7Days} />
            <StatCard label="Resolved this week" value={stats.data.resolvedLast7Days} tone="success" />
            <StatCard label="Mean resolution" value={formatDuration(stats.data.averageResolutionHours)} />
            <StatCard label="Median resolution" value={formatDuration(stats.data.medianResolutionHours)} hint="Robust to outliers" />
          </div>
        </>
      )}

      <section className="card card-pad stack-sm">
        <div className="row-between" style={{ gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 'var(--text-base)' }}>Reported vs resolved</h2>
          <div className="row" role="group" aria-label="Select time range" style={{ gap: 4 }}>
            {RANGES.map((range) => (
              <button
                key={range.days}
                type="button"
                className={days === range.days ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
                onClick={() => setDays(range.days)}
                aria-pressed={days === range.days}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>
        {series.isLoading && <div className="skeleton" style={{ height: 140 }} />}
        {series.isError && <ErrorState message="Time series unavailable." onRetry={() => void series.refetch()} />}
        {series.data && <Sparkline points={series.data} height={160} />}
      </section>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <section className="card card-pad stack-sm">
          <h2 style={{ fontSize: 'var(--text-base)' }}>By status</h2>
          {byStatus.isLoading && <div className="skeleton" style={{ height: 160 }} />}
          {byStatus.isError && <ErrorState message="Unavailable." onRetry={() => void byStatus.refetch()} />}
          {byStatus.data && byStatus.data.length === 0 && <p className="small muted">No issues recorded yet.</p>}
          {byStatus.data && byStatus.data.length > 0 && (
            <BarChart data={byStatus.data.map((row) => ({ label: STATUS_META[row.status]?.label ?? row.status, value: row.count }))} />
          )}
        </section>

        <section className="card card-pad stack-sm">
          <h2 style={{ fontSize: 'var(--text-base)' }}>By official priority</h2>
          {bySeverity.isLoading && <div className="skeleton" style={{ height: 160 }} />}
          {bySeverity.isError && <ErrorState message="Unavailable." onRetry={() => void bySeverity.refetch()} />}
          {bySeverity.data && bySeverity.data.length === 0 && <p className="small muted">No issues recorded yet.</p>}
          {bySeverity.data && bySeverity.data.length > 0 && (
            <BarChart
              data={bySeverity.data.map((row) => ({
                label: PRIORITY_META[row.priority]?.label ?? row.priority,
                value: row.count,
                tone:
                  row.priority === 'CRITICAL' ? 'var(--danger-700)'
                  : row.priority === 'HIGH' ? 'var(--warning-700)'
                  : row.priority === 'MEDIUM' ? 'var(--info-700)'
                  : 'var(--ink-400)',
              }))}
            />
          )}
        </section>
      </div>

      <section className="card card-pad stack-sm">
        <h2 style={{ fontSize: 'var(--text-base)' }}>Category performance</h2>
        {byCategory.isLoading && <LoadingState label="Loading category data…" rows={2} />}
        {byCategory.isError && <ErrorState message="Unavailable." onRetry={() => void byCategory.refetch()} />}
        {byCategory.data && (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Total, open and resolved issues per category with average resolution time</caption>
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col">Total</th>
                  <th scope="col">Open</th>
                  <th scope="col">Resolved</th>
                  <th scope="col">Average resolution</th>
                </tr>
              </thead>
              <tbody>
                {byCategory.data.map((row) => (
                  <tr key={row.categoryId}>
                    <th scope="row">{row.categoryName}</th>
                    <td>{row.total}</td>
                    <td>{row.open > 0 ? <span className="strong" style={{ color: 'var(--warning-700)' }}>{row.open}</span> : '0'}</td>
                    <td>{row.resolved}</td>
                    <td className="small">{formatDuration(row.averageResolutionHours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card card-pad stack-sm">
        <h2 style={{ fontSize: 'var(--text-base)' }}>Worker performance</h2>
        {workload.isLoading && <LoadingState label="Loading workload…" rows={2} />}
        {workload.isError && <ErrorState message="Unavailable." onRetry={() => void workload.refetch()} />}
        {workload.data && workload.data.length === 0 && <p className="small muted">No workers registered.</p>}
        {workload.data && workload.data.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Active, in-progress and completed assignments per worker</caption>
              <thead>
                <tr>
                  <th scope="col">Worker</th>
                  <th scope="col">Active</th>
                  <th scope="col">In progress</th>
                  <th scope="col">Completed</th>
                  <th scope="col">Average resolution</th>
                </tr>
              </thead>
              <tbody>
                {workload.data.map((row) => (
                  <tr key={row.workerId}>
                    <th scope="row">{row.workerName}</th>
                    <td>
                      <span
                        className={`badge ${row.active > 5 ? 'badge-danger' : row.active > 2 ? 'badge-warning' : 'badge-success'}`}
                      >
                        {row.active}
                      </span>
                    </td>
                    <td>{row.inProgress}</td>
                    <td>{row.completed}</td>
                    <td className="small">{formatDuration(row.averageResolutionHours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card card-pad stack-sm">
        <h2 style={{ fontSize: 'var(--text-base)' }}>Recurring hotspots</h2>
        <p className="small muted">
          Open issues grouped into roughly 1.1 km cells. Repeat clusters usually indicate an underlying problem worth
          fixing properly rather than patching each time.
        </p>
        {hotspots.isLoading && <LoadingState label="Loading hotspots…" rows={2} />}
        {hotspots.isError && <ErrorState message="Unavailable." onRetry={() => void hotspots.refetch()} />}
        {hotspots.data && hotspots.data.length === 0 && <p className="small muted">No clusters detected.</p>}
        {hotspots.data && hotspots.data.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Geographic clusters of open issues</caption>
              <thead>
                <tr>
                  <th scope="col">Approximate area</th>
                  <th scope="col">Open issues</th>
                  <th scope="col">Most common category</th>
                  <th scope="col">Map</th>
                </tr>
              </thead>
              <tbody>
                {hotspots.data.map((spot) => (
                  <tr key={`${spot.latitude}-${spot.longitude}`}>
                    <th scope="row" className="small">{spot.latitude.toFixed(2)}, {spot.longitude.toFixed(2)}</th>
                    <td><span className="badge badge-warning">{spot.count}</span></td>
                    <td className="small">{spot.topCategory}</td>
                    <td>
                      <a
                        className="small"
                        href={`https://www.openstreetmap.org/#map=15/${spot.latitude}/${spot.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View<span className="sr-only"> the area around {spot.latitude.toFixed(2)}, {spot.longitude.toFixed(2)} on OpenStreetMap (opens in a new tab)</span>
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
