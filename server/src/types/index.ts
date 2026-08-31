/** Shared domain types used across the server. */

export const USER_ROLES = ['CITIZEN', 'WORKER', 'ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const ISSUE_STATUSES = [
  'REPORTED',
  'UNDER_REVIEW',
  'ASSIGNED',
  'IN_PROGRESS',
  'ON_HOLD',
  'RESOLVED',
  'REOPENED',
  'CLOSED',
  'REJECTED',
] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const IMAGE_TYPES = ['REPORT', 'RESOLUTION', 'ADDITIONAL'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

export type NotificationType =
  | 'ISSUE_SUBMITTED'
  | 'STATUS_CHANGED'
  | 'ISSUE_ASSIGNED'
  | 'ASSIGNMENT_REMOVED'
  | 'ISSUE_RESOLVED'
  | 'ISSUE_REOPENED'
  | 'ISSUE_CLOSED'
  | 'PRIORITY_CHANGED'
  | 'COMMENT_ADDED'
  | 'NEW_ISSUE_REPORTED'
  | 'CRITICAL_ISSUE_REPORTED';

/** The authenticated principal attached to a request by requireAuth. */
export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  name: string;
  tokenVersion: number;
}

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  departmentId: string | null;
  departmentName?: string | null;
  isActive: boolean;
  emailVerified: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Category {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  defaultSeverity: Severity;
  slaHours: number;
  departmentId: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface IssueImage {
  id: string;
  issueId: string;
  uploadedBy: string;
  uploaderName?: string;
  originalName: string | null;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  type: ImageType;
  createdAt: Date;
}

export interface IssueComment {
  id: string;
  issueId: string;
  authorId: string;
  authorName: string;
  authorRole: UserRole;
  body: string;
  isInternal: boolean;
  createdAt: Date;
}

export interface StatusHistoryEntry {
  id: string;
  issueId: string;
  previousStatus: IssueStatus | null;
  newStatus: IssueStatus;
  changedBy: string | null;
  changedByName: string | null;
  changedByRole: UserRole | null;
  reason: string | null;
  createdAt: Date;
}

export interface Assignment {
  id: string;
  issueId: string;
  workerId: string;
  workerName: string;
  assignedBy: string | null;
  assignedByName: string | null;
  note: string | null;
  assignedAt: Date;
  unassignedAt: Date | null;
  acceptedAt: Date | null;
  completedAt: Date | null;
  active: boolean;
}

export interface Issue {
  id: string;
  publicId: string;
  reporterId: string;
  reporterName?: string | null;
  reporterEmail?: string | null;
  title: string;
  description: string;
  categoryId: number;
  categoryName?: string;
  categorySlug?: string;
  citizenSeverity: Severity;
  officialPriority: Severity;
  status: IssueStatus;
  latitude: number;
  longitude: number;
  address: string | null;
  landmark: string | null;
  isPublic: boolean;
  isSpam?: boolean;
  duplicateOfId: string | null;
  duplicateCount: number;
  assignedWorkerId?: string | null;
  assignedWorkerName?: string | null;
  imageCount?: number;
  commentCount?: number;
  resolvedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  rows: T[];
  pagination: PaginationMeta;
}
