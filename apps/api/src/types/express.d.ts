import type { AuthContext } from '../auth/session.js';
import type { ValidatedInput } from '../http/validate.js';

declare global {
  namespace Express {
    interface Request {
      /** Set by `loadSession` when the request carries a valid session cookie. */
      auth?: AuthContext;
      /** Set by `validate(endpointId)`. */
      valid?: ValidatedInput;
    }
  }
}
