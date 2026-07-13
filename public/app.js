/**
 * JobTrack dashboard — dependency-free, no build step.
 *
 * Deliberately thin: it demonstrates the API's behaviour (the status state
 * machine, the audit trail, ownership scoping) rather than reimplementing any
 * of it. The legal-transition table below mirrors the server's, but the server
 * is still the authority — an illegal move is rejected there with a 400, and
 * this page surfaces that error rather than hiding it.
 */

const STATUSES = ['APPLIED', 'SCREEN', 'ONSITE', 'OFFER', 'REJECTED'];
const TRANSITIONS = {
  APPLIED: ['SCREEN', 'REJECTED'],
  SCREEN: ['ONSITE', 'REJECTED'],
  ONSITE: ['OFFER', 'REJECTED'],
  OFFER: ['REJECTED'],
  REJECTED: [],
};

const $ = (id) => document.getElementById(id);
const token = {
  get: () => localStorage.getItem('jt_access'),
  set: (t) => localStorage.setItem('jt_access', t),
  clear: () => localStorage.removeItem('jt_access'),
};

let companies = [];
let current = null;

/* ── api ──────────────────────────────────────────────────── */

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token.get() ? { Authorization: `Bearer ${token.get()}` } : {}),
      ...options.headers,
    },
  });

  if (res.status === 401) {
    token.clear();
    showLogin();
    throw new Error('Session expired — sign in again');
  }

  if (res.status === 204) return null;

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // The API returns a consistent envelope; `message` may be a string or an array.
    const msg = Array.isArray(body.message)
      ? body.message.join(', ')
      : body.message || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return body;
}

/* ── views ────────────────────────────────────────────────── */

function showLogin() {
  $('login-view').hidden = false;
  $('app-view').hidden = true;
  $('logout').hidden = true;
  closeDrawer();
}

async function showApp() {
  $('login-view').hidden = true;
  $('app-view').hidden = false;
  $('logout').hidden = false;
  await Promise.all([loadStats(), loadBoard(), loadCompanies()]);
}

/* ── stats ────────────────────────────────────────────────── */

async function loadStats() {
  const s = await api('/applications/stats');
  const tiles = [
    { k: 'Total', n: s.total },
    { k: 'Active pipeline', n: s.activePipeline },
    ...STATUSES.map((st) => ({ k: st.toLowerCase(), n: s.byStatus[st] ?? 0, st })),
  ];

  $('stats').innerHTML = tiles
    .map(
      (t) => `
      <div class="stat">
        <div class="n ${t.st ? `s-${t.st}` : ''}">${t.n}</div>
        <div class="k">${t.k}</div>
      </div>`,
    )
    .join('');
}

/* ── board ────────────────────────────────────────────────── */

async function loadBoard() {
  const { data } = await api('/applications?limit=100');

  $('board').innerHTML = STATUSES.map((st) => {
    const items = data.filter((a) => a.status === st);
    const cards = items.length
      ? items
          .map(
            (a) => `
            <button class="item" data-id="${a.id}">
              <div class="r">${esc(a.role)}</div>
              <div class="c">${esc(a.company?.name ?? '')}</div>
            </button>`,
          )
          .join('')
      : '<p class="empty">—</p>';

    return `
      <div class="col">
        <div class="col-head">
          <span class="s-${st}">${st}</span>
          <span class="count">${items.length}</span>
        </div>
        ${cards}
      </div>`;
  }).join('');

  document
    .querySelectorAll('.item')
    .forEach((el) => el.addEventListener('click', () => openDrawer(el.dataset.id)));
}

async function loadCompanies() {
  companies = await api('/companies');
  $('new-company').innerHTML = companies
    .map((c) => `<option value="${c.id}">${esc(c.name)}</option>`)
    .join('');
}

/* ── drawer ───────────────────────────────────────────────── */

