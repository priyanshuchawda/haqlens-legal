import { describe, expect, test } from 'bun:test';
import { clientKeyFromDirectPeer } from './client-key';

describe('direct-peer client key', () => {
  test('uses direct peer metadata instead of request-supplied forwarding headers', () => {
    const request = new Request('https://example.test/v1/routes/prepare', {
      headers: {
        forwarded: 'for=198.51.100.45',
        'x-forwarded-for': '198.51.100.46',
      },
    });

    expect(clientKeyFromDirectPeer(request, () => ({ address: '203.0.113.12' }))).toBe(
      '203.0.113.12',
    );
  });

  test.each([undefined, null, { address: '' }, { address: '   ' }])(
    'falls back to the safe shared key when direct peer metadata is unavailable %#',
    (peer) => {
      const request = new Request('https://example.test/v1/routes/prepare');

      expect(clientKeyFromDirectPeer(request, () => peer)).toBe('unknown-peer');
    },
  );
});
