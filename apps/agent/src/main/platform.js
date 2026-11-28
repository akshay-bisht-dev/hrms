// @ts-check
/**
 * Platform pieces used by the controller. Nothing here reads keystrokes, the clipboard, the camera or the
 * microphone, and the app never asks for those permissions.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const MAX_BYTES = 2_000_000;
const MAX_WIDTH = 1600;

/** Runs a command with a short timeout; resolves to trimmed stdout or null. @param {string} cmd @param {string[]} args */
const run = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: 2000, windowsHide: true }, (err, stdout) =>
      resolve(err ? null : String(stdout).trim() || null),
    );
  });

/**
 * Name of the app in front (application name only, never the window title or content). Null when it can't be
 * determined, which makes the controller skip the capture (exclusions can't be checked).
 * @param {NodeJS.Platform} [platform]
 */
export async function foregroundApp(platform = process.platform) {
  if (platform === 'linux') {
    const id = await run('xdotool', ['getactivewindow']);
    if (!id) return null;
    const pid = await run('xdotool', ['getwindowpid', id]);
    if (!pid || !/^\d+$/.test(pid)) return null;
    return run('ps', ['-p', pid, '-o', 'comm=']);
  }
  if (platform === 'darwin')
    return run('osascript', [
      '-e',
      'tell application "System Events" to get name of first application process whose frontmost is true',
    ]);
  if (platform === 'win32')
    return run('powershell.exe', [
      '-NoProfile',
      '-Command',
      'Add-Type \'using System;using System.Runtime.InteropServices;public class W{[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);}\';$p=0;[W]::GetWindowThreadProcessId([W]::GetForegroundWindow(),[ref]$p)|Out-Null;(Get-Process -Id $p).ProcessName',
    ]);
  return null;
}

/**
 * Takes one screenshot of the primary display and returns WebP bytes (at most 2 MB). Blur is applied here, on the
 * device, so blurred content never leaves the computer; the server applies it again as a backstop.
 * @param {{ desktopCapturer: any, screen: any }} electron
 * @param {{ captureMode: string, blurZones: { x: number, y: number, w: number, h: number }[] }} opts
 */
export async function captureScreen({ desktopCapturer, screen }, { captureMode, blurZones }) {
  const d = screen.getPrimaryDisplay();
  const size = {
    width: Math.round(d.size.width * d.scaleFactor),
    height: Math.round(d.size.height * d.scaleFactor),
  };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
  const src = sources.find((/** @type {any} */ s) => String(s.display_id) === String(d.id)) ?? sources[0];
  if (!src || src.thumbnail.isEmpty()) throw new Error('No screen available to capture');
  let img = sharp(src.thumbnail.toPNG()).resize({ width: MAX_WIDTH, withoutEnlargement: true });
  let buf = await img.png().toBuffer();
  const meta = await sharp(buf).metadata();
  if (captureMode === 'BLURRED') buf = await sharp(buf).blur(12).png().toBuffer();
  else if (blurZones.length && meta.width && meta.height) {
    const overlays = [];
    for (const z of blurZones) {
      const left = Math.round(z.x * meta.width);
      const top = Math.round(z.y * meta.height);
      const width = Math.min(meta.width - left, Math.round(z.w * meta.width));
      const height = Math.min(meta.height - top, Math.round(z.h * meta.height));
      if (width < 2 || height < 2) continue;
      overlays.push({
        input: await sharp(buf).extract({ left, top, width, height }).blur(20).toBuffer(),
        left,
        top,
      });
    }
    if (overlays.length) buf = await sharp(buf).composite(overlays).png().toBuffer();
  }
  for (const quality of [70, 55, 40, 25]) {
    const out = await sharp(buf).webp({ quality }).toBuffer();
    if (out.length <= MAX_BYTES) return out;
  }
  throw new Error('Screenshot too large even at low quality');
}

/** Facts sent at pairing. The machine id and hostname are hashed on the device; the raw values never leave it. @param {string} agentVersion */
export async function deviceFacts(agentVersion) {
  const machine =
    (await readFile('/etc/machine-id', 'utf8').catch(() => null)) ??
    `${os.hostname()}|${os.userInfo().username}|${os.arch()}`;
  const platform =
    process.platform === 'darwin' ? 'MACOS' : process.platform === 'win32' ? 'WINDOWS' : 'LINUX';
  return {
    os: platform,
    osVersion: os.release().slice(0, 40),
    agentVersion,
    fingerprintHash: createHash('sha256').update(`hrms-agent|${machine.trim()}`).digest('hex'),
    hostnameHash: createHash('sha256').update(`hrms-agent|${os.hostname()}`).digest('hex'),
  };
}

/**
 * Refresh token storage encrypted with the OS keychain (Electron safeStorage). If the OS offers no encryption,
 * the app refuses to remember the sign-in rather than store it in plain text.
 * @param {{ dir: string, safeStorage: { isEncryptionAvailable: () => boolean, encryptString: (s: string) => Buffer, decryptString: (b: Buffer) => string } }} o
 */
export function tokenStore({ dir, safeStorage }) {
  const file = path.join(dir, 'device.bin');
  /** @type {any} */
  let memory = null;
  return {
    async get() {
      if (memory) return memory;
      try {
        memory = JSON.parse(safeStorage.decryptString(await readFile(file)));
      } catch {
        memory = null;
      }
      return memory;
    },
    async save(/** @type {any} */ t) {
      memory = t;
      if (!safeStorage.isEncryptionAvailable()) return; // kept for this run only
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await writeFile(file, safeStorage.encryptString(JSON.stringify(t)), { mode: 0o600 });
    },
    async clear() {
      memory = null;
      await rm(file, { force: true });
    },
  };
}
