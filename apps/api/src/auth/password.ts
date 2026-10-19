import { hash, verify } from '@node-rs/argon2';
import { AUTH_POLICY, type Argon2Params } from './policy.js';

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  /** False for a wrong password and for a malformed hash; never throws. */
  verify(passwordHash: string, password: string): Promise<boolean>;
  /**
   * Burns the same time as a real verification. Call it when the account does not exist (or has
   * no usable hash) so response timing does not reveal which emails are registered.
   */
  verifyDummy(password: string): Promise<void>;
}

/**
 * Argon2id hasher. Production uses the policy parameters; tests pass cheap ones. Each hasher owns
 * its dummy hash, computed lazily with the same parameters as the real ones.
 */
export function createPasswordHasher(params: Argon2Params = AUTH_POLICY.argon2): PasswordHasher {
  // algorithm defaults to Argon2id in @node-rs/argon2.
  const options = { ...params };
  let dummy: Promise<string> | undefined;

  return {
    hash: (password) => hash(password, options),
    async verify(passwordHash, password) {
      try {
        return await verify(passwordHash, password);
      } catch {
        return false;
      }
    },
    async verifyDummy(password) {
      dummy ??= hash('easysend-dummy-password-for-timing', options);
      try {
        await verify(await dummy, password);
      } catch {
        // Nothing to report: the only goal is to spend the time.
      }
    },
  };
}
