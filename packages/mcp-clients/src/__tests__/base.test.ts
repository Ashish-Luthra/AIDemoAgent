import { describe, expect, it, vi } from 'vitest';
import {
  BaseMcpConnector,
  ReadOnlyViolationError,
  type McpSource,
  type McpTransport,
  type SourceDocument,
} from '../base.js';

/** A concrete connector for exercising the base class. */
class FakeConnector extends BaseMcpConnector {
  readonly source: McpSource = 'confluence';

  async listDocuments(): Promise<SourceDocument[]> {
    return this.read('search_pages', { space: 'SALES' });
  }

  async fetchDocument(externalId: string): Promise<SourceDocument> {
    return this.read('get_page', { id: externalId });
  }

  /** Exposes the guarded read for a write-tool test. */
  callWrite(): Promise<unknown> {
    return this.read('update_page', { id: '1' });
  }
}

const fakeDoc: SourceDocument = {
  source: 'confluence',
  externalId: 'p1',
  uri: 'https://wiki/p1',
  title: 'Pricing',
  mimeType: 'text/html',
  fetchedAt: '2026-05-29T00:00:00.000Z',
};

function transportReturning(value: unknown): McpTransport {
  return { callTool: vi.fn().mockResolvedValue(value) };
}

describe('BaseMcpConnector', () => {
  it('is read-only and exposes its source', () => {
    const c = new FakeConnector({ transport: transportReturning([]) });
    expect(c.readOnly).toBe(true);
    expect(c.source).toBe('confluence');
  });

  it('routes reads through the transport with the right tool + args', async () => {
    const transport = transportReturning([fakeDoc]);
    const c = new FakeConnector({ transport });
    const docs = await c.listDocuments();
    expect(docs).toEqual([fakeDoc]);
    expect(transport.callTool).toHaveBeenCalledWith('search_pages', { space: 'SALES' });
  });

  it('refuses mutating tools with ReadOnlyViolationError', async () => {
    const transport = transportReturning(null);
    const c = new FakeConnector({ transport });
    await expect(c.callWrite()).rejects.toBeInstanceOf(ReadOnlyViolationError);
    expect(transport.callTool).not.toHaveBeenCalled();
  });

  it('retries transient transport failures via the resilience wrapper', async () => {
    const callTool = vi
      .fn()
      .mockRejectedValueOnce(new Error('ETIMEDOUT'))
      .mockResolvedValue([fakeDoc]);
    const c = new FakeConnector({
      transport: { callTool },
      resilience: { sleep: () => Promise.resolve() },
    });
    const docs = await c.listDocuments();
    expect(docs).toEqual([fakeDoc]);
    expect(callTool).toHaveBeenCalledTimes(2);
  });
});
