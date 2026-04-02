const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export class FocusManager {
  private root: ShadowRoot;
  private trapped: HTMLElement | null = null;
  private handleKeydown: ((e: KeyboardEvent) => void) | null = null;
  private previouslyFocused: HTMLElement | null = null;
  private destroyed = false;
  private restoreRaf: number | null = null;

  constructor(root: ShadowRoot) {
    this.root = root;
  }

  trapFocus(container: HTMLElement): void {
    // Cancel any pending restore-focus RAF from a previous releaseFocus (prevents flicker
    // when transitioning directly from banner → preferences)
    if (this.restoreRaf !== null) { cancelAnimationFrame(this.restoreRaf); this.restoreRaf = null; }
    this.releaseFocus();

    // Store the element that had focus before trapping
    this.previouslyFocused = (document.activeElement instanceof HTMLElement)
      ? document.activeElement
      : null;

    this.trapped = container;

    this.handleKeydown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !this.trapped) return;

      // If the shadow root's host has been disconnected, clean up
      if (!this.root.host?.isConnected) {
        this.releaseFocus();
        return;
      }

      const focusable = this.getFocusableElements(this.trapped);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = this.root.activeElement;

      // If focus escaped the container (e.g. via click outside), pull it back in
      if (!active || !this.trapped.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }

      if (e.shiftKey) {
        if (active === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    this.root.addEventListener('keydown', this.handleKeydown as EventListener);

    // Focus first focusable element
    const focusable = this.getFocusableElements(container);
    if (focusable.length > 0) {
      requestAnimationFrame(() => { if (!this.destroyed) focusable[0].focus(); });
    }
  }

  releaseFocus(): void {
    if (this.handleKeydown) {
      this.root.removeEventListener('keydown', this.handleKeydown as EventListener);
      this.handleKeydown = null;
    }
    this.trapped = null;

    // Restore previous focus if element is still in DOM and focusable
    if (this.previouslyFocused) {
      const el = this.previouslyFocused;
      this.previouslyFocused = null;
      this.restoreRaf = requestAnimationFrame(() => {
        this.restoreRaf = null;
        if (!this.destroyed && el.isConnected) el.focus();
      });
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.restoreRaf !== null) { cancelAnimationFrame(this.restoreRaf); this.restoreRaf = null; }
    this.releaseFocus();
  }

  private getFocusableElements(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter((el) => {
        if (el.hasAttribute('disabled')) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (el.offsetParent === null && style.position !== 'fixed') return false;
        return true;
      });
  }
}
