import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  setOnUnauthorized,
  STATUSES,
  token,
  TRANSITIONS,
  type Application,
  type Company,
  type Stats,
  type Status,
} from './api';

const fmt = (n: number | null): string => (n == null ? '?' : n.toLocaleString());

/* ── health ───────────────────────────────────────────────── */

type Health = { text: string; cls: string };

function HealthPill(): React.JSX.Element {
  const [health, setHealth] = useState<Health>({
    text: 'checking…',
    cls: 'pill-muted',
  });

  useEffect(() => {
    const check = async (): Promise<void> => {
      try {
        const res = await fetch('/health/ready');
        const body = (await res.json()) as {
          info?: Record<string, { status: string }>;
          error?: Record<string, { status: string }>;
        };
        const info = body.info ?? body.error ?? {};
        const down = Object.entries(info)
          .filter(([, v]) => v.status !== 'up')
          .map(([k]) => k);

        setHealth(
          res.ok && !down.length
            ? { text: 'healthy', cls: 'pill-ok' }
            : {
                text: `degraded: ${down.join(', ') || 'unknown'}`,
                cls: 'pill-bad',
              },
        );
      } catch {
        setHealth({ text: 'unreachable', cls: 'pill-bad' });
      }
    };

    void check();
    const id = setInterval(() => void check(), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <span className={`pill ${health.cls}`} title="GET /health/ready">
      {health.text}
    </span>
  );
}

/* ── login ────────────────────────────────────────────────── */

function Login({ onIn }: { onIn: () => void }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError('');

    try {
      const { accessToken } = await api<{ accessToken: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: form.get('email'),
          password: form.get('password'),
        }),
      });
      token.set(accessToken);
      onIn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="centered">
      <form className="card auth" onSubmit={(e) => void submit(e)}>
        <h2>Sign in</h2>
        <p className="muted">Demo credentials are pre-filled.</p>

        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          defaultValue="demo@jobtrack.dev"
          required
          autoComplete="username"
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          defaultValue="DemoPassw0rd!"
          required
          autoComplete="current-password"
        />

        <button type="submit" className="primary" disabled={busy}>
          Sign in
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </main>
  );
}

/* ── new application ──────────────────────────────────────── */

function NewDialog({
  companies,
  onAdded,
}: {
  companies: Company[];
  onAdded: () => void;
}): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setError('');

    const num = (k: string): number | undefined => {
      const v = data.get(k);
      return v ? Number(v) : undefined;
    };

    try {
      await api('/applications', {
        method: 'POST',
        body: JSON.stringify({
          companyId: data.get('companyId'),
          role: data.get('role'),
          salaryMin: num('salaryMin'),
          salaryMax: num('salaryMax'),
          notes: data.get('notes') || undefined,
        }),
      });
      dialog.current?.close();
      form.reset();
      onAdded();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <>
      <button className="primary small" onClick={() => dialog.current?.showModal()}>
        Track an application
      </button>

      <dialog ref={dialog} className="card">
        <form onSubmit={(e) => void submit(e)}>
          <h2>Track an application</h2>

          <label htmlFor="new-company">Company</label>
          <select id="new-company" name="companyId" required>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <label htmlFor="new-role">Role</label>
          <input
            id="new-role"
            name="role"
            required
            placeholder="Senior Backend Engineer"
          />

          <div className="row">
            <div>
              <label htmlFor="new-min">Salary min</label>
              <input
                id="new-min"
                name="salaryMin"
                type="number"
                min="0"
                placeholder="90000"
              />
            </div>
            <div>
              <label htmlFor="new-max">Salary max</label>
              <input
                id="new-max"
                name="salaryMax"
                type="number"
                min="0"
                placeholder="200000"
              />
            </div>
          </div>

          <label htmlFor="new-notes">Notes</label>
          <textarea
            id="new-notes"
            name="notes"
            rows={2}
            placeholder="Where did you find it?"
          />

          {error && <p className="error">{error}</p>}

          <menu>
            <button
              type="button"
              className="ghost"
              onClick={() => dialog.current?.close()}
            >
              Cancel
            </button>
            <button type="submit" className="primary">
              Add
            </button>
          </menu>
        </form>
      </dialog>
    </>
  );
}

/* ── detail drawer ────────────────────────────────────────── */

