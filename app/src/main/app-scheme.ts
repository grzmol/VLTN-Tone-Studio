/**
 * Privileges for the `app` scheme. The renderer fetches `app://library` cross-origin (from `http://localhost` in dev and from
 * `app://bundle` when packaged), which Chromium allows only for a CORS-enabled scheme.
 */
export const APP_SCHEME_PRIVILEGES = {
  standard: true,
  secure: true,
  supportFetchAPI: true,
  corsEnabled: true,
  codeCache: true,
};
