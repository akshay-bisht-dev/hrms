// @ts-check
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/** Standard PDF fonts cover Latin-1 only; anything else is replaced so a payslip always renders. @param {unknown} s */
const latin1 = (s) =>
  String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');

/** '98200.0000' → '98,200.00' (grouping by thousands; the currency code is printed separately). */
export function formatAmount(/** @type {string} */ value, minorUnits = 2) {
  const neg = value.startsWith('-');
  const [whole, frac = ''] = (neg ? value.slice(1) : value).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const cents = minorUnits ? `.${frac.padEnd(minorUnits, '0').slice(0, minorUnits)}` : '';
  return `${neg ? '-' : ''}${grouped}${cents}`;
}

/**
 * Builds a one-page payslip. Pure: takes plain data, returns PDF bytes.
 * @param {{ company: string, legalEntity: string, periodLabel: string, payDate: string, currency: string, minorUnits: number,
 *           employee: { name: string, code: string, department?: string | null, designation?: string | null },
 *           paidDays: string, lopDays: string, lines: { label: string, kind: string, amount: string }[],
 *           totals: { gross: string, deductions: string, net: string }, reference: string }} p
 * @returns {Promise<Uint8Array>}
 */
export async function buildPayslipPdf(p) {
  const doc = await PDFDocument.create();
  doc.setTitle(latin1(`Payslip ${p.periodLabel} - ${p.employee.name}`));
  doc.setProducer('Workforce HRMS');
  doc.setCreationDate(new Date(`${p.payDate}T00:00:00Z`));
  doc.setModificationDate(new Date(`${p.payDate}T00:00:00Z`));
  const page = doc.addPage([595.28, 841.89]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const muted = rgb(0.4, 0.45, 0.5);
  let y = 790;
  const text = (
    /** @type {unknown} */ s,
    /** @type {number} */ x,
    size = 10,
    f = font,
    color = rgb(0.1, 0.12, 0.15),
  ) => page.drawText(latin1(s), { x, y, size, font: f, color });
  const right = (/** @type {string} */ s, /** @type {number} */ xRight, size = 10, f = font) =>
    page.drawText(latin1(s), { x: xRight - f.widthOfTextAtSize(latin1(s), size), y, size, font: f });

  text(p.company, 50, 16, bold);
  y -= 18;
  text(p.legalEntity, 50, 10, font, muted);
  y -= 30;
  text(`Payslip for ${p.periodLabel}`, 50, 13, bold);
  right(`Pay date ${p.payDate}`, 545);
  y -= 26;
  for (const [label, value] of [
    ['Employee', `${p.employee.name} (${p.employee.code})`],
    ['Department', p.employee.department ?? '-'],
    ['Designation', p.employee.designation ?? '-'],
    ['Paid days', `${p.paidDays}   Loss of pay days: ${p.lopDays}`],
  ]) {
    text(label, 50, 10, font, muted);
    text(value, 150);
    y -= 16;
  }
  y -= 14;
  const earnings = p.lines.filter((l) => l.kind === 'EARNING' || l.kind === 'REIMBURSEMENT');
  const deductions = p.lines.filter((l) => l.kind === 'DEDUCTION');
  const employer = p.lines.filter((l) => l.kind === 'EMPLOYER_CONTRIBUTION');
  page.drawRectangle({ x: 45, y: y - 6, width: 505, height: 20, color: rgb(0.95, 0.96, 0.97) });
  text('Earnings', 50, 10, bold);
  right(p.currency, 290, 10, bold);
  text('Deductions', 310, 10, bold);
  right(p.currency, 545, 10, bold);
  y -= 22;
  const rows = Math.max(earnings.length, deductions.length);
  for (let i = 0; i < rows; i++) {
    const e = earnings[i];
    const d = deductions[i];
    if (e) {
      text(e.label, 50);
      right(formatAmount(e.amount, p.minorUnits), 290);
    }
    if (d) {
      text(d.label, 310);
      right(formatAmount(d.amount, p.minorUnits), 545);
    }
    y -= 16;
  }
  y -= 4;
  page.drawLine({ start: { x: 45, y: y + 10 }, end: { x: 550, y: y + 10 }, thickness: 0.5, color: muted });
  text('Gross earnings', 50, 10, bold);
  right(formatAmount(p.totals.gross, p.minorUnits), 290, 10, bold);
  text('Total deductions', 310, 10, bold);
  right(formatAmount(p.totals.deductions, p.minorUnits), 545, 10, bold);
  y -= 34;
  page.drawRectangle({ x: 45, y: y - 8, width: 505, height: 26, color: rgb(0.93, 0.96, 1) });
  text('Net pay', 50, 13, bold);
  right(`${p.currency} ${formatAmount(p.totals.net, p.minorUnits)}`, 545, 13, bold);
  y -= 40;
  if (employer.length) {
    text('Paid by the employer in addition (not deducted from you)', 50, 9, font, muted);
    y -= 14;
    for (const l of employer) {
      text(l.label, 50, 9, font, muted);
      right(formatAmount(l.amount, p.minorUnits), 290, 9);
      y -= 13;
    }
  }
  y = 60;
  text(`Computer-generated payslip. Reference ${p.reference}.`, 50, 8, font, muted);
  return doc.save({ useObjectStreams: false });
}
