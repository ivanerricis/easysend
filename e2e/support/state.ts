// State shared between the spec files. They run one after the other in separate workers/processes,
// so it lives in a JSON file (e2e/.output/state.json) that scripts/e2e.mjs deletes at the start.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { stateFile } from './paths.ts';

export interface Account {
  email: string;
  displayName: string;
  password: string;
  /** Base32 TOTP secret, when the account has 2FA enabled. */
  totpSecret?: string;
  recoveryCodes?: string[];
}

export interface E2eState {
  /** The admin created by the setup wizard. */
  admin?: Account;
  /** Other accounts by short key (e.g. `member`). */
  accounts: Record<string, Account>;
  /** Last TOTP counter used per secret: the server rejects a code twice (anti-replay). */
  totpCounters: Record<string, number>;
  /** Free-form values one spec leaves for the next ones (share URLs, ids...). */
  values: Record<string, string>;
}

export function readState(): E2eState {
  try {
    const parsed = JSON.parse(readFileSync(stateFile, 'utf8')) as Partial<E2eState>;
    return {
      ...(parsed.admin ? { admin: parsed.admin } : {}),
      accounts: parsed.accounts ?? {},
      totpCounters: parsed.totpCounters ?? {},
      values: parsed.values ?? {},
    };
  } catch {
    return { accounts: {}, totpCounters: {}, values: {} };
  }
}

/** Reads, lets `mutate` change the state and writes it back atomically. */
export function updateState(mutate: (state: E2eState) => void): E2eState {
  const state = readState();
  mutate(state);
  mkdirSync(dirname(stateFile), { recursive: true });
  const temporary = `${stateFile}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(state, null, 2));
  renameSync(temporary, stateFile);
  return state;
}

export function requireAdmin(): Account & { totpSecret: string } {
  const admin = readState().admin;
  if (!admin?.totpSecret) throw new Error('The admin account is missing: did the setup spec run?');
  return { ...admin, totpSecret: admin.totpSecret };
}

export function requireAccount(key: string): Account {
  const account = readState().accounts[key];
  if (!account) throw new Error(`Account "${key}" is missing from the E2E state`);
  return account;
}

export function requireValue(key: string): string {
  const value = readState().values[key];
  if (value === undefined) throw new Error(`Value "${key}" is missing from the E2E state`);
  return value;
}
