import type { Product } from '@/api/types';

const img = (seed: string) => `https://picsum.photos/seed/${seed}/400/400`;
const at = '2026-10-19T22:10:00Z';

type Seed = [sku: string, title: string, cost: number, ship: number, stock: number, wh: string, cat: string, brand?: string, noImg?: boolean];

const seeds: Seed[] = [
  ['MK-1001', 'Stainless steel pour-over coffee dripper, 2-cup', 1180, 0, 240, 'US', 'Kitchen'],
  ['MK-1002', 'Silicone kitchen utensil set, 12 pieces, heat resistant', 1420, 0, 86, 'US', 'Kitchen'],
  ['MK-1003', 'Collapsible silicone colander with handles', 690, 180, 410, 'CN', 'Kitchen'],
  ['MK-1004', 'Digital kitchen scale, 0.1 g precision, USB-C', 1310, 220, 120, 'CN', 'Kitchen'],
  ['MK-2001', 'LED desk lamp with wireless phone charger', 2240, 0, 58, 'US', 'Home office'],
  ['MK-2002', 'Bamboo monitor stand with drawer', 1890, 0, 33, 'US', 'Home office'],
  ['MK-2003', 'Felt desk mat, 90 x 40 cm, charcoal', 920, 160, 500, 'CN', 'Home office'],
  ['MK-2004', 'Cable management box, oversize, white', 1050, 0, 72, 'US', 'Home office'],
  ['MK-3001', 'Resistance band set, 5 levels with door anchor', 780, 150, 900, 'CN', 'Fitness'],
  ['MK-3002', 'Foam roller, high density, 45 cm', 1130, 0, 140, 'US', 'Fitness'],
  ['MK-3003', 'Jump rope, weighted handles, adjustable', 620, 140, 620, 'CN', 'Fitness'],
  ['MK-3004', 'Yoga mat, 6 mm, non-slip, with carry strap', 1460, 0, 95, 'US', 'Fitness'],
  ['MK-4001', 'Trail running headlamp, 400 lumen, rechargeable', 1240, 190, 210, 'CN', 'Outdoors'],
  ['MK-4002', 'Insulated water bottle, 32 oz, powder coat', 1380, 0, 180, 'US', 'Outdoors'],
  ['MK-4003', 'Camp folding stool, aluminium, 150 kg', 1610, 0, 44, 'US', 'Outdoors'],
  ['MK-4004', 'Dry bag 20 L, roll top, with shoulder strap', 860, 170, 330, 'CN', 'Outdoors'],
  ['MK-5001', 'Pet grooming glove pair, deshedding', 410, 130, 1500, 'CN', 'Pets'],
  ['MK-5002', 'Slow feeder dog bowl, maze pattern', 720, 0, 260, 'US', 'Pets'],
  ['MK-5003', 'Cat tunnel, collapsible, 3-way', 940, 210, 150, 'CN', 'Pets'],
  ['MK-6001', 'Magnetic phone car mount, dashboard', 530, 120, 800, 'CN', 'Car'],
  ['MK-6002', 'Trunk organiser, collapsible, 3 compartments', 1370, 0, 68, 'US', 'Car'],
  ['MK-6003', 'Tyre pressure gauge, digital, backlit', 640, 130, 420, 'CN', 'Car'],
  // VeRO traps: brand names on the blocklist
  ['MK-7001', 'Yeti Rambler 20 oz tumbler, stainless', 2100, 0, 40, 'US', 'Outdoors', 'Yeti'],
  ['MK-7002', 'Stanley Quencher 40 oz travel tumbler', 2350, 0, 25, 'US', 'Outdoors', 'Stanley'],
  ['MK-7003', 'Lululemon align leggings, 25 in, black', 2900, 0, 60, 'CN', 'Fitness', 'Lululemon'],
  // No images
  ['MK-8001', 'Replacement blender gasket seals, 4 pack', 310, 110, 2000, 'CN', 'Kitchen', undefined, true],
  ['MK-8002', 'Universal AC remote control', 720, 140, 350, 'CN', 'Home', undefined, true],
  // Slow shipping will be flagged by handling time
  ['MK-9001', 'Cast iron skillet 12 in, pre-seasoned', 2480, 900, 30, 'CN', 'Kitchen'],
];

export const products: Product[] = seeds.map(([sku, title, cost, ship, stock, wh, cat, brand, noImg]) => ({
  id: `prod_${sku.toLowerCase().replace('-', '_')}`,
  supplier: 'mock',
  supplierSku: sku,
  title,
  description: `${title}. Ships from our ${wh === 'US' ? 'United States' : 'China'} warehouse. Includes retail packaging and a 30-day return window.`,
  images: noImg ? [] : [img(sku), img(`${sku}-b`)],
  costCents: cost,
  shippingCents: ship,
  handlingDays: wh === 'US' ? 1 : 2,
  stock,
  warehouseCountry: wh,
  brand,
  categoryHint: cat,
  updatedAt: at,
}));

export const blockedBrands = ['yeti', 'stanley', 'lululemon'];

export const byId = (id: string): Product | undefined => products.find((p) => p.id === id);
