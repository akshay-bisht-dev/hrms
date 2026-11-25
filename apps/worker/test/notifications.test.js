import { createNotificationsProcessor } from '../src/processors/notifications.js';
import { renderEmail, TEMPLATES } from '../src/processors/email-templates.js';

const logger = { info() {} };

test('every template renders subject, text and html', () => {
  for (const name of Object.keys(TEMPLATES)) {
    const out = renderEmail(name, {
      name: 'Priya',
      url: 'https://app.example/x?token=abc',
      resetUrl: 'https://app.example/r',
      loginUrl: 'https://app.example/l',
      minutes: '30',
    });
    expect(out.subject.length).toBeGreaterThan(5);
    expect(out.text).toContain('Workforce HRMS');
    expect(out.html).toMatch(/^<!doctype html>/);
  }
});

test('values are HTML-escaped', () => {
  const out = renderEmail('verify-email', {
    name: '<img src=x onerror=alert(1)>',
    url: 'https://app.example/v?token=a&b=c',
  });
  expect(out.html).not.toContain('<img src=x');
  expect(out.html).toContain('&lt;img');
  expect(out.html).toContain('token=a&amp;b=c');
});

test('processor sends a validated email', async () => {
  const sent = [];
  const run = createNotificationsProcessor({
    transport: { sendMail: async (m) => sent.push(m) },
    from: 'HRMS <no-reply@x.test>',
    logger,
  });
  await run({
    id: '1',
    name: 'email',
    data: { template: 'mfa-enabled', to: 'p@example.com', data: { name: 'Priya' } },
  });
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({
    to: 'p@example.com',
    subject: 'Two-step verification is on',
    from: 'HRMS <no-reply@x.test>',
  });
});

test('processor rejects unknown templates and bad recipients', async () => {
  const run = createNotificationsProcessor({
    transport: { sendMail: async () => {} },
    from: 'x@y.z',
    logger,
  });
  await expect(
    run({ id: '2', name: 'email', data: { template: 'nope', to: 'p@example.com', data: {} } }),
  ).rejects.toThrow();
  await expect(
    run({ id: '3', name: 'email', data: { template: 'mfa-enabled', to: 'not-an-email', data: {} } }),
  ).rejects.toThrow();
});
