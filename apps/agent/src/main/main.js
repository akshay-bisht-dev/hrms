// @ts-check
/**
 * Workforce HRMS desktop app: main process (trusted). Security settings follow Phase 1 §5.1:
 * contextIsolation, sandbox, no Node in the renderer, no navigation or new windows, a strict CSP, IPC accepted only
 * from our own page with validated payloads. Transparency (§5.3): the tray icon is always present and says when
 * monitoring is on and when the next capture is due; the OS shows a notification when monitoring starts or stops.
 */
import {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  desktopCapturer,
  ipcMain,
  nativeImage,
  powerMonitor,
  safeStorage,
  screen,
  session,
} from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApi, RevokedError } from './core/api.js';
import { createController } from './core/controller.js';
import { captureScreen, deviceFacts, foregroundApp, tokenStore } from './platform.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(here, '..', 'renderer', 'index.html');
const PAGE_URL = pathToFileURL(PAGE).href;
const VERSION = '0.1.0';
const API_URL = (process.env.HRMS_API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
// Development and tests only: take the first screenshot sooner. Ignored in packaged builds.
const FIRST_CAPTURE_MS =
  !app.isPackaged && process.env.HRMS_AGENT_FIRST_CAPTURE_MS
    ? Number(process.env.HRMS_AGENT_FIRST_CAPTURE_MS)
    : null;

if (!app.requestSingleInstanceLock()) app.quit();
// The OS sandbox is on for every process. The only exception is an unpackaged build in a CI container that runs
// as root (Chromium can't sandbox there); packaged builds ignore the variable.
if (!(process.env.HRMS_AGENT_CI_NO_OS_SANDBOX === '1' && !app.isPackaged)) app.enableSandbox();

/** @type {BrowserWindow | null} */
let win = null;
/** @type {Tray | null} */
let tray = null;
/** @type {ReturnType<typeof createController> | null} */
let controller = null;
let locked = false;
let wasMonitoring = false;
/** @type {any} */
let lastState = { paired: false };

const tokens = tokenStore({ dir: app.getPath('userData'), safeStorage });
const api = createApi({ baseUrl: API_URL, tokens });

const TRAY_ICON = nativeImage.createFromDataURL(
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMklEQVR4nGNgGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIyCUTAKRsEoGAUAAI8AAQ0YqbYAAAAASUVORK5CYII=',
);

function send(/** @type {any} */ state) {
  lastState = state;
  win?.webContents.send('agent:state', publicState(state));
  updateTray(state);
  if (state.monitoringOn !== wasMonitoring) {
    wasMonitoring = state.monitoringOn;
    if (Notification.isSupported())
      new Notification({
        title: wasMonitoring ? 'Screen monitoring is ON' : 'Screen monitoring is OFF',
        body: wasMonitoring
          ? 'Screenshots are taken while your work session runs. Take a break or end the session to stop them.'
          : 'No screenshots are being taken.',
      }).show();
  }
}

/** What the status window may see (no tokens). @param {any} s */
function publicState(s) {
  return {
    paired: s.paired !== false,
    online: s.online,
    monitoringOn: Boolean(s.monitoringOn),
    reason: s.decision?.reason ?? null,
    policy: s.decision?.capture
      ? { intervalMin: s.decision.policy.intervalMin, captureMode: s.decision.policy.captureMode }
      : null,
    idle: s.idle,
    lastCaptureAt: s.lastCaptureAt,
    nextCaptureAt: s.nextCaptureAt,
    lastSkip: s.lastSkip,
    error: s.error,
    device: s.me?.device ?? null,
    monitoring: s.me?.monitoring
      ? {
          enabled: s.me.monitoring.enabled,
          reason: s.me.monitoring.reason,
          activation: s.me.monitoring.activation ?? null,
          notice: s.me.monitoring.notice ?? null,
          legalReviewed: s.me.monitoring.legalReviewed ?? null,
        }
      : null,
    work: s.me?.work
      ? {
          employee: s.me.work.employee,
          active: s.me.work.active
            ? {
                id: s.me.work.active.id,
                status: s.me.work.active.status,
                startedAt: s.me.work.active.startedAt,
                workedSec: s.me.work.active.workedSec,
              }
            : null,
          locations: (s.me.work.locations ?? []).map((/** @type {any} */ l) => ({
            id: l.id,
            name: l.name,
            available: l.available,
          })),
          disclosure: s.me.work.disclosure,
        }
      : null,
  };
}

function updateTray(/** @type {any} */ s) {
  if (!tray) return;
  const time = (/** @type {any} */ d) =>
    d ? new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
  const label =
    s.paired === false
      ? 'Not connected'
      : s.monitoringOn
        ? `Monitoring ON — next screenshot ~${time(s.nextCaptureAt)}`
        : s.me?.work?.active
          ? `Work session ${s.me.work.active.status === 'ON_BREAK' ? 'on a break' : 'running'} — no screenshots`
          : 'No work session';
  tray.setToolTip(`Workforce HRMS: ${label}`);
  tray.setTitle(s.monitoringOn ? ' ● Monitoring ON' : '');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label, enabled: false },
      { type: 'separator' },
      { label: 'Open', click: () => showWindow() },
      ...(s.me?.work?.active?.status === 'ACTIVE'
        ? [
            {
              label: 'Take a break (stops screenshots)',
              click: () => controller?.startBreak().catch(() => {}),
            },
          ]
        : []),
      ...(s.me?.work?.active?.status === 'ON_BREAK'
        ? [{ label: 'Back to work', click: () => controller?.endBreak().catch(() => {}) }]
        : []),
      ...(s.me?.work?.active
        ? [{ label: 'End work session', click: () => controller?.endSession().catch(() => {}) }]
        : []),
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
}

