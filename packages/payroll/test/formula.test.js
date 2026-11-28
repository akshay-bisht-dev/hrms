import { evaluate, references, FormulaError } from '../src/formula.js';
import { dec } from '../src/money.js';

const vars = { BASIC: dec('50000'), HRA: dec('25000'), CTC_MONTHLY: dec('100000'), PF_ER: dec('1800') };
const ev = (f) => evaluate(f, vars).toString();

test('arithmetic follows normal precedence and stays decimal', () => {
  expect(ev('CTC_MONTHLY - BASIC - HRA - PF_ER')).toBe('23200');
  expect(ev('BASIC * 0.4 + 100')).toBe('20100');
  expect(ev('(BASIC + HRA) / 3')).toBe('25000');
  expect(ev('-BASIC + 1')).toBe('-49999');
  expect(evaluate('0.1 + 0.2', {}).toString()).toBe('0.3');
});

test('functions', () => {
  expect(ev('MIN(BASIC, 15000) * 0.12')).toBe('1800');
  expect(ev('MAX(1, 2, 3)')).toBe('3');
  expect(ev('ROUND(BASIC / 7, 2)')).toBe('7142.86');
  expect(ev('FLOOR(10.9) + CEIL(0.1)')).toBe('11');
});

test('references are listed so structures can be checked before saving', () => {
  expect(references('CTC_MONTHLY - basic - MIN(HRA, 10)').sort()).toEqual(['BASIC', 'CTC_MONTHLY', 'HRA']);
});

test('anything unexpected is an error, never a silent zero, and nothing is executed', () => {
  for (const bad of [
    'BASIC +',
    'UNKNOWN * 2',
    'BASIC / 0',
    'process.exit()',
    'BASIC; 1',
    'SQRT(4)',
    '',
    'MIN()',
    'FLOOR(1, 2)',
    'a'.repeat(501),
  ])
    expect(() => evaluate(bad, vars)).toThrow(FormulaError);
});
