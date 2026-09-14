type DirectPeer = Readonly<{ address: string }>;

export function clientKeyFromDirectPeer(
  request: Request,
  requestIP: (request: Request) => DirectPeer | null | undefined,
): string {
  const address = requestIP(request)?.address.trim();
  return address === undefined || address.length === 0 ? 'unknown-peer' : address;
}
