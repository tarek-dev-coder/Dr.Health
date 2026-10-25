import { forbidden } from '../lib/errors.js';

/**
 * Defense in depth for state-changing requests. Same-origin fetch is expected;
 * cross-site browser requests are rejected before they reach a route.
 */
export function requireSameOrigin(req, res, next) {
  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return next(forbidden('Cross-site requests are not allowed.', 'CSRF_REJECTED'));
  }
  return next();
}
