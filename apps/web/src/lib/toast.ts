import { createElement } from 'react';
import { toast } from 'sonner';

/**
 * Transient feedback only (link copied, settings saved, action failed). Do not use toasts for
 * field validation errors, blocking page errors or information the user must keep (recovery
 * codes, a freshly created link): render those inline.
 *
 * Accessibility: sonner's container is a single `aria-live="polite"` region, which is right for
 * successes. Errors must be assertive, so `notifyError` announces the message through its own
 * `role="alert"` region and hides the visible copy from assistive technology (it would be read
 * twice otherwise). Toasts last at least 5 s (8 s for errors), pause on hover and focus, and have
 * a close button reachable by keyboard.
 */
export const SUCCESS_DURATION_MS = 6000;
export const ERROR_DURATION_MS = 8000;

let alertRegion: HTMLElement | null = null;

function announceAssertively(message: string): void {
  if (typeof document === 'undefined') return;
  if (!alertRegion?.isConnected) {
    alertRegion = document.createElement('div');
    alertRegion.setAttribute('role', 'alert');
    alertRegion.setAttribute('aria-live', 'assertive');
    alertRegion.setAttribute('aria-atomic', 'true');
    // Visually hidden through CSSOM (allowed by the CSP, unlike an inline <style>).
    const hidden: Record<string, string> = {
      position: 'absolute',
      width: '1px',
      height: '1px',
      margin: '-1px',
      padding: '0',
      overflow: 'hidden',
      clip: 'rect(0 0 0 0)',
      'white-space': 'nowrap',
      border: '0',
    };
    for (const [key, value] of Object.entries(hidden)) alertRegion.style.setProperty(key, value);
    document.body.appendChild(alertRegion);
  }
  const region = alertRegion;
  region.textContent = '';
  // Changing the text after a tick makes screen readers announce repeated messages too.
  window.setTimeout(() => {
    region.textContent = message;
  }, 50);
}

export function notifySuccess(message: string): void {
  toast.success(message, { duration: SUCCESS_DURATION_MS });
}

export function notifyError(message: string): void {
  announceAssertively(message);
  toast.error(createElement('span', { 'aria-hidden': true }, message), {
    duration: ERROR_DURATION_MS,
  });
}
