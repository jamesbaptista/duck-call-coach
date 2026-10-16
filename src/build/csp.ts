/**
 * The Content Security Policy the production build puts in every page: only this site, plus blob: so recordings
 * and references can play from object URLs. Nothing is inline, so scripts and styles need no exceptions.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "media-src 'self' blob:",
  "worker-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");
