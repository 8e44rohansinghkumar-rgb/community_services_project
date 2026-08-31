/**
 * Lightweight scatter map.
 *
 * Deliberately NOT a mapping SDK: no API key, no external tile requests, no
 * paid dependency, and it works offline. Points are projected onto a plain
 * bounded plane, which is accurate enough at municipal scale (a few kilometres)
 * and honest about being a schematic rather than a street map. A link to
 * OpenStreetMap is offered for anyone who needs real cartography.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PRIORITY_META, STATUS_META, mapLink } from '@/utils/format';
import type { IssueStatus, Severity } from '@/types';

export interface MapPoint {
  id: string;
  publicId: string;
  title: string;
  latitude: number;
  longitude: number;
  status: IssueStatus;
  priority: Severity;
  categoryName: string;
}

const PRIORITY_COLOR: Record<Severity, string> = {
  LOW: 'var(--ink-400)',
  MEDIUM: 'var(--info-700)',
  HIGH: 'var(--warning-700)',
  CRITICAL: 'var(--danger-700)',
};

export function IssueMap({
  points,
  height = 420,
  linkBase = '/issues',
}: {
  points: MapPoint[];
  height?: number;
  linkBase?: string;
}): JSX.Element {
  const [selected, setSelected] = useState<MapPoint | null>(null);

  const bounds = useMemo(() => {
    if (points.length === 0) return null;
    const lats = points.map((p) => p.latitude);
    const lngs = points.map((p) => p.longitude);
    // A minimum span stops a single point (or a tight cluster) from being
    // projected onto a degenerate zero-width plane.
    const pad = 0.004;
    return {
      minLat: Math.min(...lats) - pad,
      maxLat: Math.max(...lats) + pad,
      minLng: Math.min(...lngs) - pad,
      maxLng: Math.max(...lngs) + pad,
    };
  }, [points]);

  if (points.length === 0 || !bounds) {
    return (
      <div
        className="card"
        style={{ height, display: 'grid', placeItems: 'center', background: 'var(--navy-50)' }}
      >
        <p className="muted small">No mapped reports in the current view.</p>
      </div>
    );
  }

  const project = (point: MapPoint): { x: number; y: number } => ({
    x: ((point.longitude - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * 100,
    // SVG y grows downward; latitude grows northward.
    y: (1 - (point.latitude - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * 100,
  });

  return (
    <div className="stack-sm">
      <div
        className="card"
        style={{
          position: 'relative',
          height,
          overflow: 'hidden',
          background:
            'repeating-linear-gradient(0deg, var(--navy-50) 0 39px, var(--ink-100) 39px 40px), repeating-linear-gradient(90deg, transparent 0 39px, var(--ink-100) 39px 40px)',
        }}
      >
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          role="img"
          aria-label={`Schematic map showing ${points.length} reported ${points.length === 1 ? 'issue' : 'issues'}.`}
        >
          {points.map((point) => {
            const { x, y } = project(point);
            const isSelected = selected?.id === point.id;
            return (
              <g key={point.id}>
                <circle
                  cx={x}
                  cy={y}
                  r={isSelected ? 2.4 : 1.6}
                  fill={PRIORITY_COLOR[point.priority]}
                  fillOpacity={0.85}
                  stroke="var(--white)"
                  strokeWidth={0.4}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}
        </svg>

        {/* Real focusable buttons layered over the SVG so the map is keyboard
            navigable — SVG circles alone are not reliably operable. */}
        {points.map((point) => {
          const { x, y } = project(point);
          return (
            <button
              key={point.id}
              type="button"
              onClick={() => setSelected(selected?.id === point.id ? null : point)}
              aria-pressed={selected?.id === point.id}
              title={`${point.title} — ${STATUS_META[point.status].label}`}
              style={{
                position: 'absolute',
                left: `${x}%`,
                top: `${y}%`,
                transform: 'translate(-50%, -50%)',
                width: 22,
                height: 22,
                borderRadius: '50%',
                border: selected?.id === point.id ? '2px solid var(--navy-900)' : '2px solid transparent',
                background: 'transparent',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              <span className="sr-only">
                {point.title}. {PRIORITY_META[point.priority].label} priority. {STATUS_META[point.status].label}.
              </span>
            </button>
          );
        })}

        {selected && (
          <div
            className="card card-pad"
            role="status"
            style={{
              position: 'absolute', left: 12, right: 12, bottom: 12,
              maxWidth: 420, boxShadow: 'var(--shadow-lg)',
            }}
          >
            <div className="row-between" style={{ gap: 8, alignItems: 'flex-start' }}>
              <div className="stack-sm" style={{ minWidth: 0 }}>
                <p className="tiny muted">{selected.publicId} · {selected.categoryName}</p>
                <p className="strong clamp-2" style={{ fontSize: 'var(--text-sm)' }}>{selected.title}</p>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <span className={`badge ${STATUS_META[selected.status].badge}`}>
                    <span aria-hidden="true">{STATUS_META[selected.status].icon}</span>
                    {STATUS_META[selected.status].label}
                  </span>
                  <span className={`badge ${PRIORITY_META[selected.priority].badge}`}>
                    {PRIORITY_META[selected.priority].label}
                  </span>
                </div>
                <div className="row" style={{ gap: 12 }}>
                  <Link to={`${linkBase}/${selected.id}`} className="small strong">View report</Link>
                  <a
                    href={mapLink(selected.latitude, selected.longitude)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="small"
                  >
                    Open in OpenStreetMap
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </div>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(null)} aria-label="Close details">
                ✕
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
        <p className="tiny muted">Priority:</p>
        {(Object.keys(PRIORITY_COLOR) as Severity[]).map((severity) => (
          <span key={severity} className="row tiny muted" style={{ gap: 5 }}>
            <span
              aria-hidden="true"
              style={{ width: 10, height: 10, borderRadius: '50%', background: PRIORITY_COLOR[severity] }}
            />
            {PRIORITY_META[severity].label}
          </span>
        ))}
        <p className="tiny muted" style={{ marginLeft: 'auto' }}>
          Schematic view. Public locations are rounded for privacy.
        </p>
      </div>
    </div>
  );
}
