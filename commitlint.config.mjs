// @ts-check
/**
 * Conventional Commits config. Accepts the standard types and lets
 * scopes be anything (area:recorder, area:tracker, etc.). Subject is
 * max 100 chars, body wraps at ~100.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [1, 'always', 100],
    // Allow common project scopes plus free-form
    'scope-enum': [0],
  },
};
