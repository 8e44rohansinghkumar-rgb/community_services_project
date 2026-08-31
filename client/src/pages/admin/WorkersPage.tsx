import { Link } from 'react-router-dom';
import { useWorkers } from '@/hooks/useIssues';
import { useDepartments } from '@/hooks/useAdmin';
import { useWorkerWorkload } from '@/hooks/useAnalytics';
import { BarChart, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { formatDuration, initials } from '@/utils/format';

/** Team roster with live workload, so an admin can see who to assign next. */
export function WorkersPage(): JSX.Element {
  const workers = useWorkers();
  const workload = useWorkerWorkload();
  const departments = useDepartments();

  const workloadById = new Map((workload.data ?? []).map((row) => [row.workerId, row]));

  return (
    <div className="stack">
      <div className="row-between" style={{ gap: 12, flexWrap: 'wrap' }}>
        <div className="stack-sm">
          <h1>Field workers</h1>
          <p className="muted">Who is available, what they are carrying and how fast they turn work around.</p>
        </div>
        <Link to="/app/admin/users" className="btn btn-secondary">Manage accounts</Link>
      </div>

      {workers.isLoading && <LoadingState label="Loading the worker directory…" rows={3} />}
      {workers.isError && <ErrorState message={(workers.error as Error).message} onRetry={() => void workers.refetch()} />}

      {workers.data && workers.data.length === 0 && (
        <EmptyState
          icon="👷"
          title="No field workers yet"
          message="Create a worker account so issues can be assigned to someone."
          action={<Link to="/app/admin/users" className="btn btn-primary">Add a staff account</Link>}
        />
      )}

      {workers.data && workers.data.length > 0 && (
        <>
          <section className="card card-pad stack-sm">
            <h2 style={{ fontSize: 'var(--text-base)' }}>Current load</h2>
            <p className="small muted">Active assignments per worker. Green is comfortable, red means overloaded.</p>
            <BarChart
              data={workers.data.map((worker) => ({
                label: worker.name,
                value: worker.activeAssignments,
                tone:
                  worker.activeAssignments > 5 ? 'var(--danger-700)'
                  : worker.activeAssignments > 2 ? 'var(--warning-700)'
                  : 'var(--success-700)',
              }))}
              maxLabel="active assignments"
            />
          </section>

          <ul className="grid-3" style={{ listStyle: 'none', padding: 0 }}>
            {workers.data.map((worker) => {
              const perf = workloadById.get(worker.id);
              return (
                <li key={worker.id} className="card card-pad stack-sm">
                  <div className="row" style={{ gap: 12 }}>
                    <span
                      aria-hidden="true"
                      style={{
                        width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
                        background: worker.isActive ? 'var(--navy-700)' : 'var(--ink-300)',
                        color: 'var(--white)', display: 'grid', placeItems: 'center', fontWeight: 700,
                      }}
                    >
                      {initials(worker.name)}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <p className="strong truncate">{worker.name}</p>
                      <p className="tiny muted truncate">{worker.departmentName ?? 'No department'}</p>
                      {worker.email && <p className="tiny muted truncate">{worker.email}</p>}
                    </div>
                  </div>

                  {!worker.isActive && <span className="badge badge-danger">Deactivated</span>}

                  <dl className="row" style={{ gap: 16, margin: 0, flexWrap: 'wrap' }}>
                    <div>
                      <dt className="tiny muted">Active</dt>
                      <dd
                        style={{
                          margin: 0, fontSize: 'var(--text-xl)', fontWeight: 700,
                          color: worker.activeAssignments > 5 ? 'var(--danger-700)' : worker.activeAssignments > 2 ? 'var(--warning-700)' : 'var(--ink-900)',
                        }}
                      >
                        {worker.activeAssignments}
                      </dd>
                    </div>
                    <div>
                      <dt className="tiny muted">Completed</dt>
                      <dd style={{ margin: 0, fontSize: 'var(--text-xl)', fontWeight: 700 }}>{worker.completedAssignments}</dd>
                    </div>
                    {perf && (
                      <div>
                        <dt className="tiny muted">Avg. turnaround</dt>
                        <dd style={{ margin: 0, fontSize: 'var(--text-base)', fontWeight: 600, paddingTop: 4 }}>
                          {formatDuration(perf.averageResolutionHours)}
                        </dd>
                      </div>
                    )}
                  </dl>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <section className="card card-pad stack-sm">
        <h2 style={{ fontSize: 'var(--text-base)' }}>Departments</h2>
        {departments.isLoading && <LoadingState label="Loading departments…" rows={1} />}
        {departments.isError && <ErrorState message="Departments unavailable." onRetry={() => void departments.refetch()} />}
        {departments.data && departments.data.length === 0 && <p className="small muted">No departments configured.</p>}
        {departments.data && departments.data.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Departments with worker and category counts</caption>
              <thead>
                <tr>
                  <th scope="col">Department</th>
                  <th scope="col">Workers</th>
                  <th scope="col">Categories</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {departments.data.map((department) => (
                  <tr key={department.id}>
                    <th scope="row">
                      {department.name}
                      {department.description && <span className="tiny muted" style={{ display: 'block', fontWeight: 400 }}>{department.description}</span>}
                    </th>
                    <td>{department.workerCount}</td>
                    <td>{department.categoryCount}</td>
                    <td>
                      <span className={`badge ${department.isActive ? 'badge-success' : 'badge-neutral'}`}>
                        {department.isActive ? 'Active' : 'Inactive'}
                      </span>
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
