// @ts-check
/**
 * Transactional email templates (English; localized templates move to message_templates in Sprint 15).
 * Every value is HTML-escaped. Links are only ever built by the API from APP_URL, never from user input.
 */

/** @param {string} s */
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

/** @param {string} title @param {string[]} paragraphs @param {{ label: string, url: string }} [button] */
function layout(title, paragraphs, button) {
  const text = [
    ...paragraphs,
    ...(button ? [`${button.label}: ${button.url}`] : []),
    '',
    '— Workforce HRMS',
  ].join('\n\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Inter,Arial,sans-serif;color:#0f172a">
<div style="max-width:520px;margin:0 auto;padding:32px 24px">
<h1 style="font-size:20px;margin:0 0 16px">${esc(title)}</h1>
${paragraphs.map((p) => `<p style="font-size:15px;line-height:1.5;margin:0 0 14px">${esc(p)}</p>`).join('\n')}
${
  button
    ? `<p style="margin:24px 0"><a href="${esc(button.url)}" style="background:#2563eb;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:600;display:inline-block">${esc(button.label)}</a></p>
<p style="font-size:13px;color:#475569;word-break:break-all">Or paste this link into your browser: ${esc(button.url)}</p>`
    : ''
}
<p style="font-size:13px;color:#475569;margin-top:32px">— Workforce HRMS</p>
</div></body></html>`;
  return { subject: title, text, html };
}

/** @type {Record<string, (d: Record<string, string>) => { subject: string, text: string, html: string }>} */
export const TEMPLATES = {
  'verify-email': (d) =>
    layout(
      'Confirm your email address',
      [
        `Hi ${d.name},`,
        'Confirm your email address to finish setting up your company account. The link works for 24 hours.',
      ],
      { label: 'Confirm email', url: d.url },
    ),
  'reset-password': (d) =>
    layout(
      'Reset your password',
      [
        `Hi ${d.name},`,
        `Someone asked to reset the password for this account. The link works for ${d.minutes} minutes and can be used once.`,
        "If it wasn't you, you can ignore this email — your password stays the same.",
      ],
      { label: 'Choose a new password', url: d.url },
    ),
  'password-changed': (d) =>
    layout(
      'Your password was changed',
      [
        `Hi ${d.name},`,
        'The password for your account was just changed, and other signed-in sessions were signed out.',
        "If you didn't do this, reset your password now and contact your administrator.",
      ],
      { label: 'Reset password', url: d.resetUrl },
    ),
  'account-exists': (d) =>
    layout(
      'You already have an account',
      [
        'Someone tried to create a new account with this email address, but one already exists.',
        "If it was you, sign in instead. If you've forgotten your password, you can reset it.",
      ],
      { label: 'Sign in', url: d.loginUrl },
    ),
  'account-locked': (d) =>
    layout(
      'Sign-in paused after failed attempts',
      [
        `Hi ${d.name},`,
        `We paused sign-in to your account for ${d.minutes} minutes after several incorrect passwords.`,
        "If that wasn't you, reset your password.",
      ],
      { label: 'Reset password', url: d.resetUrl },
    ),
  invitation: (d) =>
    layout(
      `You're invited to ${d.company}`,
      [
        `${d.inviter} invited you to join ${d.company} on Workforce HRMS.`,
        'The invitation works for 7 days.',
      ],
      { label: 'Accept invitation', url: d.url },
    ),
  'sensitive-access-granted': (d) =>
    layout('Sensitive access was granted', [
      `Hi ${d.name},`,
      `${d.by} gave ${d.person} the role(s) ${d.roles} in ${d.company}. These roles include sensitive access such as payroll or screenshots.`,
      "You're receiving this because you are a Company Admin. If this wasn't expected, review the member's roles.",
    ]),
  'mfa-enabled': (d) =>
    layout('Two-step verification is on', [
      `Hi ${d.name},`,
      'Two-step verification was turned on for your account. Other sessions were signed out. Keep your recovery codes somewhere safe.',
    ]),
  'mfa-disabled': (d) =>
    layout('Two-step verification was turned off', [
      `Hi ${d.name},`,
      "Two-step verification was turned off for your account. If you didn't do this, reset your password now.",
    ]),
};

/** @param {string} template @param {Record<string, string>} data */
export function renderEmail(template, data) {
  const fn = TEMPLATES[template];
  if (!fn) throw new Error(`Unknown email template: ${template}`);
  return fn(data);
}
