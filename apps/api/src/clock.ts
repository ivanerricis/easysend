/** Source of the current time in milliseconds since the epoch. Inject it; never call `Date.now()` in business code. */
export type Clock = () => number;

export const systemClock: Clock = () => Date.now();

/** Unix seconds, the unit used by the database. */
export const nowSeconds = (clock: Clock): number => Math.floor(clock() / 1000);
