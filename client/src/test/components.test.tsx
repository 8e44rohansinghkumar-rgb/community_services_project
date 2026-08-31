/**
 * Shared UI components: rendering, accessibility semantics and interaction.
 *
 * These are the building blocks every page reuses, so a broken aria wiring or
 * a badge that conveys status by colour alone would spread everywhere.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Alert,
  BarChart,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Modal,
  Pagination,
  PriorityBadge,
  StatusBadge,
  fieldAria,
} from '@/components/ui';

describe('StatusBadge', () => {
  it('renders a human-readable label, not just a colour', () => {
    render(<StatusBadge status="IN_PROGRESS" />);
    // Someone who cannot distinguish the colour still reads the state.
    expect(screen.getByText(/in progress/i)).toBeInTheDocument();
  });

  it('renders every status without crashing', () => {
    const statuses = [
      'REPORTED',
      'UNDER_REVIEW',
      'ASSIGNED',
      'IN_PROGRESS',
      'ON_HOLD',
      'RESOLVED',
      'CLOSED',
      'REJECTED',
      'REOPENED',
    ] as const;

    for (const status of statuses) {
      const { unmount } = render(<StatusBadge status={status} />);
      unmount();
    }
  });
});

describe('PriorityBadge', () => {
  it('names the priority in text', () => {
    render(<PriorityBadge priority="CRITICAL" />);
    expect(screen.getByText(/critical/i)).toBeInTheDocument();
  });
});

describe('Alert', () => {
  it('announces an error to assistive technology', () => {
    render(<Alert variant="error">Could not save your report.</Alert>);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Could not save your report.');
  });

  it('can be dismissed', async () => {
    const onDismiss = vi.fn();
    render(
      <Alert variant="success" onDismiss={onDismiss}>
        Saved.
      </Alert>,
    );

    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('shows no dismiss button when it is not dismissible', () => {
    render(<Alert variant="info">Read only.</Alert>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('LoadingState', () => {
  it('exposes a polite status region rather than a silent spinner', () => {
    render(<LoadingState label="Loading issues…" />);
    expect(screen.getByRole('status')).toHaveTextContent(/loading issues/i);
  });
});

describe('EmptyState', () => {
  it('renders a heading and an explanation', () => {
    render(<EmptyState title="No issues yet" message="Report your first issue to get started." />);

    expect(screen.getByRole('heading', { name: /no issues yet/i })).toBeInTheDocument();
    expect(screen.getByText(/report your first issue/i)).toBeInTheDocument();
  });

  it('hides the decorative icon from screen readers', () => {
    const { container } = render(<EmptyState icon="📋" title="Nothing here" message="Empty." />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });

  it('renders a call to action when given one', () => {
    render(
      <EmptyState
        title="No issues"
        message="Nothing to show."
        action={<button type="button">Report an issue</button>}
      />,
    );
    expect(screen.getByRole('button', { name: /report an issue/i })).toBeInTheDocument();
  });
});

describe('ErrorState', () => {
  it('announces itself as an alert', () => {
    render(<ErrorState message="The server did not respond." />);
    expect(screen.getByRole('alert')).toHaveTextContent(/did not respond/i);
  });

  it('offers a retry that calls back', async () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Network unavailable." onRetry={onRetry} />);

    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('omits the retry button when no handler is supplied', () => {
    render(<ErrorState message="Fatal." />);
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });
});

describe('Field and fieldAria', () => {
  it('associates the label with its control', () => {
    render(
      <Field label="Email address" htmlFor="email">
        <input {...fieldAria('email')} type="email" />
      </Field>,
    );

    // getByLabelText only succeeds if the association is real.
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
  });

  it('marks a required field for both sighted and screen-reader users', () => {
    render(
      <Field label="Title" htmlFor="title" required>
        <input {...fieldAria('title')} />
      </Field>,
    );

    expect(screen.getByText('(required)', { exact: false })).toBeInTheDocument();
  });

  it('wires an error through aria-invalid and aria-describedby', () => {
    render(
      <Field label="Title" htmlFor="title" error="Title is too short">
        <input {...fieldAria('title', 'Title is too short')} />
      </Field>,
    );

    const input = screen.getByLabelText(/title/i);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'title-error');
    expect(screen.getByRole('alert')).toHaveTextContent('Title is too short');
  });

  it('describes a field by both its hint and its error', () => {
    const aria = fieldAria('phone', 'Invalid number', 'Include the country code');
    expect(aria['aria-describedby']).toBe('phone-hint phone-error');
    expect(aria['aria-invalid']).toBe(true);
  });

  it('adds no describedby when there is nothing to describe', () => {
    const aria = fieldAria('name');
    expect(aria['aria-describedby']).toBeUndefined();
    expect(aria['aria-invalid']).toBe(false);
  });
});

describe('Pagination', () => {
  it('shows a plain result count when there is only one page', () => {
    render(<Pagination page={1} totalPages={1} total={7} onPageChange={vi.fn()} />);

    expect(screen.getByText('7 results')).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('singularises a single result', () => {
    render(<Pagination page={1} totalPages={1} total={1} onPageChange={vi.fn()} />);
    expect(screen.getByText('1 result')).toBeInTheDocument();
  });

  it('renders a labelled navigation landmark across pages', () => {
    render(<Pagination page={2} totalPages={5} total={93} onPageChange={vi.fn()} />);

    const nav = screen.getByRole('navigation', { name: /pagination/i });
    expect(within(nav).getByText(/page 2 of 5/i)).toBeInTheDocument();
  });

  it('disables Previous on the first page and Next on the last', () => {
    const { rerender } = render(<Pagination page={1} totalPages={3} total={50} onPageChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next/i })).toBeEnabled();

    rerender(<Pagination page={3} totalPages={3} total={50} onPageChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /previous/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });

  it('reports the requested page number', async () => {
    const onPageChange = vi.fn();
    render(<Pagination page={2} totalPages={5} total={93} onPageChange={onPageChange} />);

    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(onPageChange).toHaveBeenCalledWith(3);

    await userEvent.click(screen.getByRole('button', { name: /previous/i }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });
});

describe('Modal', () => {
  it('renders nothing when closed', () => {
    render(
      <Modal open={false} title="Confirm" onClose={vi.fn()}>
        <p>Body</p>
      </Modal>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders an accessible dialog when open', () => {
    render(
      <Modal open title="Reject this issue" onClose={vi.fn()}>
        <p>Please give a reason.</p>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByText(/please give a reason/i)).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(
      <Modal open title="Confirm" onClose={onClose}>
        <p>Body</p>
      </Modal>,
    );

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes from the close button', async () => {
    const onClose = vi.fn();
    render(
      <Modal open title="Confirm" onClose={onClose}>
        <p>Body</p>
      </Modal>,
    );

    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('BarChart', () => {
  it('renders each datum with a label and value', () => {
    render(
      <BarChart
        data={[
          { label: 'Potholes', value: 12 },
          { label: 'Garbage', value: 7 },
        ]}
      />,
    );

    expect(screen.getByText('Potholes')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Garbage')).toBeInTheDocument();
  });

  it('survives an empty dataset', () => {
    // A brand-new deployment has no data; the chart must not divide by zero.
    expect(() => render(<BarChart data={[]} />)).not.toThrow();
  });

  it('survives an all-zero dataset', () => {
    expect(() =>
      render(<BarChart data={[{ label: 'None', value: 0 }]} />),
    ).not.toThrow();
  });
});
