import { useQuery } from '@tanstack/react-query';
import { api, qs } from '@/api/client';
import type { CategoryBreakdown, IssueStatus, OverviewStats, Severity, TimeSeriesPoint, WorkerWorkload } from '@/types';

/**
 * All figures come from SQL aggregation over the live tables — the server
 * scopes each query to the caller's role, so a citizen's "overview" counts only
 * their own reports.
 */
export function useOverview(enabled = true) {
  return useQuery<OverviewStats>({
    queryKey: ['analytics', 'overview'],
    queryFn: async ({ signal }) => (await api.get<{ stats: OverviewStats }>('/analytics/overview', signal)).stats,
    enabled,
    staleTime: 30_000,
  });
}

export function useIssuesByCategory(enabled = true) {
  return useQuery<CategoryBreakdown[]>({
    queryKey: ['analytics', 'by-category'],
    queryFn: async ({ signal }) =>
      (await api.get<{ categories: CategoryBreakdown[] }>('/analytics/issues-by-category', signal)).categories,
    enabled,
    staleTime: 60_000,
  });
}

export function useIssuesByStatus(enabled = true) {
  return useQuery<{ status: IssueStatus; count: number }[]>({
    queryKey: ['analytics', 'by-status'],
    queryFn: async ({ signal }) =>
      (await api.get<{ statuses: { status: IssueStatus; count: number }[] }>('/analytics/issues-by-status', signal)).statuses,
    enabled,
    staleTime: 60_000,
  });
}

export function useIssuesBySeverity(enabled = true) {
  return useQuery<{ priority: Severity; count: number }[]>({
    queryKey: ['analytics', 'by-severity'],
    queryFn: async ({ signal }) =>
      (await api.get<{ severities: { priority: Severity; count: number }[] }>('/analytics/issues-by-severity', signal)).severities,
    enabled,
    staleTime: 60_000,
  });
}

export function useIssuesOverTime(days: number, enabled = true) {
  return useQuery<TimeSeriesPoint[]>({
    queryKey: ['analytics', 'over-time', days],
    queryFn: async ({ signal }) =>
      (await api.get<{ series: TimeSeriesPoint[] }>(`/analytics/issues-over-time${qs({ days })}`, signal)).series,
    enabled,
    staleTime: 60_000,
  });
}

export function useWorkerWorkload(enabled = true) {
  return useQuery<WorkerWorkload[]>({
    queryKey: ['analytics', 'worker-workload'],
    queryFn: async ({ signal }) =>
      (await api.get<{ workload: WorkerWorkload[] }>('/analytics/worker-workload', signal)).workload,
    enabled,
    staleTime: 60_000,
  });
}

export interface Hotspot {
  latitude: number;
  longitude: number;
  count: number;
  topCategory: string;
}

export function useHotspots(enabled = true) {
  return useQuery<Hotspot[]>({
    queryKey: ['analytics', 'hotspots'],
    queryFn: async ({ signal }) => (await api.get<{ hotspots: Hotspot[] }>('/analytics/hotspots', signal)).hotspots,
    enabled,
    staleTime: 5 * 60_000,
  });
}
