import type { Listing } from '@/api/types';

// floorPriceCents is recomputed by the store on load (see store.makeState) so it tracks the fixture fees/rule.
const base = { accountId: 'acc_demo', description: '', floorPriceCents: 0, buyerShippingCents: 0, quantity: 5, createdAt: '2026-10-03T14:00:00Z' };
const synced = '2026-10-20T06:00:00Z';

export const listings: Listing[] = [
  { ...base, id: 'lst_01', productId: 'prod_mk_1001', ebayItemId: 'mock-4f8a1', title: 'Pour-Over Coffee Dripper, Stainless Steel, 2 Cup, Reusable Filter', priceCents: 1899, status: 'active', projectedMarginPct: 0.222, lastSyncAt: synced },
  { ...base, id: 'lst_02', productId: 'prod_mk_2001', ebayItemId: 'mock-9c2d7', title: 'LED Desk Lamp with Wireless Charger, Dimmable, Touch Control', priceCents: 3499, status: 'active', projectedMarginPct: 0.214, lastSyncAt: synced },
  { ...base, id: 'lst_03', productId: 'prod_mk_3004', ebayItemId: 'mock-1b7e3', title: 'Non-Slip Yoga Mat 6mm Thick with Carry Strap, Eco TPE', priceCents: 2299, status: 'active', projectedMarginPct: 0.212, lastSyncAt: synced },
  { ...base, id: 'lst_04', productId: 'prod_mk_4002', ebayItemId: 'mock-77ad0', title: 'Insulated Stainless Water Bottle 32oz, Keeps Cold 24h, Powder Coated', priceCents: 2199, status: 'active', projectedMarginPct: 0.228, lastSyncAt: synced },
  { ...base, id: 'lst_05', productId: 'prod_mk_5002', ebayItemId: 'mock-c01f9', title: 'Slow Feeder Dog Bowl, Maze Design, Anti-Gulping, Dishwasher Safe', priceCents: 1299, status: 'active', projectedMarginPct: 0.265, lastSyncAt: synced },
  { ...base, id: 'lst_06', productId: 'prod_mk_6001', ebayItemId: 'mock-e4b22', title: 'Magnetic Phone Car Mount, Dashboard, 360 Rotation, Strong Hold', priceCents: 999, status: 'active', projectedMarginPct: 0.158, lastSyncAt: synced },
  { ...base, id: 'lst_07', productId: 'prod_mk_3001', ebayItemId: 'mock-a2210', title: 'Resistance Bands Set, 5 Levels, Door Anchor, Handles, Ankle Straps', priceCents: 1499, status: 'active', projectedMarginPct: 0.236, lastSyncAt: synced },
  { ...base, id: 'lst_08', productId: 'prod_mk_4001', ebayItemId: 'mock-58d31', title: 'Rechargeable Headlamp 400 Lumen, USB-C, Waterproof, Trail Running', priceCents: 2199, status: 'active', projectedMarginPct: 0.196, lastSyncAt: synced },
  // Paused because the supplier price moved and the margin fell below the floor
  { ...base, id: 'lst_09', productId: 'prod_mk_2002', ebayItemId: 'mock-30f6c', title: 'Bamboo Monitor Stand Riser with Storage Drawer, Desk Organiser', priceCents: 2699, status: 'paused', pauseReason: 'below_floor', projectedMarginPct: 0.021, lastSyncAt: synced },
  { ...base, id: 'lst_10', productId: 'prod_mk_4003', ebayItemId: 'mock-b19e4', title: 'Aluminium Camp Stool, Folding, Supports 150kg, Carry Bag', priceCents: 2799, status: 'paused', pauseReason: 'out_of_stock', projectedMarginPct: 0.233, lastSyncAt: synced },
  // Manual-supplier product: the order for it waits for the seller to buy it by hand
  { ...base, id: 'lst_14', productId: 'prod_man_01', ebayItemId: 'mock-6d0b8', title: 'Bamboo Cutlery Travel Set with Case, Reusable Fork Knife Spoon Chopsticks', priceCents: 2499, status: 'active', projectedMarginPct: 0.228, lastSyncAt: synced },
  // Blocked by the compliance gate (VeRO)
  { ...base, id: 'lst_11', productId: 'prod_mk_7001', title: 'Yeti Rambler 20oz Tumbler Stainless Steel', priceCents: 3299, status: 'blocked', pauseReason: 'VERO_MATCH', projectedMarginPct: 0.18, lastSyncAt: synced },
  // Drafts awaiting publish
  { ...base, id: 'lst_12', productId: 'prod_mk_1004', title: 'Digital Kitchen Scale 0.1g Precision, USB-C Rechargeable, Tare', priceCents: 2399, status: 'draft', projectedMarginPct: 0.21, lastSyncAt: synced, createdAt: '2026-10-19T18:20:00Z' },
  { ...base, id: 'lst_13', productId: 'prod_mk_6002', title: 'Collapsible Trunk Organiser, 3 Compartments, Non-Slip Base', priceCents: 2199, status: 'draft', projectedMarginPct: 0.216, lastSyncAt: synced, createdAt: '2026-10-19T18:20:00Z' },
];
