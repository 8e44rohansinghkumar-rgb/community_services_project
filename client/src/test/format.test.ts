/**
 * Formatting helpers. These run on every list row, so an edge case here shows
 * up as "Invalid Date" or "NaN" across the whole UI.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  PRIORITY_META,
  ROLE_LABEL,
  STATUS_META,
  formatBytes,
  formatCoords,
  formatDate,
  formatDateTime,
  formatDuration,
  initials,
  mapLink,
  priorityLabel,
  relativeTime,
  statusLabel,
} from '@/utils/format';
import type { IssueStatus } from '@/types';

/**
 * Spelled out rather than derived from STATUS_META, so that a status added to
 * the database enum but forgotten in the UI metadata fails this test instead
 * of being silently self-consistent. Mirrors the `issue_status` PostgreSQL enum.
 */
const ISSUE_STATUSES: IssueStatus[] = [
  'REPORTED',
  'UNDER_REVIEW',
  'ASSIGNED',
  'IN_PROGRESS',
  'ON_HOLD',
  'RESOLVED',
  'CLOSED',
  'REJECTED',
  'REOPENED',
];

afterEach(() => {
  vi.useRealTimers();
});

describe('Status and priority metadata', () => {
  it('covers every status in the enum', () => {
    for (const status of ISSUE_STATUSES) {
      expect(STATUS_META[status]).toBeDefined();
      expect(STATUS_META[status].label).toBeTruthy();
      expect(STATUS_META[status].badge).toBeTruthy();
    }
  });

  it('gives every status a text label, not colour alone', () => {
    // Accessibility: colour must never be the only carrier of meaning.
    for (const status of ISSUE_STATUSES) {
      expect(STATUS_META[status].label.length).toBeGreaterThan(2);
    }
  });

  it('ranks priorities in ascending order of urgency', () => {
    expect(PRIORITY_META.LOW.rank).toBeLessThan(PRIORITY_META.MEDIUM.rank);
    expect(PRIORITY_META.MEDIUM.rank).toBeLessThan(PRIORITY_META.HIGH.rank);
    expect(PRIORITY_META.HIGH.rank).toBeLessThan(PRIORITY_META.CRITICAL.rank);
  });

  it('labels every role', () => {
    expect(ROLE_LABEL.CITIZEN).toBeTruthy();
    expect(ROLE_LABEL.WORKER).toBeTruthy();
    expect(ROLE_LABEL.ADMIN).toBeTruthy();
  });

  it('falls back to the raw value for an unknown status', () => {
    // Defensive: a new server enum value must not render as "undefined".
    expect(statusLabel('SOMETHING_NEW' as never)).toBe('SOMETHING_NEW');
    expect(priorityLabel('EXTREME' as never)).toBe('EXTREME');
  });
});

describe('Date formatting', () => {
  it('renders an em dash for null, undefined and empty input', () => {
    for (const value of [null, undefined, '']) {
      expect(formatDateTime(value)).toBe('—');
      expect(formatDate(value)).toBe('—');
      expect(relativeTime(value)).toBe('—');
    }
  });

  it('renders an em dash rather than "Invalid Date" for junk', () => {
    expect(formatDateTime('not-a-date')).toBe('—');
    expect(formatDate('2026-13-45')).toBe('—');
    expect(relativeTime('nonsense')).toBe('—');
  });

  it('formats a real timestamp unambiguously', () => {
    const formatted = formatDateTime('2026-03-12T14:30:00.000Z');
    expect(formatted).toMatch(/Mar/);
    expect(formatted).toMatch(/2026/);
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-06-15T12:00:00.000Z');

  function at(offsetMs: number): string {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    return relativeTime(new Date(now.getTime() - offsetMs).toISOString());
  }

  it('says "just now" for the last few seconds', () => {
    expect(at(10_000)).toBe('just now');
  });

  it('counts minutes', () => {
    expect(at(5 * 60_000)).toBe('5 minutes ago');
  });

  it('singularises one minute', () => {
    expect(at(60_000)).toBe('1 minute ago');
  });

  it('counts hours', () => {
    expect(at(3 * 3_600_000)).toBe('3 hours ago');
  });

  it('counts days', () => {
    expect(at(4 * 86_400_000)).toBe('4 days ago');
  });

  it('counts months', () => {
    expect(at(90 * 86_400_000)).toBe('3 months ago');
  });

  it('counts years and singularises one year', () => {
    expect(at(400 * 86_400_000)).toBe('1 year ago');
  });
});

describe('formatDuration', () => {
  it('renders an em dash for no value', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(undefined)).toBe('—');
  });

  it('uses minutes below an hour', () => {
    expect(formatDuration(0.5)).toBe('30 min');
  });

  it('uses hours in the working range', () => {
    expect(formatDuration(6)).toBe('6.0 h');
  });

  it('switches to days past two', () => {
    expect(formatDuration(72)).toBe('3.0 days');
  });

  it('handles zero without dividing by nothing', () => {
    expect(formatDuration(0)).toBe('0 min');
  });
});

describe('formatBytes', () => {
  it('renders bytes, kilobytes and megabytes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('handles zero', () => {
    expect(formatBytes(0)).toBe('0 B');
  });
});

describe('Coordinates', () => {
  it('formats to five decimal places', () => {
    expect(formatCoords(28.2456789, 77.0712345)).toBe('28.24568, 77.07123');
  });

  it('handles negative coordinates', () => {
    expect(formatCoords(-33.8688, 151.2093)).toBe('-33.86880, 151.20930');
  });

  it('builds a working OpenStreetMap link with no API key', () => {
    const link = mapLink(28.25, 77.07);
    expect(link).toContain('openstreetmap.org');
    expect(link).toContain('mlat=28.25');
    expect(link).toContain('mlon=77.07');
    expect(() => new URL(link)).not.toThrow();
  });
});

describe('initials', () => {
  it('takes the first letter of the first two words', () => {
    expect(initials('Priya Nair')).toBe('PN');
  });

  it('handles a single name', () => {
    expect(initials('Cher')).toBe('C');
  });

  it('ignores extra words and stray whitespace', () => {
    expect(initials('  Arjun  Kumar  Singh ')).toBe('AK');
  });

  it('returns an empty string rather than crashing on empty input', () => {
    expect(initials('')).toBe('');
    expect(initials('   ')).toBe('');
  });
});
