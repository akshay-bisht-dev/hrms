// @ts-check
/**
 * A small, safe formula language for salary components. It never uses eval or Function.
 *
 *   expression := term (('+' | '-') term)*
 *   term       := factor (('*' | '/') factor)*
 *   factor     := NUMBER | NAME | NAME '(' args ')' | '(' expression ')' | '-' factor
 *
 * NAME is a component code or a built-in variable (e.g. CTC_MONTHLY). Functions: MIN, MAX, ROUND(x, places), FLOOR, CEIL.
 * All arithmetic is decimal. Unknown names, division by zero and malformed input are errors, never silent zeros.
 */
import { D, dec } from './money.js';

const MAX_LENGTH = 500;
const FUNCTIONS = /** @type {const} */ (['MIN', 'MAX', 'ROUND', 'FLOOR', 'CEIL']);

export class FormulaError extends Error {}

/** @param {string} src */
function tokenize(src) {
  if (typeof src !== 'string' || !src.trim()) throw new FormulaError('The formula is empty');
  if (src.length > MAX_LENGTH) throw new FormulaError(`Formulas can be at most ${MAX_LENGTH} characters`);
  /** @type {{ type: string, value: string }[]} */
  const tokens = [];
  const re = /\s*(?:(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|([-+*/(),]))/y;
  let i = 0;
  while (i < src.length) {
    if (/^\s+$/.test(src.slice(i))) break;
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) throw new FormulaError(`Unexpected character "${src.slice(i).trim()[0]}"`);
    if (m[1]) tokens.push({ type: 'num', value: m[1] });
    else if (m[2]) tokens.push({ type: 'name', value: m[2].toUpperCase() });
    else tokens.push({ type: 'op', value: m[3] });
    i = re.lastIndex;
  }
  return tokens;
}

/**
 * Parses into a small AST. Throws FormulaError on bad syntax.
 * @param {string} src
 */
export function parse(src) {
  const tokens = tokenize(src);
  let pos = 0;
  const peek = () => tokens[pos];
  const expect = (/** @type {string} */ value) => {
    if (peek()?.value !== value) throw new FormulaError(`Expected "${value}"`);
    pos++;
  };
  /** @returns {any} */
  function expression() {
    let node = term();
    while (peek()?.type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = tokens[pos++].value;
      node = { type: 'bin', op, left: node, right: term() };
    }
    return node;
  }
  /** @returns {any} */
  function term() {
    let node = factor();
    while (peek()?.type === 'op' && (peek().value === '*' || peek().value === '/')) {
      const op = tokens[pos++].value;
      node = { type: 'bin', op, left: node, right: factor() };
    }
    return node;
  }
  /** @returns {any} */
  function factor() {
    const t = peek();
    if (!t) throw new FormulaError('The formula ends too early');
    if (t.type === 'num') {
      pos++;
      return { type: 'num', value: t.value };
    }
    if (t.type === 'op' && t.value === '-') {
      pos++;
      return { type: 'neg', arg: factor() };
    }
    if (t.type === 'op' && t.value === '(') {
      pos++;
      const node = expression();
      expect(')');
      return node;
    }
    if (t.type === 'name') {
      pos++;
      if (peek()?.value === '(') {
        if (!FUNCTIONS.includes(/** @type {any} */ (t.value)))
          throw new FormulaError(`Unknown function ${t.value}`);
        pos++;
        const args = [expression()];
        while (peek()?.value === ',') {
          pos++;
          args.push(expression());
        }
        expect(')');
        return { type: 'call', name: t.value, args };
      }
      return { type: 'ref', name: t.value };
    }
    throw new FormulaError(`Unexpected "${t.value}"`);
  }
  const ast = expression();
  if (pos !== tokens.length) throw new FormulaError(`Unexpected "${tokens[pos].value}"`);
  return ast;
}

/** Every name a formula refers to. @param {string} src @returns {string[]} */
export function references(src) {
  const out = new Set();
  const walk = (/** @type {any} */ n) => {
    if (n.type === 'ref') out.add(n.name);
    if (n.type === 'bin') {
      walk(n.left);
      walk(n.right);
    }
    if (n.type === 'neg') walk(n.arg);
    if (n.type === 'call') n.args.forEach(walk);
  };
  walk(parse(src));
  return [...out];
}

/**
 * Evaluates a formula against named decimal values.
 * @param {string} src @param {Record<string, import('decimal.js').Decimal>} vars
 * @returns {import('decimal.js').Decimal}
 */
export function evaluate(src, vars) {
  const ev = (/** @type {any} */ n) => {
    switch (n.type) {
      case 'num':
        return dec(n.value);
      case 'ref':
        if (!(n.name in vars)) throw new FormulaError(`Unknown name ${n.name}`);
        return vars[n.name];
      case 'neg':
        return ev(n.arg).negated();
      case 'bin': {
        const a = ev(n.left);
        const b = ev(n.right);
        if (n.op === '+') return a.plus(b);
        if (n.op === '-') return a.minus(b);
        if (n.op === '*') return a.times(b);
        if (b.isZero()) throw new FormulaError('Division by zero');
        return a.dividedBy(b);
      }
      case 'call': {
        const args = n.args.map(ev);
        const need = (/** @type {number} */ k) => {
          if (args.length !== k) throw new FormulaError(`${n.name} takes ${k} value${k > 1 ? 's' : ''}`);
        };
        if (n.name === 'MIN') return D.min(...args);
        if (n.name === 'MAX') return D.max(...args);
        if (n.name === 'FLOOR') return (need(1), args[0].floor());
        if (n.name === 'CEIL') return (need(1), args[0].ceil());
        need(2);
        return args[0].toDecimalPlaces(args[1].toNumber(), D.ROUND_HALF_UP);
      }
      default:
        throw new FormulaError('Bad formula');
    }
  };
  return ev(parse(src));
}
