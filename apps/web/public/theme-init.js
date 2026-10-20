/* global window, document */
// Anti-flash theme bootstrap. Kept as an external file because the CSP forbids inline scripts.
// Must stay in sync with src/theme/theme-context.ts (storage keys) and ThemeProvider.tsx (class).
// Order: the visitor's choice ('easysend-theme'), the cached instance default
// ('easysend-theme-default'), then the system preference.
(function () {
  function read(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  var dark = false;
  try {
    var choice = read('easysend-theme');
    if (choice !== 'light' && choice !== 'dark' && choice !== 'system') {
      choice = read('easysend-theme-default');
    }
    if (choice === 'dark') {
      dark = true;
    } else if (choice !== 'light') {
      dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
  } catch {
    dark = false;
  }
  if (dark) document.documentElement.classList.add('dark');
})();
