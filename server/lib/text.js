/**
 * Remove control characters that are never useful in chat messages while
 * preserving tabs and line breaks. Also strips bidirectional override
 * characters that can be used to disguise text.
 */
export function sanitizeText(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\u0000/g, '')
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, '')
    .trim();
}

export function truncate(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}
