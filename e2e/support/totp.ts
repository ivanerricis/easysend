import * as OTPAuth from 'otpauth';
import { sleep } from './paths.ts';
import { readState, updateState } from './state.ts';

const PERIOD = 30;

/**
 * A TOTP code for `secret` that was never handed out before in this run. The server accepts every
 * 30 s counter only once per user (anti-replay), so when the current window was already used we
 * wait for the next one. The last counter per secret is persisted: specs run in separate
 * processes.
 */
export async function nextTotp(secret: string): Promise<string> {
  const totp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secret),
    algorithm: 'SHA1',
    digits: 6,
    period: PERIOD,
  });
  for (;;) {
    const counter = Math.floor(Date.now() / 1000 / PERIOD);
    const last = readState().totpCounters[secret] ?? -1;
    if (counter > last) {
      updateState((state) => {
        state.totpCounters[secret] = counter;
      });
      return totp.generate({ timestamp: counter * PERIOD * 1000 });
    }
    await sleep(1000);
  }
}
