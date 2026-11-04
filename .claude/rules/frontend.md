---
paths:
  - 'apps/web/**'
---

# Frontend

- Librerie: react-router 8 (libreria), TanStack Query 5, react-hook-form con `@hookform/resolvers` (Zod 4), tus-js-client 4, input-otp, sonner, uqr (QR come `<svg>`). Il client API prende metodo, percorso e schema dal registro `endpoints` (`lib/api/endpoint.ts`); `contract.test.ts` impone la copertura di ogni endpoint JSON.
- Direzione visiva "Netto e tecnico": shadcn `radix-lyra`, base `zinc`, raggio 0, Plus Jakarta Sans e JetBrains Mono incluse (fontsource variable, niente Google Fonts; IBM Plex selezionabile in Aspetto), accento smeraldo AA (`#047857` chiaro, emerald-400 scuro).
- Responsive mobile-first: niente scroll orizzontale da 320px, controlli ≥ 44×44 px, zoom libero; verifica a 375, 768, 1024, 1440.
- Componenti shadcn al posto dei nativi dove esistono (il nativo solo se manca l'equivalente o è più accessibile); `cursor: pointer` globale nel livello `base` di `index.css`.
- Layout: area riservata con `Sidebar` shadcn (icone su desktop, `Sheet` su mobile); pagine pubbliche in una scheda centrata con logo, lingua, tema e footer. Impostazioni admin in pagine `/admin/settings/<sezione>` con sottomenu `Collapsible` (menu a tendina con sidebar a icone).
- Azioni per riga in un menu ⋯ (`RowActionsMenu`, 44 px), distruttive in fondo dopo un separatore; il focus torna al menu o al contenuto. Logica dei trasferimenti in `useTransferActions`, condivisa col dettaglio.
- Form condivisi wizard/pannello in `pages/settings-forms/` (schemi derivati da shared), `SelectField`, `LocaleSelectField`, `NewPasswordFields`; limiti dei campi da costanti shared.
- Toast (sonner, col nostro `ThemeProvider`, senza `next-themes`): solo feedback transitori (copiato, salvato, creato/revocato/eliminato, email di prova, upload completato, errori di azioni non legate a un campo); mai validazione dei form, errori bloccanti o informazioni da conservare. `aria-live` polite/assertive, ≥ 5 s, pausa su hover/focus, chiudibili da tastiera, in basso al centro su schermi stretti.
- i18n per area in `i18n/locales/{it,en}/<namespace>.json`, annidate sotto il nome dell'area; un test impone stesse chiavi e traduzione di ogni codice d'errore. Tema: utente → scelta locale → `defaultTheme` (anche in localStorage `easysend-theme-default` per `theme-init.js`). Lingua: utente → scelta salvata → browser → default dell'istanza.
- Aspetto via CSSOM (`lib/appearance.ts`): il predefinito non sovrascrive nulla; nello scuro un colore personalizzato vale solo con contrasto ≥ 3:1 su `#18181b`. Nessuna anteprima dal vivo né verifica del contrasto; il raggio conta poco (componenti squadrati, lo usano le email).
- Mittente sulla pagina di download: `display_name` (max 80) o il nome dell'istanza; mai l'email.
- CSP senza `unsafe-inline` per gli stili: `<style>` di sonner e react-remove-scroll disattivati da un plugin Vite (la build fallisce se il codice non si trova) e CSS nel bundle; `style-src` ammette solo l'hash della stringa vuota (input-otp); Zod `jitless` (`lib/zod-jitless.ts`, primo import).
- Test: `asyncUtilTimeout` di Testing Library a 5 s (rotte lazy sotto carico).
