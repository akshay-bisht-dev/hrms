// Status window (sandboxed): shows exactly what the app does and lets the person control it.
// It talks only to window.agent (the preload bridge); it has no network or file access.
const app = document.getElementById('app');
let state = null;
let busy = false;

const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  if (tag === 'button' && busy) n.disabled = true;
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'onClick') n.addEventListener('click', v);
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c) n.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return n;
};
const time = (d) => (d ? new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');

let lastError = null;
async function run(fn) {
  if (busy) return;
  busy = true;
  lastError = null;
  render(); // buttons show as disabled while the action runs
  try {
    const r = await fn();
    if (r?.state) state = r.state;
    lastError = r?.ok === false ? r.error : null;
  } catch (e) {
    lastError = e?.message ?? 'Something went wrong';
  } finally {
    busy = false;
    render(lastError);
  }
}

// What the desktop app itself records (the web app's list talks about the browser).
const RECORDED = [
  'When you start and end a work session, and where you said you are working',
  'When your breaks start and end',
  'That this app is running: a small signal about once a minute, only while a session runs',
  'When your computer has had no keyboard or mouse use for the time your policy sets (only that fact, never what you typed or clicked)',
];

const REASONS = {
  NOT_ACTIVATED: 'Your company has not turned on screen monitoring.',
  OUT_OF_SCOPE: 'Screen monitoring does not apply to you.',
  JURISDICTION_UNKNOWN: 'Screen monitoring is not available in your work country.',
  JURISDICTION_NOT_ALLOWED: 'Screen monitoring is not allowed in your work country.',
  JURISDICTION_STEPS_MISSING: 'Your company has not finished the steps your country requires.',
  NOTICE_PERIOD: 'The notice period has not ended yet.',
  NO_POLICY: 'No screenshot policy applies to you.',
  ACK_REQUIRED: 'Please read the notice below.',
};

function render(error = null) {
  app.replaceChildren();
  if (!state || !state.paired) return renderPairing(error);
  const s = state;
  const active = s.work?.active;
  app.append(
    el(
      'div',
      {
        class: `banner ${s.monitoringOn ? 'on' : 'off'}`,
        role: 'status',
        'data-testid': 'monitoring-banner',
      },
      s.monitoringOn
        ? `Screen monitoring is ON — next screenshot around ${time(s.nextCaptureAt)}`
        : 'Screen monitoring is OFF — no screenshots are taken',
    ),
  );
  if (error || s.error) app.append(el('p', { class: 'error', role: 'alert' }, error || s.error));
  if (s.device?.status === 'PENDING')
    app.append(
      el(
        'p',
        { class: 'muted' },
        'An administrator still has to approve this computer before any screenshot can be taken.',
      ),
    );
  // Notice to acknowledge.
  if (s.monitoring?.reason === 'ACK_REQUIRED' && s.monitoring.notice) {
    app.append(
      el(
        'section',
        { 'aria-label': 'Monitoring notice' },
        el('h2', {}, 'Monitoring notice'),
        el('div', { class: 'notice' }, s.monitoring.notice.text),
        el('p', { class: 'muted' }, `Purpose: ${s.monitoring.notice.purpose ?? ''}`),
        el(
          'div',
          { class: 'row' },
          el(
            'button',
            { onClick: () => run(() => window.agent.acknowledge(s.monitoring.activation.id)) },
            'I have read the notice',
          ),
        ),
      ),
    );
  }
  // Session.
  const session = el(
    'section',
    { 'aria-label': 'Work session' },
    el(
      'h2',
      {},
      active
        ? `Work session ${active.status === 'ON_BREAK' ? '(on a break)' : 'running'}`
        : 'No work session',
    ),
  );
  if (!active) {
    const sel = el(
      'select',
      { id: 'location' },
      ...(s.work?.locations ?? [])
        .filter((l) => l.available)
        .map((l) => el('option', { value: l.id }, l.name)),
    );
    session.append(
      el('label', { for: 'location' }, 'Where are you working?'),
      sel,
      el(
        'div',
        { class: 'row' },
        el('button', { onClick: () => run(() => window.agent.startSession(sel.value)) }, 'Start work'),
      ),
    );
  } else {
    const row = el('div', { class: 'row' });
    if (active.status === 'ON_BREAK')
      row.append(el('button', { onClick: () => run(() => window.agent.endBreak()) }, 'Back to work'));
    else
      row.append(
        el(
          'button',
          { class: 'secondary', onClick: () => run(() => window.agent.startBreak()) },
          'Take a break',
        ),
      );
    row.append(
      el('button', { class: 'secondary', onClick: () => run(() => window.agent.endSession()) }, 'End work'),
    );
    session.append(row);
  }
  app.append(session);
  // What is recorded.
  const why = s.monitoringOn ? null : (REASONS[s.monitoring?.reason] ?? null);
  app.append(
    el(
      'section',
      { 'aria-label': 'What this app records' },
      el('h2', {}, 'What this app records'),
      el(
        'ul',
        {},
        ...RECORDED.map((x) => el('li', {}, x)),
        s.monitoringOn
          ? el(
              'li',
              {},
              `A screenshot of your screen about every ${s.policy?.intervalMin} minutes${s.policy?.captureMode === 'BLURRED' ? ' (blurred)' : ''}, only while your session runs and not during breaks, when idle or locked.`,
            )
          : null,
      ),
      el('h2', {}, 'Never recorded'),
      el(
        'ul',
        {},
        el('li', {}, 'Keystrokes, clipboard or passwords'),
        el('li', {}, 'Webcam or microphone'),
        el('li', {}, 'Anything outside a work session'),
      ),
      why ? el('p', { class: 'muted' }, why) : null,
      s.monitoringOn && s.monitoring?.legalReviewed === false
        ? el(
            'p',
            { class: 'muted' },
            'Your company is responsible for the legal basis for monitoring in your country.',
          )
        : null,
      el(
        'p',
        { class: 'muted' },
        `Last screenshot: ${time(s.lastCaptureAt)}${s.lastSkip ? ` · last skipped: ${s.lastSkip.reason.toLowerCase().replace('_', ' ')}` : ''}. You can see your screenshots in the web app.`,
      ),
    ),
  );
  app.append(
    el(
      'div',
      { class: 'row' },
      el(
        'button',
        { class: 'secondary', onClick: () => run(() => window.agent.signOut()) },
        'Disconnect this computer',
      ),
    ),
  );
}

function renderPairing(error) {
  const code = el('input', { id: 'code', autocomplete: 'off', placeholder: 'XXXX-XXXX', maxlength: '9' });
  const own = el(
    'select',
    { id: 'ownership' },
    el('option', { value: 'COMPANY_MANAGED' }, 'A company computer'),
    el('option', { value: 'BYOD' }, 'My own computer'),
  );
  app.append(
    el(
      'section',
      { 'aria-label': 'Connect this computer' },
      el('h2', {}, 'Connect this computer'),
      el(
        'p',
        { class: 'muted' },
        'In the web app, open My work → Connect the desktop app, and enter the code here.',
      ),
      error ? el('p', { class: 'error', role: 'alert' }, error) : null,
      el('label', { for: 'code' }, 'Pairing code'),
      code,
      el('label', { for: 'ownership' }, 'This is'),
      own,
      el(
        'p',
        { class: 'muted' },
        'Screenshots are only ever taken on company computers, and only if your company turned them on and told you.',
      ),
      el(
        'div',
        { class: 'row' },
        el('button', { onClick: () => run(() => window.agent.pair(code.value, own.value)) }, 'Connect'),
      ),
    ),
  );
}

window.agent.onState((s) => {
  state = s;
  if (!busy) render(lastError);
});
window.agent.getState().then((r) => {
  state = r.state;
  render();
});
