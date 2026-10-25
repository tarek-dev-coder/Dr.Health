import helmet from 'helmet';
import { config } from '../config.js';
import { AppError, badRequest } from '../lib/errors.js';

const cspDirectives = {
  defaultSrc: ["'self'"],
  baseUri: ["'none'"],
  fontSrc: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
  frameSrc: ["'none'"],
  imgSrc: ["'self'", 'data:'],
  mediaSrc: ["'none'"],
  objectSrc: ["'none'"],
  scriptSrc: ["'self'"],
  scriptSrcAttr: ["'none'"],
  styleSrc: ["'self'"],
  connectSrc: ["'self'"],
  manifestSrc: ["'self'"],
  workerSrc: ["'none'"],
  // Defense in depth against DOM XSS sinks (supported by Chromium-based browsers).
  requireTrustedTypesFor: ["'script'"],
  trustedTypes: ["'none'"],
  // Only force HTTPS upgrades in production; development runs on plain HTTP.
  upgradeInsecureRequests: config.isProduction ? [] : null,
};

export const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: cspDirectives,
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  referrerPolicy: { policy: 'no-referrer' },
  hsts: config.isProduction
    ? { maxAge: 15552000, includeSubDomains: true, preload: false }
    : false,
  xFrameOptions: { action: 'deny' },
  xPoweredBy: true,
  xPermittedCrossDomainPolicies: { permittedPolicies: 'none' },
});

export function permissionsPolicy(req, res, next) {
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()',
  );
  next();
}

export function httpsRedirect(req, res, next) {
  if (!config.enforceHttps || req.secure) return next();

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return next(new AppError(403, 'HTTPS_REQUIRED', 'HTTPS is required for this request.'));
  }

  const host = req.get('host');
  if (!host || !/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) {
    return next(badRequest('Invalid Host header.', 'INVALID_HOST'));
  }

  return res.redirect(308, `https://${host}${req.originalUrl}`);
}

export function hostCheck(req, res, next) {
  if (config.allowedHosts.length === 0) return next();

  const rawHost = req.get('host');
  if (!rawHost) return next(badRequest('Missing Host header.', 'INVALID_HOST'));

  const hostname = rawHost.replace(/:\d+$/, '').toLowerCase();
  if (!config.allowedHosts.includes(hostname)) {
    return next(badRequest('Invalid Host header.', 'INVALID_HOST'));
  }
  return next();
}