async function openDrawer(id) {
  current = await api(`/applications/${id}`);

  $('d-role').textContent = current.role;
  $('d-company').textContent = current.company?.name ?? '';
  $('d-status').innerHTML = `<span class="pill s-${current.status}">${current.status}</span>`;
  $('d-applied').textContent = new Date(current.appliedAt).toLocaleDateString();
  $('d-source').textContent = current.source || '—';
  $('d-salary').textContent =
    current.salaryMin || current.salaryMax
      ? `${fmt(current.salaryMin)} – ${fmt(current.salaryMax)}`
      : '—';

  $('d-notes-wrap').hidden = !current.notes;
  $('d-notes').textContent = current.notes ?? '';

  const legal = TRANSITIONS[current.status] ?? [];
  $('d-actions').innerHTML = legal.length
    ? legal
        .map(
          (st) =>
            `<button class="small" data-to="${st}">Move to <strong class="s-${st}">${st}</strong></button>`,
        )
        .join('')
    : '<p class="muted small-text">Terminal state — no moves available.</p>';

  $('d-actions')
    .querySelectorAll('button')
    .forEach((b) => b.addEventListener('click', () => advance(b.dataset.to)));

  $('d-events').innerHTML = current.events?.length
    ? current.events
        .map(
          (e) => `
          <li>
            <div>
              <span class="s-${e.fromStatus ?? 'APPLIED'}">${e.fromStatus ?? '—'}</span>
              →
              <span class="s-${e.toStatus}">${e.toStatus}</span>
            </div>
            <div class="t">${new Date(e.createdAt).toLocaleString()}</div>
            ${e.note ? `<p class="n">${esc(e.note)}</p>` : ''}
          </li>`,
        )
        .join('')
    : '<p class="muted small-text">No transitions yet.</p>';

  $('d-error').hidden = true;
  $('drawer').hidden = false;
  $('scrim').hidden = false;
}

function closeDrawer() {
  $('drawer').hidden = true;
  $('scrim').hidden = true;
  current = null;
}

async function advance(to) {
  const note = prompt(`Note for the ${current.status} → ${to} transition (optional):`) || undefined;
  try {
    await api(`/applications/${current.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: to, note }),
    });
    await openDrawer(current.id);
    await Promise.all([loadStats(), loadBoard()]);
  } catch (err) {
    $('d-error').textContent = err.message;
    $('d-error').hidden = false;
  }
}

/* ── health ───────────────────────────────────────────────── */

async function checkHealth() {
  const pill = $('health');
  try {
    const res = await fetch('/health/ready');
    const body = await res.json();
    const info = body.info ?? body.error ?? {};
    const down = Object.entries(info)
      .filter(([, v]) => v.status !== 'up')
      .map(([k]) => k);

    if (res.ok && !down.length) {
      pill.textContent = 'healthy';
      pill.className = 'pill pill-ok';
    } else {
      pill.textContent = `degraded: ${down.join(', ') || 'unknown'}`;
      pill.className = 'pill pill-bad';
    }
  } catch {
    pill.textContent = 'unreachable';
    pill.className = 'pill pill-bad';
  }
}

/* ── utils ────────────────────────────────────────────────── */

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);

const fmt = (n) => (n == null ? '?' : n.toLocaleString());

/* ── wiring ───────────────────────────────────────────────── */

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('login-btn');
  const err = $('login-error');
  btn.disabled = true;
  err.hidden = true;

  try {
    const { accessToken } = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: $('email').value, password: $('password').value }),
    });
    token.set(accessToken);
    await showApp();
  } catch (e2) {
    err.textContent = e2.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

$('logout').addEventListener('click', async () => {
  try {
    await api('/auth/logout', { method: 'POST' });
  } catch {
    /* revoking server-side is best-effort; the local token goes regardless */
  }
  token.clear();
  showLogin();
});

$('new-btn').addEventListener('click', () => $('new-dialog').showModal());
$('new-cancel').addEventListener('click', () => $('new-dialog').close());

$('new-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('new-error');
  err.hidden = true;

  const body = {
    companyId: $('new-company').value,
    role: $('new-role').value,
  };
  if ($('new-min').value) body.salaryMin = Number($('new-min').value);
  if ($('new-max').value) body.salaryMax = Number($('new-max').value);
  if ($('new-notes').value) body.notes = $('new-notes').value;

  try {
    await api('/applications', { method: 'POST', body: JSON.stringify(body) });
    $('new-dialog').close();
    $('new-form').reset();
    await Promise.all([loadStats(), loadBoard()]);
  } catch (e2) {
    err.textContent = e2.message;
    err.hidden = false;
  }
});

$('d-close').addEventListener('click', closeDrawer);
$('scrim').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeDrawer());

/* boot */
checkHealth();
setInterval(checkHealth, 30_000);

if (token.get()) {
  showApp().catch(showLogin);
} else {
  showLogin();
}
