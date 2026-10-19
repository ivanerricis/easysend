/* global window, document */
// Anti-flash theme bootstrap. Kept as an external file because the CSP forbids inline scripts.
// Must stay in sync with src/theme/theme-context.ts (storage key) and ThemeProvider.tsx (class).
(function () {
  var dark = false;
  try {
    var stored = null;
    try {
      stored = window.localStorage.getItem('easysend-theme');
    } catch {
      stored = null;
    }
    if (stored === 'dark') {
      dark = true;
    } else if (stored !== 'light') {
      dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
  } catch {
    dark = false;
  }
  if (dark) document.documentElement.classList.add('dark');
})();
