/**
 * Server-state hooks. React Query owns caching/refetching; component state
 * stays purely about the UI. Mutations invalidate the affected keys so every
 * view reflects the database rather than optimistic guesses.
 */
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api, qs, type PaginatedResult } from '@/api/client';
import type {
  Category,
  DuplicateCandidate,
  Issue,
  IssueComment,
  IssueDetail,
  IssueImage,
  IssueStatus,
  PublicIssue,
  Severity,
  StatusHistoryEntry,
  WorkerSummary,
} from '@/types';

export interface IssueFilters {
  page?: number;
  limit?: number;
  status?: string[];
  priority?: string[];
  categoryId?: string[];
  search?: string;
  workerId?: string;
  reporterId?: string;
  onlyOpen?: boolean;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  from?: string;
  to?: string;
}

function filtersToQuery(filters: IssueFilters): string {
  return qs({
    page: filters.page ?? 1,
    limit: filters.limit ?? 20,
    status: filters.status,
    priority: filters.priority,
    categoryId: filters.categoryId,
    search: filters.search,
    workerId: filters.workerId,
    reporterId: filters.reporterId,
    onlyOpen: filters.onlyOpen ? 'true' : undefined,
    sortBy: filters.sortBy,
    sortDir: filters.sortDir,
    from: filters.from,
    to: filters.to,
  });
}

/* ------------------------------ Queries ------------------------------ */

export function useIssues(filters: IssueFilters) {
  return useQuery<PaginatedResult<Issue>>({
    queryKey: ['issues', filters],
    queryFn: ({ signal }) => api.getPaginated<Issue>(`/issues${filtersToQuery(filters)}`, signal),
    placeholderData: keepPreviousData,
  });
}

export function usePublicIssues(filters: IssueFilters) {
  return useQuery<PaginatedResult<PublicIssue>>({
    queryKey: ['issues', 'public', filters],
    queryFn: ({ signal }) => api.getPaginated<PublicIssue>(`/issues/public${filtersToQuery(filters)}`, signal),
    placeholderData: keepPreviousData,
  });
}

export function useIssue(id: string | undefined) {
  return useQuery<IssueDetail>({
    queryKey: ['issue', id],
    queryFn: ({ signal }) => api.get<IssueDetail>(`/issues/${id}`, signal),
    enabled: Boolean(id),
  });
}

export function useIssueHistory(id: string | undefined) {
  return useQuery<StatusHistoryEntry[]>({
    queryKey: ['issue', id, 'history'],
    queryFn: async ({ signal }) => (await api.get<{ history: StatusHistoryEntry[] }>(`/issues/${id}/history`, signal)).history,
    enabled: Boolean(id),
  });
}

export function useMyWork(filters: IssueFilters) {
  return useQuery<PaginatedResult<Issue>>({
    queryKey: ['issues', 'my-work', filters],
    queryFn: ({ signal }) => api.getPaginated<Issue>(`/issues/my-work${filtersToQuery(filters)}`, signal),
    placeholderData: keepPreviousData,
  });
}

export function useCategories(options?: { withCounts?: boolean; includeInactive?: boolean }) {
  return useQuery<Category[]>({
    queryKey: ['categories', options ?? {}],
    queryFn: async ({ signal }) => {
      const query = qs({
        withCounts: options?.withCounts ? 'true' : undefined,
        includeInactive: options?.includeInactive ? 'true' : undefined,
      });
      const data = await api.get<{ categories: Category[] }>(`/categories${query}`, signal);
      return data.categories;
    },
    // Reference data: cache aggressively.
    staleTime: 5 * 60_000,
  });
}

export function useWorkers() {
  return useQuery<WorkerSummary[]>({
    queryKey: ['workers'],
    queryFn: async ({ signal }) => (await api.get<{ workers: WorkerSummary[] }>('/workers', signal)).workers,
    staleTime: 60_000,
  });
}

/** Live duplicate check while the citizen fills in the wizard. */
export function useDuplicateCheck(params: { categoryId?: number; latitude?: number; longitude?: number; enabled: boolean }) {
  return useQuery<DuplicateCandidate[]>({
    queryKey: ['duplicate-check', params.categoryId, params.latitude, params.longitude],
    queryFn: async ({ signal }) => {
      const data = await api.get<{ candidates: DuplicateCandidate[] }>(
        `/issues/duplicate-check${qs({
          categoryId: params.categoryId!,
          latitude: params.latitude!,
          longitude: params.longitude!,
        })}`,
        signal,
      );
      return data.candidates;
    },
    enabled: params.enabled && Boolean(params.categoryId && params.latitude !== undefined && params.longitude !== undefined),
    staleTime: 30_000,
  });
}

/* ----------------------------- Mutations ----------------------------- */

