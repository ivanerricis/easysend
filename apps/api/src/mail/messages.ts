import type { Locale } from '@easysend/shared';

export interface MailContent {
  subject: string;
  text: string;
}

interface MessageInput {
  locale: Locale;
  link: string;
  instanceName: string;
}

/** Plain-text password reset email. Phase 4 replaces it with the branded templates. */
export function passwordResetMessage(input: MessageInput & { ttlMinutes: number }): MailContent {
  const { locale, link, instanceName, ttlMinutes } = input;
  if (locale === 'en') {
    return {
      subject: `${instanceName}: reset your password`,
      text: [
        'Hello,',
        '',
        `we received a request to reset your ${instanceName} password.`,
        'Open this link to choose a new one:',
        link,
        '',
        `The link is valid for ${ttlMinutes} minutes and can be used only once.`,
        'If you did not ask for it, you can ignore this email: your password stays the same.',
      ].join('\n'),
    };
  }
  return {
    subject: `${instanceName}: reimposta la password`,
    text: [
      'Ciao,',
      '',
      `abbiamo ricevuto una richiesta di reimpostazione della password di ${instanceName}.`,
      'Apri questo link per sceglierne una nuova:',
      link,
      '',
      `Il link vale ${ttlMinutes} minuti e si può usare una sola volta.`,
      'Se non l’hai chiesto tu, ignora questa email: la password non cambia.',
    ].join('\n'),
  };
}

/** Plain-text welcome email for a user created by an admin without a password. */
export function welcomeMessage(input: MessageInput & { ttlHours: number }): MailContent {
  const { locale, link, instanceName, ttlHours } = input;
  if (locale === 'en') {
    return {
      subject: `Welcome to ${instanceName}: set your password`,
      text: [
        'Hello,',
        '',
        `an account was created for you on ${instanceName}.`,
        'Open this link to set your password:',
        link,
        '',
        `The link is valid for ${ttlHours} hours and can be used only once.`,
      ].join('\n'),
    };
  }
  return {
    subject: `Benvenuto su ${instanceName}: imposta la password`,
    text: [
      'Ciao,',
      '',
      `è stato creato un account per te su ${instanceName}.`,
      'Apri questo link per impostare la password:',
      link,
      '',
      `Il link vale ${ttlHours} ore e si può usare una sola volta.`,
    ].join('\n'),
  };
}
