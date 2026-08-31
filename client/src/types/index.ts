/** Shared domain types mirroring the API contract. */

export type UserRole = 'CITIZEN' | 'WORKER' | 'ADMIN';
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type IssueStatus =
  | 'REPORTED'
  | 'UNDER_REVIEW'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'ON_HOLD'
  | 'RESOLVED'
  | 'REOPENED'
  | 'CLOSED'
  | 'REJECTED';
export type ImageType = 'REPORT' | 'RESOLUTION' | 'ADDITIONAL';

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  departmentId: string | null;
  departmentName: string | null;
  isActive: boolean;
  emailVerified: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
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
  issueCount?: number;
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
  resolvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicIssue {
  id: string;
  publicId: string;
  title: string;
  description: string;
  categoryId: number;
  categoryName: string;
  categorySlug: string;
  officialPriority: Severity;
  status: IssueStatus;
  latitude: number;
  longitude: number;
  address: string | null;
  landmark: string | null;
  imageCount: number;
  duplicateCount: number;
  createdAt: string;
  resolvedAt: string | null;
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
  createdAt: string;
}

export interface IssueComment {
  id: string;
  issueId: string;
  authorId: string;
  authorName: string;
  authorRole: UserRole;
  body: string;
  isInternal: boolean;
  createdAt: string;
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
  createdAt: string;
}

export interface Assignment {
  id: string;
  issueId: string;
  workerId: string;
  workerName: string;
  assignedBy: string | null;
  assignedByName: string | null;
  note: string | null;
  assignedAt: string;
  unassignedAt: string | null;
  acceptedAt: string | null;
  completedAt: string | null;
  active: boolean;
}

export interface IssueDetail {
  issue: Issue;
  images: IssueImage[];
  comments: IssueComment[];
  history: StatusHistoryEntry[];
  assignments: Assignment[];
  allowedTransitions: IssueStatus[];
  access: 'OWNER' | 'ADMIN' | 'ASSIGNED_WORKER' | 'PUBLIC_VIEWER';
}

export interface Notification {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string | null;
  issueId: string | null;
  issuePublicId: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface WorkerSummary {
  id: string;
  name: string;
  email?: string;
  phone?: string | null;
  departmentId: string | null;
  departmentName: string | null;
  isActive: boolean;
  activeAssignments: number;
  completedAssignments: number;
}

export interface DuplicateCandidate {
  id: string;
  publicId: string;
  title: string;
  status: IssueStatus;
  categoryName: string;
  distanceMeters: number;
  createdAt: string;
  duplicateCount: number;
}

export interface OverviewStats {
  total: number;
  open: number;
  reported: number;
  underReview: number;
  assigned: number;
  inProgress: number;
  onHold: number;
  resolved: number;
  closed: number;
  rejected: number;
  reopened: number;
  critical: number;
  newLast7Days: number;
  resolvedLast7Days: number;
  averageResolutionHours: number | null;
  medianResolutionHours: number | null;
}

export interface CategoryBreakdown {
  categoryId: number;
  categoryName: string;
  slug: string;
  total: number;
  open: number;
  resolved: number;
  averageResolutionHours: number | null;
}

export interface TimeSeriesPoint {
  date: string;
  reported: number;
  resolved: number;
}

export interface WorkerWorkload {
  workerId: string;
  workerName: string;
  active: number;
  inProgress: number;
  completed: number;
  averageResolutionHours: number | null;
}

export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
}

export interface Department {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  workerCount: number;
  categoryCount: number;
}
