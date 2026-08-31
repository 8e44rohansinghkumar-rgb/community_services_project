import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMarkAllRead, useMarkNotificationRead, useNotifications, useUnreadCount } from '@/hooks/useNotifications';
import { EmptyState, ErrorState, LoadingState, Pagination } from '@/components/ui';
import { formatDateTime, relativeTime } from '@/utils/format';

const TYPE_ICON: Record<string, string> = {
  ISSUE_CREATED: '📝',
  ISSUE_ASSIGNED: '🔧',
  ISSUE_STATUS_CHANGED: '🔄',
  ISSUE_RESOLVED: '✓',
  ISSUE_REOPENED: '↻',
  ISSUE_COMMENTED: '💬',
  ASSIGNMENT_REMOVED: '↩',
  SYSTEM: 'ℹ',
};

export function NotificationsPage(): JSX.Element {
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const notifications = useNotifications(page, unreadOnly);
  const unread = useUnreadCount();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllRead();

  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <div className="row-between" style={{ gap: 12, flexWrap: 'wrap' }}>
        <div className="stack-sm">
          <h1>Notifications</h1>
          <p className="muted">
            {unread > 0 ? `${unread} unread` : 'You are all caught up.'}
          </p>
        </div>
        {unread > 0 && (
          <button type="button" className="btn btn-secondary" onClick={() => markAll.mutate()} disabled={markAll.isPending}>
            {markAll.isPending ? (<><span className="spinner spinner-dark" aria-hidden="true" /> Marking…</>) : 'Mark all as read'}
          </button>
        )}
      </div>

      <div className="card card-pad">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(event) => { setUnreadOnly(event.target.checked); setPage(1); }}
          />
          <span className="small">Show unread only</span>
        </label>
      </div>

      {notifications.isLoading && <LoadingState label="Loading notifications…" rows={4} />}
      {notifications.isError && (
        <ErrorState message={(notifications.error as Error).message} onRetry={() => void notifications.refetch()} />
      )}

      {notifications.data && notifications.data.data.length === 0 && (
        <EmptyState
          icon="🔔"
          title={unreadOnly ? 'No unread notifications' : 'No notifications yet'}
          message={
            unreadOnly
              ? 'You have read everything. Untick the filter to see your full history.'
              : 'You will be notified when one of your reports changes status, or when work is assigned to you.'
          }
          action={
            unreadOnly ? (
              <button type="button" className="btn btn-secondary" onClick={() => setUnreadOnly(false)}>Show all</button>
            ) : undefined
          }
        />
      )}

      {notifications.data && notifications.data.data.length > 0 && (
        <>
          <ul className="stack-sm" style={{ listStyle: 'none', padding: 0 }}>
            {notifications.data.data.map((notification) => (
              <li
                key={notification.id}
                className="card card-pad"
                style={{
                  borderLeft: `4px solid ${notification.isRead ? 'var(--ink-200)' : 'var(--navy-700)'}`,
                  background: notification.isRead ? 'var(--white)' : 'var(--navy-50)',
                }}
              >
                <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
                  <span aria-hidden="true" style={{ fontSize: 20, flexShrink: 0 }}>
                    {TYPE_ICON[notification.type] ?? '•'}
                  </span>
                  <div className="stack-sm" style={{ flex: 1, minWidth: 0, gap: 4 }}>
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <span className="strong" style={{ fontSize: 'var(--text-sm)' }}>{notification.title}</span>
                      {!notification.isRead && <span className="badge badge-navy" style={{ fontSize: 10 }}>New</span>}
                    </div>
                    {notification.body && <p className="small muted">{notification.body}</p>}
                    <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
                      <time className="tiny muted" dateTime={notification.createdAt} title={formatDateTime(notification.createdAt)}>
                        {relativeTime(notification.createdAt)}
                      </time>
                      {notification.issueId && (
                        <Link
                          to={`/app/issues/${notification.issueId}`}
                          className="tiny strong"
                          onClick={() => { if (!notification.isRead) markRead.mutate(notification.id); }}
                        >
                          View {notification.issuePublicId ?? 'the issue'} →
                        </Link>
                      )}
                    </div>
                  </div>
                  {!notification.isRead && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => markRead.mutate(notification.id)}
                      disabled={markRead.isPending}
                    >
                      Mark read<span className="sr-only">: {notification.title}</span>
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <Pagination
            page={notifications.data.pagination.page}
            totalPages={notifications.data.pagination.totalPages}
            total={notifications.data.pagination.total}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
