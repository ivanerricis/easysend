import { defineConfig, type DefaultTheme } from 'vitepress';

const repo = 'https://github.com/ivanerricis/easysend';

function sidebar(prefix: string, t: Record<string, string>): DefaultTheme.Sidebar {
  return [
    {
      text: t.guide,
      items: [
        { text: t.introduction, link: `${prefix}/guide/introduction` },
        { text: t.requirements, link: `${prefix}/guide/requirements` },
        { text: t.lxc, link: `${prefix}/guide/lxc` },
        { text: t.install, link: `${prefix}/guide/install` },
        { text: t.firstSetup, link: `${prefix}/guide/first-setup` },
        { text: t.cloudflare, link: `${prefix}/guide/cloudflare` },
        { text: t.backup, link: `${prefix}/guide/backup` },
        { text: t.updates, link: `${prefix}/guide/updates` },
        { text: t.uninstall, link: `${prefix}/guide/uninstall` },
        { text: t.keyRotation, link: `${prefix}/guide/key-rotation` },
        { text: t.security, link: `${prefix}/guide/security` },
        { text: t.resources, link: `${prefix}/guide/resources` },
        { text: t.troubleshooting, link: `${prefix}/guide/troubleshooting` },
      ],
    },
    {
      text: t.development,
      items: [
        { text: t.local, link: `${prefix}/development/local` },
        { text: t.tests, link: `${prefix}/development/tests` },
        { text: t.contributing, link: `${prefix}/development/contributing` },
      ],
    },
  ];
}

const en = {
  guide: 'Guide',
  introduction: 'Introduction',
  requirements: 'Requirements',
  lxc: 'LXC preparation',
  install: 'Installation',
  firstSetup: 'First setup (wizard)',
  cloudflare: 'Cloudflare API token',
  backup: 'Backup and restore',
  updates: 'Updating, deploy and rollback',
  uninstall: 'Uninstall',
  keyRotation: 'Master key rotation',
  security: 'Security notes',
  resources: 'Image sizes and resources',
  troubleshooting: 'Troubleshooting',
  development: 'Development',
  local: 'Local development',
  tests: 'Tests',
  contributing: 'Contributing',
};

const it = {
  guide: 'Guida',
  introduction: 'Introduzione',
  requirements: 'Requisiti',
  lxc: 'Preparazione del container LXC',
  install: 'Installazione',
  firstSetup: 'Primo setup (wizard)',
  cloudflare: 'Token API di Cloudflare',
  backup: 'Backup e ripristino',
  updates: 'Aggiornamento, deploy e rollback',
  uninstall: 'Disinstallazione',
  keyRotation: 'Rotazione della chiave master',
  security: 'Note di sicurezza',
  resources: 'Dimensioni delle immagini e risorse',
  troubleshooting: 'Risoluzione dei problemi',
  development: 'Sviluppo',
  local: 'Sviluppo in locale',
  tests: 'Test',
  contributing: 'Contribuire',
};

export default defineConfig({
  title: 'EasySend',
  base: '/easysend/',
  cleanUrls: true,
  // Example local addresses in the text are auto-linked; they are not real links.
  ignoreDeadLinks: [/^https?:\/\/localhost(:\d+)?(\/|$)/],
  lastUpdated: true,
  srcExclude: ['SPEC.md', 'FASI.md', 'api.md', 'brand/**', 'README.md', '**/node_modules/**'],
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/easysend/favicon.svg' }]],
  themeConfig: {
    logo: '/favicon.svg',
    socialLinks: [{ icon: 'github', link: repo }],
    search: { provider: 'local' },
    footer: { message: 'MIT License', copyright: 'Copyright © EasySend contributors' },
  },
  locales: {
    root: {
      label: 'English',
      lang: 'en',
      description: 'Self-hosted large file transfer, behind a Cloudflare Tunnel.',
      themeConfig: {
        nav: [
          { text: en.guide, link: '/guide/introduction', activeMatch: '/guide/' },
          { text: en.development, link: '/development/local', activeMatch: '/development/' },
          { text: 'Releases', link: `${repo}/releases` },
        ],
        sidebar: sidebar('', en),
        editLink: { pattern: `${repo}/edit/main/docs/:path`, text: 'Edit this page on GitHub' },
      },
    },
    it: {
      label: 'Italiano',
      lang: 'it',
      link: '/it/',
      description: 'Trasferimento di file grandi self-hosted, dietro un Cloudflare Tunnel.',
      themeConfig: {
        nav: [
          { text: it.guide, link: '/it/guide/introduction', activeMatch: '/it/guide/' },
          { text: it.development, link: '/it/development/local', activeMatch: '/it/development/' },
          { text: 'Release', link: `${repo}/releases` },
        ],
        sidebar: sidebar('/it', it),
        editLink: {
          pattern: `${repo}/edit/main/docs/:path`,
          text: 'Modifica questa pagina su GitHub',
        },
        outline: { label: 'In questa pagina' },
        docFooter: { prev: 'Pagina precedente', next: 'Pagina successiva' },
        lastUpdated: { text: 'Ultimo aggiornamento' },
        darkModeSwitchLabel: 'Aspetto',
        lightModeSwitchTitle: 'Passa al tema chiaro',
        darkModeSwitchTitle: 'Passa al tema scuro',
        sidebarMenuLabel: 'Menu',
        returnToTopLabel: 'Torna in alto',
        langMenuLabel: 'Cambia lingua',
        skipToContentLabel: 'Vai al contenuto',
        notFound: {
          title: 'PAGINA NON TROVATA',
          quote: 'Questa pagina non esiste o è stata spostata.',
          linkLabel: 'vai alla home',
          linkText: 'Torna alla home',
        },
        search: {
          provider: 'local',
          options: {
            translations: {
              button: { buttonText: 'Cerca', buttonAriaLabel: 'Cerca' },
              modal: {
                displayDetails: 'Mostra i dettagli',
                resetButtonTitle: 'Cancella la ricerca',
                backButtonTitle: 'Chiudi la ricerca',
                noResultsText: 'Nessun risultato per',
                footer: {
                  selectText: 'seleziona',
                  selectKeyAriaLabel: 'invio',
                  navigateText: 'naviga',
                  navigateUpKeyAriaLabel: 'freccia su',
                  navigateDownKeyAriaLabel: 'freccia giù',
                  closeText: 'chiudi',
                  closeKeyAriaLabel: 'esc',
                },
              },
            },
          },
        },
      },
    },
  },
});
