/** Escape HTML text content (XSS-safe) */
export function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Escape HTML attribute value */
export function escAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Sanitize a string for use as an HTML id attribute (alphanumeric, hyphens, underscores only) */
export function safeId(str: string): string {
  return str.replace(/[^a-zA-Z0-9_-]/g, '_');
}
