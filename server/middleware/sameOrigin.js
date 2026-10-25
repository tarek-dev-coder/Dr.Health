import { forbidden } from '../lib/errors.js';

/**
 * Defense in depth for cookie-authenticated mutations. SameSite=Lax already
 * blocks most cross-site POSTs, but also check Fetch Metadata.
 */
export function requireSameOrigin(req, res, next) {
  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return next(forbidden('Cross-site requests are not allowed.', 'CSRF_REJECTED'));
  }
  return next();
}
