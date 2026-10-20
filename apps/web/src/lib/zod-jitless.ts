import { config } from 'zod';

// Zod probes `new Function('')` to enable its JIT fast path. The CSP forbids eval, so the probe
// is reported as a violation even though the error is swallowed. This module must be the first
// import of the entry point: schemas read the setting when they are created.
config({ jitless: true });
