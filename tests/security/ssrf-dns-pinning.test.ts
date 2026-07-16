const mocks = vi.hoisted(() => ({
  dnsLookup: vi.fn(),
  agentClose: vi.fn(() => Promise.resolve()),
  agentConstructionError: undefined as Error | undefined,
}));

vi.mock('dns/promises', () => ({
  lookup: mocks.dnsLookup,
}));

vi.mock('undici', () => ({
  Agent: class MockAgent {
    readonly options: unknown;

    constructor(options: unknown) {
      if (mocks.agentConstructionError) {
        throw mocks.agentConstructionError;
      }
      this.options = options;
    }

    close(): Promise<void> {
      return mocks.agentClose();
    }
  },
}));

import { safeFetchFollow } from '../../src/security/safe-fetch.js';
import { getSSRFGuard, resetSSRFGuard, SSRFGuard } from '../../src/security/ssrf-guard.js';

interface PinnedLookupOptions {
  connect?: {
    lookup?: (
      hostname: string,
      options: { all?: boolean },
      callback: (
        error: NodeJS.ErrnoException | null,
        address: string | Array<{ address: string; family: number }>,
        family?: number,
      ) => void,
    ) => void;
  };
}

interface MockDispatcher {
  options: PinnedLookupOptions;
}

interface FetchInitWithDispatcher extends RequestInit {
  dispatcher?: MockDispatcher;
}

async function resolveThroughDispatcher(dispatcher: MockDispatcher): Promise<Array<{ address: string; family: number }>> {
  const lookup = dispatcher.options.connect?.lookup;
  if (!lookup) {
    throw new Error('Expected a pinned dispatcher lookup');
  }

  return new Promise((resolve, reject) => {
    lookup('ignored.example', { all: true }, (error, address, family) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(Array.isArray(address) ? address : [{ address, family: family ?? 0 }]);
    });
  });
}

describe('SSRF DNS pinning', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    resetSSRFGuard();
    mocks.dnsLookup.mockReset();
    mocks.agentClose.mockClear();
    mocks.agentConstructionError = undefined;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    resetSSRFGuard();
  });

  it('returns every resolved and validated address for a hostname', async () => {
    mocks.dnsLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ]);

    const result = await new SSRFGuard().isSafeUrl('https://public.example/resource');

    expect(result).toEqual({
      safe: true,
      addresses: [
        { address: '93.184.216.34', family: 4 },
        { address: '2606:4700:4700::1111', family: 6 },
      ],
    });
  });

  it('fails closed when DNS resolution returns no addresses', async () => {
    mocks.dnsLookup.mockResolvedValue([]);

    const result = await new SSRFGuard().isSafeUrl('https://empty-dns.example/resource');

    expect(result.safe).toBe(false);
    expect(result.reason).toContain('DNS resolution returned no addresses');
  });

  it('pins the validated address instead of performing a rebinding lookup', async () => {
    mocks.dnsLookup
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }]);
    getSSRFGuard();

    const connectedAddresses: string[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const dispatcher = (init as FetchInitWithDispatcher | undefined)?.dispatcher;
      expect(dispatcher).toBeDefined();
      const resolved = await resolveThroughDispatcher(dispatcher!);
      connectedAddresses.push(...resolved.map(({ address }) => address));
      return new Response('ok', { status: 200 });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const response = await safeFetchFollow('https://rebind.example/data');

    expect(await response.text()).toBe('ok');
    expect(mocks.dnsLookup).toHaveBeenCalledTimes(1);
    expect(connectedAddresses).toEqual(['93.184.216.34']);
    expect(connectedAddresses).not.toContain('169.254.169.254');
    expect(mocks.agentClose).toHaveBeenCalledTimes(1);
  });

  it('uses the dispatcher-free fallback for a public IP literal', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect((init as FetchInitWithDispatcher | undefined)?.dispatcher).toBeUndefined();
      return new Response('ok', { status: 200 });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await safeFetchFollow('https://93.184.216.34/data');

    expect(mocks.dnsLookup).not.toHaveBeenCalled();
    expect(mocks.agentClose).not.toHaveBeenCalled();
  });

  it('uses the dispatcher-free fallback when DNS resolution is disabled', async () => {
    getSSRFGuard({ resolveDns: false });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect((init as FetchInitWithDispatcher | undefined)?.dispatcher).toBeUndefined();
      return new Response('ok', { status: 200 });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await safeFetchFollow('https://public.example/data');

    expect(mocks.dnsLookup).not.toHaveBeenCalled();
    expect(mocks.agentClose).not.toHaveBeenCalled();
  });

  it('revalidates and repins a cross-host redirect', async () => {
    mocks.dnsLookup.mockImplementation((hostname: string) => {
      if (hostname === 'first.example') {
        return Promise.resolve([{ address: '93.184.216.34', family: 4 }]);
      }
      if (hostname === 'second.example') {
        return Promise.resolve([{ address: '142.250.74.14', family: 4 }]);
      }
      return Promise.reject(new Error(`Unexpected hostname: ${hostname}`));
    });
    getSSRFGuard();

    const connectedAddresses: string[] = [];
    const fetchMock = vi
      .fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const dispatcher = (init as FetchInitWithDispatcher | undefined)?.dispatcher;
        expect(dispatcher).toBeDefined();
        const resolved = await resolveThroughDispatcher(dispatcher!);
        connectedAddresses.push(resolved[0]?.address ?? 'missing');
        if (connectedAddresses.length === 1) {
          return new Response(null, {
            status: 302,
            headers: { Location: 'https://second.example/final' },
          });
        }
        return new Response('done', { status: 200 });
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const response = await safeFetchFollow('https://first.example/start');

    expect(await response.text()).toBe('done');
    expect(mocks.dnsLookup.mock.calls.map(([hostname]) => hostname)).toEqual([
      'first.example',
      'second.example',
    ]);
    expect(connectedAddresses).toEqual(['93.184.216.34', '142.250.74.14']);
    expect(mocks.agentClose).toHaveBeenCalledTimes(2);
  });

  it('rejects a private address during the first validation', async () => {
    mocks.dnsLookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    getSSRFGuard();
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(safeFetchFollow('https://metadata-proxy.example/data')).rejects.toThrow(
      'URL blocked by SSRF guard',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.agentClose).not.toHaveBeenCalled();
  });

  it('fails closed when the pinning dispatcher cannot be created', async () => {
    mocks.dnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    mocks.agentConstructionError = new Error('Agent API missing');
    getSSRFGuard();
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(safeFetchFollow('https://public.example/data')).rejects.toThrow(
      'SSRF DNS pinning dispatcher is unavailable',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