/** Invalidate everything that could show this issue. */
function useIssueInvalidator() {
  const queryClient = useQueryClient();
  return (id?: string) => {
    void queryClient.invalidateQueries({ queryKey: ['issues'] });
    void queryClient.invalidateQueries({ queryKey: ['analytics'] });
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    if (id) void queryClient.invalidateQueries({ queryKey: ['issue', id] });
  };
}

export interface CreateIssuePayload {
  title: string;
  description: string;
  categoryId: number;
  citizenSeverity: Severity;
  latitude: number;
  longitude: number;
  address?: string;
  landmark?: string;
  isPublic: boolean;
  files: File[];
}

export interface CreateIssueResult {
  issue: Issue;
  images: IssueImage[];
  potentialDuplicates: DuplicateCandidate[];
}

export function useCreateIssue() {
  const invalidate = useIssueInvalidator();
  return useMutation<CreateIssueResult, Error, CreateIssuePayload>({
    mutationFn: (payload) => {
      const form = new FormData();
      form.append('title', payload.title);
      form.append('description', payload.description);
      form.append('categoryId', String(payload.categoryId));
      form.append('citizenSeverity', payload.citizenSeverity);
      form.append('latitude', String(payload.latitude));
      form.append('longitude', String(payload.longitude));
      form.append('isPublic', String(payload.isPublic));
      if (payload.address) form.append('address', payload.address);
      if (payload.landmark) form.append('landmark', payload.landmark);
      for (const file of payload.files) form.append('images', file);
      return api.upload<CreateIssueResult>('/issues', form);
    },
    onSuccess: () => invalidate(),
  });
}

export function useChangeStatus(issueId: string) {
  const invalidate = useIssueInvalidator();
  return useMutation<{ issue: Issue }, Error, { status: IssueStatus; reason?: string }>({
    mutationFn: (input) =>
      api.post<{ issue: Issue }>(`/issues/${issueId}/status`, {
        status: input.status,
        ...(input.reason ? { reason: input.reason } : {}),
      }),
    onSuccess: () => invalidate(issueId),
  });
}

export function useAssignIssue(issueId: string) {
  const invalidate = useIssueInvalidator();
  const queryClient = useQueryClient();
  return useMutation<{ issue: Issue }, Error, { workerId: string; note?: string }>({
    mutationFn: (input) =>
      api.post<{ issue: Issue }>(`/issues/${issueId}/assign`, {
        workerId: input.workerId,
        ...(input.note ? { note: input.note } : {}),
      }),
    onSuccess: () => {
      invalidate(issueId);
      void queryClient.invalidateQueries({ queryKey: ['workers'] });
    },
  });
}

export function useChangePriority(issueId: string) {
  const invalidate = useIssueInvalidator();
  return useMutation<{ issue: Issue }, Error, { priority: Severity; reason?: string }>({
    mutationFn: (input) =>
      api.patch<{ issue: Issue }>(`/issues/${issueId}/priority`, {
        priority: input.priority,
        ...(input.reason ? { reason: input.reason } : {}),
      }),
    onSuccess: () => invalidate(issueId),
  });
}

export function useMarkSpam(issueId: string) {
  const invalidate = useIssueInvalidator();
  return useMutation<{ issue: Issue }, Error, boolean>({
    mutationFn: (isSpam) => api.patch<{ issue: Issue }>(`/issues/${issueId}/spam`, { isSpam }),
    onSuccess: () => invalidate(issueId),
  });
}

export function useAddComment(issueId: string) {
  const queryClient = useQueryClient();
  return useMutation<{ comment: IssueComment }, Error, { body: string; isInternal: boolean }>({
    mutationFn: (input) => api.post<{ comment: IssueComment }>(`/issues/${issueId}/comments`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['issue', issueId] });
    },
  });
}

export function useUploadImages(issueId: string) {
  const queryClient = useQueryClient();
  return useMutation<{ images: IssueImage[] }, Error, { files: File[]; type: 'RESOLUTION' | 'ADDITIONAL' }>({
    mutationFn: (input) => {
      const form = new FormData();
      form.append('type', input.type);
      for (const file of input.files) form.append('images', file);
      return api.upload<{ images: IssueImage[] }>(`/issues/${issueId}/images`, form);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['issue', issueId] });
    },
  });
}

export function useUpdateIssue(issueId: string) {
  const invalidate = useIssueInvalidator();
  return useMutation<{ issue: Issue }, Error, { title?: string; description?: string; landmark?: string | null; isPublic?: boolean }>({
    mutationFn: (input) => api.patch<{ issue: Issue }>(`/issues/${issueId}`, input),
    onSuccess: () => invalidate(issueId),
  });
}

export function useDeleteIssue() {
  const invalidate = useIssueInvalidator();
  return useMutation<void, Error, string>({
    mutationFn: (issueId) => api.delete<void>(`/issues/${issueId}`),
    onSuccess: () => invalidate(),
  });
}
