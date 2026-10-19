import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/** React 19 hoists a `<link rel="preload">` for every `<img>`: useless (and odd) in an email. */
const PRELOAD_LINKS = /<link rel="preload"[^>]*>/g;

/** Renders a full email document. React escapes every interpolated string. */
export function renderEmail(element: ReactElement): string {
  return `<!DOCTYPE html>${renderToStaticMarkup(element).replace(PRELOAD_LINKS, '')}`;
}
