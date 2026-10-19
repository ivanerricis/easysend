import { Writable } from 'node:stream';
import { pino } from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp, isLoopbackHost } from '../src/app.js';
import { migratedMemoryDb, testConfig } from './helpers.js';

async function makeApp() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  const logger = pino({ level: 'warn' }, stream);
  const config = testConfig({ PUBLIC_URL: 'http://localhost:8080' });
  const app = createApp({ config, db: await migratedMemoryDb(), logger });
  return { app, lines };
}

describe('isLoopbackHost', () => {
  it.each(['localhost', 'localhost:3000', '127.0.0.1', '127.0.0.1:8080', '[::1]', '[::1]:3000'])(
    'accepts %s',
    (host) => expect(isLoopbackHost(host)).toBe(true),
  );
  it.each(['192.168.1.5:8080', 'example.com', 'localhost.evil.com'])('rejects %s', (host) =>
    expect(isLoopbackHost(host)).toBe(false),
  );
});

describe('host mismatch warning', () => {
  it('warns once for a foreign host', async () => {
    const { app, lines } = await makeApp();
    await request(app).get('/api/nope').set('Host', '192.168.1.5:8080');
    await request(app).get('/api/nope').set('Host', '192.168.1.5:8080');
    expect(lines.filter((l) => l.includes('differs from PUBLIC_URL'))).toHaveLength(1);
  });

  it('stays quiet for health checks and loopback hosts', async () => {
    const { app, lines } = await makeApp();
    await request(app).get('/api/health').set('Host', '192.168.1.5:8080');
    await request(app).get('/api/nope').set('Host', '127.0.0.1:3000');
    await request(app).get('/api/nope').set('Host', 'localhost:5173');
    expect(lines.filter((l) => l.includes('differs from PUBLIC_URL'))).toHaveLength(0);
  });
});
