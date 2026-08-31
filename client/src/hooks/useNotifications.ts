import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs, type PaginatedResult } from '@/api/client';
import { useAuth } from '@/contexts/AuthContext';
import type { Notification } from '@/types';

/** Unread badge count. Polls gently so the bell stays roughly live. */
export function useUnreadCount(): number {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => api.get<{ unreadCount: number }>('/notifications/unread-count'),
    enabled: Boolean(user),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  return data?.unreadCount ?? 0;
}

export function useNotifications(page: number, unreadOnly: boolean) {
  return useQuery<PaginatedResult<Notification>>({
    queryKey: ['notifications', 'list', page, unreadOnly],
    queryFn: () => api.getPaginated<Notification>(`/notifications${qs({ page, limit: 20, unreadOnly: unreadOnly || undefined })}`),
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export function useMarkAllRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.patch<{ updated: number }>('/notifications/read-all'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}
