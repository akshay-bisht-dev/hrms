// @ts-check
import { v7 as uuidv7, validate, version } from 'uuid';

/**
 * New time-ordered identifier (UUIDv7) for primary keys.
 * @returns {string}
 */
export const newId = () => uuidv7();

/**
 * True when the value is a syntactically valid UUID of version 7.
 * @param {unknown} value
 * @returns {boolean}
 */
export const isId = (value) => typeof value === 'string' && validate(value) && version(value) === 7;
