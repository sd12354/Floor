export function needsOnboarding(a: { ebayConnected: boolean; supplierConnections: { status: string }[] }): boolean {
  return !a.ebayConnected || !a.supplierConnections.some((s) => s.status === 'connected');
}
