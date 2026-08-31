/** Admin-only server state: users, departments, categories, audit log. */
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api, qs, type PaginatedResult } from '@/api/client';
import type { AuditLogEntry, Category, Department, Severity, User, UserRole } from '@/types';

/* -------------------------------- Users -------------------------------- */

export interface UserFilters {
  page: number;
  role?: UserRole;
  isActive?: boolean;
  search?: string;
}

export function useUsers(filters: UserFilters) {
  return useQuery<PaginatedResult<User>>({
    queryKey: ['users', filters],
    queryFn: ({ signal }) =>
      api.getPaginated<User>(
        `/users${qs({
          page: filters.page,
          limit: 20,
          role: filters.role,
          isActive: filters.isActive === undefined ? undefined : String(filters.isActive),
          search: filters.search,
        })}`,
        signal,
      ),
    placeholderData: keepPreviousData,
  });
}

export interface CreateStaffInput {
  name: string;
  email: string;
  password: string;
  phone?: string;
  role: 'WORKER' | 'ADMIN';
  departmentId?: string | null;
}

export function useCreateStaff() {
  const queryClient = useQueryClient();
  return useMutation<{ user: User }, Error, CreateStaffInput>({
    mutationFn: (input) => {
      const payload: Record<string, unknown> = {
        name: input.name,
        email: input.email,
        password: input.password,
        role: input.role,
      };
      if (input.phone) payload.phone = input.phone;
      if (input.departmentId) payload.departmentId = input.departmentId;
      return api.post<{ user: User }>('/users', payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['workers'] });
    },
  });
}

export function useSetUserStatus() {
  const queryClient = useQueryClient();
  return useMutation<{ user: User }, Error, { id: string; isActive: boolean }>({
    mutationFn: ({ id, isActive }) => api.patch<{ user: User }>(`/users/${id}/status`, { isActive }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['workers'] });
    },
  });
}

export function useSetUserRole() {
  const queryClient = useQueryClient();
  return useMutation<{ user: User }, Error, { id: string; role: UserRole; departmentId?: string | null }>({
    mutationFn: ({ id, role, departmentId }) =>
      api.patch<{ user: User }>(`/users/${id}/role`, {
        role,
        ...(departmentId !== undefined ? { departmentId } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['workers'] });
    },
  });
}

/* ----------------------------- Departments ----------------------------- */

export function useDepartments() {
  return useQuery<Department[]>({
    queryKey: ['departments'],
    queryFn: async ({ signal }) => (await api.get<{ departments: Department[] }>('/departments', signal)).departments,
    staleTime: 5 * 60_000,
  });
}

export function useCreateDepartment() {
  const queryClient = useQueryClient();
  return useMutation<unknown, Error, { name: string; description?: string }>({
    mutationFn: (input) =>
      api.post('/departments', { name: input.name, ...(input.description ? { description: input.description } : {}) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['departments'] }),
  });
}

/* ------------------------------ Categories ------------------------------ */

export interface CategoryInput {
  name: string;
  slug?: string;
  description?: string;
  icon?: string;
  defaultSeverity: Severity;
  slaHours: number;
  departmentId?: string | null;
  sortOrder?: number;
}

export function useCreateCategory() {
  const queryClient = useQueryClient();
  return useMutation<{ category: Category }, Error, CategoryInput>({
    mutationFn: (input) => {
      const payload: Record<string, unknown> = {
        name: input.name,
        defaultSeverity: input.defaultSeverity,
        slaHours: input.slaHours,
      };
      if (input.slug) payload.slug = input.slug;
      if (input.description) payload.description = input.description;
      if (input.icon) payload.icon = input.icon;
      if (input.departmentId) payload.departmentId = input.departmentId;
      if (input.sortOrder !== undefined) payload.sortOrder = input.sortOrder;
      return api.post<{ category: Category }>('/categories', payload);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['categories'] }),
  });
}

export function useUpdateCategory() {
  const queryClient = useQueryClient();
  return useMutation<{ category: Category }, Error, { id: number; changes: Partial<CategoryInput> & { isActive?: boolean } }>({
    mutationFn: ({ id, changes }) => api.patch<{ category: Category }>(`/categories/${id}`, changes),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['categories'] }),
  });
}

/* ------------------------------ Audit log ------------------------------ */

export interface AuditFilters {
  page: number;
  action?: string;
  entityType?: string;
  actorId?: string;
}

export function useAuditLog(filters: AuditFilters) {
  return useQuery<PaginatedResult<AuditLogEntry>>({
    queryKey: ['audit', filters],
    queryFn: ({ signal }) =>
      api.getPaginated<AuditLogEntry>(
        `/audit-logs${qs({
          page: filters.page,
          limit: 25,
          action: filters.action,
          entityType: filters.entityType,
          actorId: filters.actorId,
        })}`,
        signal,
      ),
    placeholderData: keepPreviousData,
  });
}

export function useAuditActions() {
  return useQuery<string[]>({
    queryKey: ['audit', 'actions'],
    queryFn: async ({ signal }) => (await api.get<{ actions: string[] }>('/audit-logs/actions', signal)).actions,
    staleTime: 5 * 60_000,
  });
}
