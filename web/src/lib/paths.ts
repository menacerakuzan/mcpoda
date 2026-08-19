/**
 * Vite rewrites BASE_URL at build time. Using it instead of a hard "/" keeps the
 * links correct when the site is served from a sub-path (a GitHub project page)
 * as well as from a domain root.
 */
const base = import.meta.env.BASE_URL;

export const HOME = base;
export const DOCS = `${base}docs/`;
