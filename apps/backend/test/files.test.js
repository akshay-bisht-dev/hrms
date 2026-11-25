import { safeCsvCell } from '../src/modules/employees/employees.service.js';
import { attachmentDisposition, keys } from '../src/lib/storage.js';

describe('CSV formula injection guard (APP-06)', () => {
  test.each([
    ['=1+1', "'=1+1"],
    ['+cmd', "'+cmd"],
    ['-2', "'-2"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\tx', "'\tx"],
    ['Priya', 'Priya'],
    [null, ''],
    [42, '42'],
  ])('%p → %p', (input, out) => {
    expect(safeCsvCell(input)).toBe(out);
  });
});

describe('download headers and object keys', () => {
  test('attachment disposition escapes quotes and keeps a UTF-8 name', () => {
    const h = attachmentDisposition('Résumé "final".pdf');
    expect(h.startsWith('attachment; filename="R_sum_ _final_.pdf"')).toBe(true);
    expect(h).toContain("filename*=UTF-8''R%C3%A9sum%C3%A9%20%22final%22.pdf");
  });
  test('object keys are tenant-prefixed and never include the user file name', () => {
    expect(keys.employeeDocument('t1', 'e1', 'd1', 'pdf')).toBe('tenant/t1/employees/e1/documents/d1.pdf');
    expect(keys.importFile('t1', 'j1')).toBe('tenant/t1/imports/j1/source.csv');
  });
});
