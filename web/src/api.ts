/**
 * The API's behaviour, not a reimplementation of it: the server remains the
 * authority on every rule (the status state machine, ownership scoping), and an
 * error it returns is surfaced rather than hidden.
 */

export const STATUSES = [
  'APPLIED',
  'SCREEN',
  'ONSITE',
  'OFFER',
  'REJECTED',
] as const;

export type Status = (typeof STATUSES)[number];

/** Mirrors the server's table; the server still rejects an illegal move with a 400. */
export const TRANSITIONS: Record<Status, Status[]> = {
  APPLIED: ['SCREEN', 'REJECTED'],
  SCREEN: ['ONSITE', 'REJECTED'],
  ONSITE: ['OFFER', 'REJECTED'],
  OFFER: ['REJECTED'],
  REJECTED: [],
};

export type Company = { id: string; name: string };

export type StatusEvent = {
  id: string;
  fromStatus: Status | null;
  toStatus: Status;
  note: string | null;
  createdAt: string;
};

export type Application = {
  id: string;
  role: string;
  status: Status;
  appliedAt: string;
  source: string | null;
  notes: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  company?: Company;
  events?: StatusEvent[];
};

export type Stats = {
  total: number;
  activePipeline: number;
  byStatus: Partial<Record<Status, number>>;
};

export const token = {
  get: () => localStorage.getItem('jt_access'),
  set: (t: string) => localStorage.setItem('jt_access', t),
  clear: () => localStorage.removeItem('jt_access'),
};

/** Set by App so an expired session drops the whole UI back to the login view. */
let onUnauthorized = (): void => {};
export const setOnUnauthorized = (fn: () => void): void => {
  onUnauthorized = fn;
};

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const access = token.get();
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(access ? { Authorization: `Bearer ${access}` } : {}),
      ...options.headers,
    },
  });

  if (res.status === 401) {
    token.clear();
    onUnauthorized();
    throw new Error('Session expired — sign in again');
  }

  if (res.status === 204) return null as T;

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // The API returns a consistent envelope; `message` may be a string or an array.
    const { message } = body as { message?: string | string[] };
    throw new Error(
      (Array.isArray(message) ? message.join(', ') : message) ||
        `Request failed (${res.status})`,
    );
  }
  return body as T;
}
