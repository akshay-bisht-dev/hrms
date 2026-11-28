// @ts-check
import { inPack } from './in.js';

/** Country packs by the engine_module name stored on statutory_rule_packs. */
export const PACKS = Object.freeze({ in: inPack });

/** @param {string | null | undefined} engineModule */
export const packFor = (engineModule) =>
  engineModule ? (PACKS[/** @type {keyof typeof PACKS} */ (engineModule)] ?? null) : null;