function Drawer({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}): React.JSX.Element | null {
  const [app, setApp] = useState<Application | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async (): Promise<void> => {
    setApp(await api<Application>(`/applications/${id}`));
  }, [id]);

  useEffect(() => {
    void load().catch((err: Error) => setError(err.message));
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const advance = async (to: Status): Promise<void> => {
    if (!app) return;
    const note =
      prompt(`Note for the ${app.status} → ${to} transition (optional):`) ||
      undefined;
    setError('');

    try {
      await api(`/applications/${app.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: to, note }),
      });
      await load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (!app) return null;
  const legal = TRANSITIONS[app.status];

  return (
    <>
      <aside className="drawer">
        <div className="drawer-head">
          <div>
            <h2>{app.role}</h2>
            <p className="muted">{app.company?.name ?? ''}</p>
          </div>
          <button className="ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="drawer-body">
          <div className="field">
            <span className="muted">Status</span>
            <span>
              <span className={`pill s-${app.status}`}>{app.status}</span>
            </span>
          </div>
          <div className="field">
            <span className="muted">Applied</span>
            <span>{new Date(app.appliedAt).toLocaleDateString()}</span>
          </div>
          <div className="field">
            <span className="muted">Salary</span>
            <span>
              {app.salaryMin || app.salaryMax
                ? `${fmt(app.salaryMin)} – ${fmt(app.salaryMax)}`
                : '—'}
            </span>
          </div>
          <div className="field">
            <span className="muted">Source</span>
            <span>{app.source || '—'}</span>
          </div>

          {app.notes && (
            <div className="notes">
              <span className="muted">Notes</span>
              <p>{app.notes}</p>
            </div>
          )}

          <h3>Advance status</h3>
          <p className="muted small-text">
            Only legal transitions are offered — the API rejects the rest with a
            400.
          </p>
          <div className="actions">
            {legal.length ? (
              legal.map((st) => (
                <button
                  key={st}
                  className="small"
                  onClick={() => void advance(st)}
                >
                  Move to <strong className={`s-${st}`}>{st}</strong>
                </button>
              ))
            ) : (
              <p className="muted small-text">
                Terminal state — no moves available.
              </p>
            )}
          </div>
          {error && <p className="error">{error}</p>}

          <h3>Audit trail</h3>
          <p className="muted small-text">
            Every status change is written with its event in one transaction.
          </p>
          <ol className="timeline">
            {app.events?.length ? (
              app.events.map((e) => (
                <li key={e.id}>
                  <div>
                    <span className={`s-${e.fromStatus ?? 'APPLIED'}`}>
                      {e.fromStatus ?? '—'}
                    </span>{' '}
                    →{' '}
                    <span className={`s-${e.toStatus}`}>{e.toStatus}</span>
                  </div>
                  <div className="t">{new Date(e.createdAt).toLocaleString()}</div>
                  {e.note && <p className="n">{e.note}</p>}
                </li>
              ))
            ) : (
              <p className="muted small-text">No transitions yet.</p>
            )}
          </ol>
        </div>
      </aside>
      <div className="scrim" onClick={onClose} />
    </>
  );
}

/* ── dashboard ────────────────────────────────────────────── */

function Dashboard(): React.JSX.Element {
  const [stats, setStats] = useState<Stats | null>(null);
  const [apps, setApps] = useState<Application[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  const reload = useCallback((): void => {
    void api<Stats>('/applications/stats').then(setStats);
    void api<{ data: Application[] }>('/applications?limit=100').then((r) =>
      setApps(r.data),
    );
  }, []);

  useEffect(() => {
    reload();
    void api<Company[]>('/companies').then(setCompanies);
  }, [reload]);

  const tiles = stats && [
    { k: 'Total', n: stats.total },
    { k: 'Active pipeline', n: stats.activePipeline },
    ...STATUSES.map((st) => ({
      k: st.toLowerCase(),
      n: stats.byStatus[st] ?? 0,
      st,
    })),
  ];

  return (
    <main>
      <section className="stats">
        {tiles?.map((t) => (
          <div className="stat" key={t.k}>
            <div className={`n ${'st' in t ? `s-${t.st}` : ''}`}>{t.n}</div>
            <div className="k">{t.k}</div>
          </div>
        ))}
      </section>

      <section className="toolbar">
        <h2>Pipeline</h2>
        <NewDialog companies={companies} onAdded={reload} />
      </section>

      <section className="board">
        {STATUSES.map((st) => {
          const items = apps.filter((a) => a.status === st);
          return (
            <div className="col" key={st}>
              <div className="col-head">
                <span className={`s-${st}`}>{st}</span>
                <span className="count">{items.length}</span>
              </div>
              {items.length ? (
                items.map((a) => (
                  <button
                    className="item"
                    key={a.id}
                    onClick={() => setSelected(a.id)}
                  >
                    <div className="r">{a.role}</div>
                    <div className="c">{a.company?.name ?? ''}</div>
                  </button>
                ))
              ) : (
                <p className="empty">—</p>
              )}
            </div>
          );
        })}
      </section>

      {selected && (
        <Drawer
          id={selected}
          onClose={() => setSelected(null)}
          onChanged={reload}
        />
      )}
    </main>
  );
}

/* ── shell ────────────────────────────────────────────────── */

export default function App(): React.JSX.Element {
  const [authed, setAuthed] = useState(!!token.get());

  useEffect(() => setOnUnauthorized(() => setAuthed(false)), []);

  const logout = async (): Promise<void> => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      // Revoking server-side is best-effort; the local token goes regardless.
    }
    token.clear();
    setAuthed(false);
  };

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="mark">JT</span>
          <div>
            <h1>JobTrack</h1>
            <p className="sub">Job application pipeline</p>
          </div>
        </div>
        <div className="topbar-right">
          <a className="ghost" href="/docs" target="_blank" rel="noopener">
            API docs
          </a>
          <HealthPill />
          {authed && (
            <button className="ghost" onClick={() => void logout()}>
              Sign out
            </button>
          )}
        </div>
      </header>

      {authed ? <Dashboard /> : <Login onIn={() => setAuthed(true)} />}
    </>
  );
}
