/**
 * Size bounds shared by the AI DJ session and agent-config request bodies.
 * They sit well above what the app sends (a handful of chips, short labels)
 * and keep a single request from fanning out into unbounded catalog work.
 */
export const TERM_LIST_MAX_ITEMS = 32;
export const TERM_MAX_LENGTH = 64;
export const SHORT_TEXT_MAX_LENGTH = 100;