function showWindow() {
  if (win) {
    win.show();
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 460,
    height: 680,
    title: 'Workforce HRMS',
    show: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(here, '..', 'preload', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== PAGE_URL) e.preventDefault();
  });
  win.on('closed', () => (win = null));
  win.loadFile(PAGE);
}

/** Starts the controller once this computer is paired. */
async function startController() {
  controller?.stop();
  controller = createController({
    api,
    capture: (opts) => captureScreen({ desktopCapturer, screen }, opts),
    foregroundApp: () => foregroundApp(),
    idleSeconds: () => powerMonitor.getSystemIdleTime(),
    isLocked: () => locked,
    onChange: send,
    firstCaptureMs: FIRST_CAPTURE_MS,
    log: (msg, extra) => console.log(`[agent] ${msg}`, extra ?? ''),
  });
  try {
    await controller.start();
  } catch (err) {
    if (err instanceof RevokedError) send({ paired: false, error: err.message });
  }
}

/** IPC: only our own page, only known channels, only checked payloads. */
function handle(/** @type {string} */ channel, /** @type {(payload: any) => Promise<any>} */ fn) {
  ipcMain.handle(channel, async (event, payload) => {
    if (event.senderFrame?.url !== PAGE_URL) throw new Error('Refused');
    try {
      await fn(payload ?? {});
      return { ok: true, state: publicState(controller?.state() ?? lastState) };
    } catch (err) {
      return {
        ok: false,
        error: /** @type {any} */ (err)?.message ?? 'Something went wrong',
        state: publicState(controller?.state() ?? lastState),
      };
    }
  });
}
const uuid = (/** @type {unknown} */ v) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);

handle('agent:get-state', async () => {});
handle('agent:pair', async ({ code, ownership }) => {
  if (typeof code !== 'string' || code.length > 12) throw new Error('Enter the code from the web app');
  await api.register(code.trim(), {
    ...(await deviceFacts(VERSION)),
    ownership: ownership === 'BYOD' ? 'BYOD' : 'COMPANY_MANAGED',
  });
  await startController();
});
handle('agent:acknowledge', async ({ activationId }) => {
  if (!uuid(activationId)) throw new Error('Invalid notice');
  await controller?.acknowledge(activationId);
});
handle('agent:start-session', async ({ workLocationId }) => {
  if (!uuid(workLocationId)) throw new Error('Choose where you are working');
  await controller?.startSession(workLocationId);
});
handle('agent:start-break', async () => controller?.startBreak());
handle('agent:end-break', async () => controller?.endBreak());
handle('agent:end-session', async () => controller?.endSession());
handle('agent:sign-out', async () => {
  controller?.stop();
  controller = null;
  await api.signOut();
  send({ paired: false });
});

app.on('second-instance', () => showWindow());
app.on('window-all-closed', () => {
  /* keep running in the tray */
});
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault());
});

app.whenReady().then(async () => {
  // Strict CSP for everything the app loads; it only ever loads its own files.
  session.defaultSession.webRequest.onHeadersReceived((details, cb) =>
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
        ],
      },
    }),
  );
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false)); // no camera, mic, notifications prompts, etc.
  powerMonitor.on('lock-screen', () => {
    locked = true;
    controller?.onLock().catch(() => {});
  });
  powerMonitor.on('suspend', () => {
    locked = true;
    controller?.onLock().catch(() => {});
  });
  powerMonitor.on('unlock-screen', () => {
    locked = false;
    controller?.pollIdle().catch(() => {});
  });
  powerMonitor.on('resume', () => {
    locked = false;
    controller?.refresh().catch(() => {});
  });
  tray = new Tray(TRAY_ICON);
  updateTray(lastState);
  showWindow();
  if ((await tokens.get())?.refreshToken) await startController();
  else send({ paired: false });
});
