// Shield icon SVG (privacy-themed, minimal)
const SHIELD_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3zm-1 14h2v2h-2v-2zm0-8h2v6h-2V8z"/></svg>`;

export function createFloatingTrigger(
  position: 'left' | 'right',
  ariaLabel: string,
  onClick: () => void
): HTMLElement {
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'cc-trigger';
  trigger.setAttribute('part', 'trigger');
  trigger.setAttribute('aria-label', ariaLabel);
  trigger.setAttribute('data-position', position);
  trigger.setAttribute('aria-hidden', 'true');
  trigger.setAttribute('tabindex', '-1');
  trigger.innerHTML = SHIELD_ICON;

  trigger.addEventListener('click', onClick);

  return trigger;
}
