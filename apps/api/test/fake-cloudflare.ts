/** In-memory fake of the Cloudflare v4 endpoints used by the tunnel configuration. */
export interface FakeDnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied?: boolean;
  comment?: string;
}

export interface FakeTunnel {
  id: string;
  name: string;
  config_src?: string;
  deleted_at: string | null;
  ingress?: unknown;
}

export interface RecordedRequest {
  method: string;
  path: string;
  authorization: string | null;
  body: unknown;
}

export const FAKE_TUNNEL_TOKEN = 'eyJhIjoiZmFrZS10dW5uZWwtdG9rZW4ifQ';

export class FakeCloudflare {
  readonly accountId = 'acc-1';
  readonly zones = new Map<string, { id: string }>([['example.com', { id: 'zone-1' }]]);
  readonly records: FakeDnsRecord[] = [];
  readonly tunnels = new Map<string, FakeTunnel>();
  readonly requests: RecordedRequest[] = [];

  /** 401 + code 1000 on every call. */
  invalidToken = false;
  /** 403 on the calls whose "METHOD /path-pattern" matches (e.g. `POST /dns_records`). */
  forbid: string[] = [];
  /** HTTP 500 on the calls whose "METHOD /path-pattern" matches. */
  fail: string[] = [];
  /** Cloudflare error code returned (HTTP 400) by the calls matching the pattern. */
  failWithCode: { match: string; code: number }[] = [];
  /** Throws a network error on every call. */
  networkError = false;

  private counter = 0;

  fetch: typeof fetch = (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const pathname = url.pathname.replace(/^\/client\/v4/, '');
    this.requests.push({
      method,
      path: pathname + url.search,
      authorization: headers.get('authorization'),
      body,
    });
    if (this.networkError) return Promise.reject(new TypeError('fetch failed'));
    const label = `${method} ${pathname}`;
    const matches = (pattern: string) => label.includes(pattern) || pattern === label;
    if (this.invalidToken) return Promise.resolve(this.error(401, 1000, 'Invalid API Token'));
    if (this.forbid.some(matches))
      return Promise.resolve(this.error(403, 10000, 'Authentication error'));
    if (this.fail.some(matches)) return Promise.resolve(this.error(500, 7003, 'Internal error'));
    const coded = this.failWithCode.find((f) => matches(f.match));
    if (coded) return Promise.resolve(this.error(400, coded.code, 'Request failed'));
    return Promise.resolve(this.route(method, pathname, url, body));
  };

  /** The tunnels that are not deleted. */
  get liveTunnels(): FakeTunnel[] {
    return [...this.tunnels.values()].filter((t) => !t.deleted_at);
  }

  private ok(result: unknown, status = 200): Response {
    return Response.json({ success: true, errors: [], messages: [], result }, { status });
  }

  private error(status: number, code: number, message: string): Response {
    return Response.json(
      { success: false, errors: [{ code, message }], messages: [], result: null },
      { status },
    );
  }

  private route(method: string, pathname: string, url: URL, body: unknown): Response {
    if (method === 'GET' && pathname === '/zones') {
      const name = url.searchParams.get('name') ?? '';
      const zone = this.zones.get(name);
      return this.ok(
        zone ? [{ id: zone.id, name, account: { id: this.accountId, name: 'Account' } }] : [],
      );
    }
    let m = /^\/zones\/([^/]+)\/dns_records$/.exec(pathname);
    if (m) {
      if (method === 'GET') {
        const name = url.searchParams.get('name');
        return this.ok(this.records.filter((r) => !name || r.name === name));
      }
      if (method === 'POST') {
        const b = body as Omit<FakeDnsRecord, 'id'>;
        if (this.records.some((r) => r.name === b.name)) {
          return this.error(400, 81058, 'An identical record already exists.');
        }
        const record = { id: `rec-${++this.counter}`, ...b };
        this.records.push(record);
        return this.ok(record);
      }
    }
    m = /^\/accounts\/([^/]+)\/cfd_tunnel$/.exec(pathname);
    if (m && method === 'POST') {
      const b = body as { name: string; config_src?: string };
      const tunnel: FakeTunnel = {
        id: `00000000-0000-4000-8000-${String(++this.counter).padStart(12, '0')}`,
        name: b.name,
        deleted_at: null,
        ...(b.config_src ? { config_src: b.config_src } : {}),
      };
      this.tunnels.set(tunnel.id, tunnel);
      return this.ok(tunnel);
    }
    m = /^\/accounts\/([^/]+)\/cfd_tunnel\/([^/]+)(\/configurations|\/token)?$/.exec(pathname);
    if (m) {
      const tunnel = this.tunnels.get(m[2]!);
      if (!tunnel) return this.error(404, 1003, 'Tunnel not found');
      if (!m[3] && method === 'GET') return this.ok(tunnel);
      if (m[3] === '/configurations' && method === 'PUT') {
        tunnel.ingress = (body as { config: { ingress: unknown } }).config.ingress;
        return this.ok({ tunnel_id: tunnel.id, version: 1 });
      }
      if (m[3] === '/token' && method === 'GET') return this.ok(FAKE_TUNNEL_TOKEN);
    }
    return this.error(404, 7000, 'No route for that URI');
  }
}
