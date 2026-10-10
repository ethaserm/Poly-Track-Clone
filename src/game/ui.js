// Small DOM helpers for menus and overlays.

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/**
 * Modal panel. Clicking any element with data-action calls onAction(action, element, event).
 * Returns { el, close }.
 */
export function openPanel(root, html, { onAction, className = '', dismissible = false, onClose, focus = true } = {}) {
  const backdrop = h(`<div class="panel-backdrop"><div class="panel ${className}">${html}</div></div>`);
  const panel = backdrop.firstElementChild;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    onClose?.();
  };
  backdrop.addEventListener('click', (e) => {
    const a = e.target.closest('[data-action]');
    if (a && panel.contains(a)) {
      onAction?.(a.dataset.action, a, e);
      return;
    }
    if (dismissible && e.target === backdrop) close();
  });
  root.appendChild(backdrop);
  if (focus) {
    const focusable = panel.querySelector('[autofocus], button.primary, button');
    focusable?.focus({ preventScroll: true });
  }
  return { el: panel, close, get closed() { return closed; } };
}

let toastTimer = null;
export function toast(root, text, ms = 2200) {
  let el = root.querySelector('.toast');
  if (!el) {
    el = h('<div class="toast" role="status"></div>');
    root.appendChild(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
