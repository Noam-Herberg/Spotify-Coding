export async function api(action, options = {}) {
  const method = options.method || 'GET';
  const params = new URLSearchParams({ action, ...(options.params || {}) });
  const response = await fetch(`/api/game?${params}`, { method, headers: options.body ? { 'Content-Type': 'application/json' } : {}, body: options.body ? JSON.stringify(options.body) : undefined });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || 'Request failed.');
  return payload;
}
export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export function show(selector, visible) { $(selector).hidden = !visible; }
export function text(selector, value) { $(selector).textContent = value ?? ''; }
export function escapeHtml(value) { const node = document.createElement('span'); node.textContent = value ?? ''; return node.innerHTML; }
export function formatTime(ms) { const seconds = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
