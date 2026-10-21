/**
 * Seed data for the mock supplier. Tuples: [sku, title, category, baseCostCents, brand?].
 * Three VeRO traps (brand in the seed blocklist) and two image-less products are marked below.
 */
export type SeedRow = readonly [sku: string, title: string, category: string, costCents: number, brand?: string];

export const MOCK_CATEGORIES = [
  'Home & Kitchen',
  'Pet Supplies',
  'Fitness & Outdoors',
  'Electronics Accessories',
  'Garden & Patio',
  'Toys & Games',
] as const;

export const SEED_ROWS: readonly SeedRow[] = [
  ['HK-001', 'Silicone Kitchen Utensil Set 12 Piece Heat Resistant Non-Stick', 'Home & Kitchen', 1140],
  ['HK-002', 'Stainless Steel Insulated Tumbler 30oz with Straw Lid', 'Home & Kitchen', 890],
  ['HK-003', 'Bamboo Cutting Board Set of 3 with Juice Groove', 'Home & Kitchen', 1320],
  ['HK-004', 'Electric Milk Frother Handheld Battery Operated Whisk', 'Home & Kitchen', 420],
  ['HK-005', 'Collapsible Silicone Food Storage Containers Set of 4', 'Home & Kitchen', 980],
  ['HK-006', 'Over the Sink Dish Drying Rack Roll Up Stainless Steel', 'Home & Kitchen', 760],
  ['HK-007', 'Digital Kitchen Scale 11lb with Tare Function LCD', 'Home & Kitchen', 650],
  ['HK-008', 'Magnetic Spice Rack for Refrigerator 2 Tier', 'Home & Kitchen', 870],
  ['HK-009', 'Vacuum Sealer Bags Rolls 8x50 BPA Free', 'Home & Kitchen', 1050],
  ['HK-010', 'Yeti Style Rambler Tumbler 20oz Powder Coated', 'Home & Kitchen', 1150, 'Yeti'], // VeRO trap
  ['PS-001', 'Slow Feeder Dog Bowl Anti Gulping Maze Design Large', 'Pet Supplies', 540],
  ['PS-002', 'Self Cleaning Slicker Brush for Dogs and Cats', 'Pet Supplies', 380],
  ['PS-003', 'Cat Water Fountain 2.5L Ultra Quiet Pump with Filters', 'Pet Supplies', 1480],
  ['PS-004', 'Reflective Dog Harness No Pull Adjustable Medium', 'Pet Supplies', 720],
  ['PS-005', 'Interactive Cat Toy Butterfly Spinning Electric', 'Pet Supplies', 610],
  ['PS-006', 'Orthopedic Dog Bed Memory Foam Washable Cover 36 inch', 'Pet Supplies', 2890],
  ['PS-007', 'Pet Hair Remover Roller Reusable Lint Brush', 'Pet Supplies', 450],
  ['PS-008', 'Dog Poop Bags 900 Count Leak Proof with Dispenser', 'Pet Supplies', 690],
  ['PS-009', 'Cat Scratcher Lounge Cardboard Reversible', 'Pet Supplies', 1180],
  ['PS-010', 'Pet Grooming Gloves Deshedding Pair', 'Pet Supplies', 330],
  ['FO-001', 'Resistance Bands Set of 5 Latex Loop with Carry Bag', 'Fitness & Outdoors', 410],
  ['FO-002', 'Yoga Mat 6mm Non Slip TPE with Strap', 'Fitness & Outdoors', 1260],
  ['FO-003', 'Adjustable Jump Rope Speed Cable Ball Bearing', 'Fitness & Outdoors', 350],
  ['FO-004', 'Camping Headlamp Rechargeable LED 230 Degree', 'Fitness & Outdoors', 590],
  ['FO-005', 'Massage Gun Deep Tissue 6 Heads Portable', 'Fitness & Outdoors', 2380],
  ['FO-006', 'Hydration Bladder 2L Leak Proof BPA Free', 'Fitness & Outdoors', 880],
  ['FO-007', 'Foam Roller High Density 18 inch', 'Fitness & Outdoors', 940],
  ['FO-008', 'Nike Dri-Fit Training Socks 6 Pack Crew', 'Fitness & Outdoors', 1290, 'Nike'], // VeRO trap
  ['FO-009', 'Ab Roller Wheel with Knee Pad Core Trainer', 'Fitness & Outdoors', 720],
  ['FO-010', 'Collapsible Water Bottle Silicone 750ml', 'Fitness & Outdoors', 470],
  ['EA-001', 'USB C Charging Cable 3 Pack Braided 6ft 60W', 'Electronics Accessories', 480],
  ['EA-002', 'Phone Stand Adjustable Aluminum Desk Holder', 'Electronics Accessories', 560],
  ['EA-003', 'Wireless Charger Pad 15W Qi Fast Charging', 'Electronics Accessories', 690],
  ['EA-004', 'Cable Management Box Large with Lid', 'Electronics Accessories', 1120],
  ['EA-005', 'Bluetooth Tracker Tag Key Finder Compatible Find My', 'Electronics Accessories', 920],
  ['EA-006', 'Laptop Stand Ergonomic Foldable Aluminum', 'Electronics Accessories', 1540],
  ['EA-007', 'Screen Cleaner Kit Spray with Microfiber Cloth', 'Electronics Accessories', 390],
  ['EA-008', 'Earbud Case Cover Silicone Shockproof', 'Electronics Accessories', 210],
  ['EA-009', 'Car Phone Mount Dashboard Vent Clip 360', 'Electronics Accessories', 640],
  ['EA-010', 'Apple Watch Compatible Sport Band 44mm Silicone', 'Electronics Accessories', 310, 'Apple'], // VeRO trap
  ['GP-001', 'Expandable Garden Hose 50ft with 10 Pattern Nozzle', 'Garden & Patio', 1670],
  ['GP-002', 'Solar Pathway Lights 8 Pack Waterproof LED', 'Garden & Patio', 1890],
  ['GP-003', 'Raised Garden Bed Galvanized Metal 4x2 ft', 'Garden & Patio', 3450],
  ['GP-004', 'Garden Kneeler and Seat Foldable with Tool Pouch', 'Garden & Patio', 2180],
  ['GP-005', 'Drip Irrigation Kit 100ft Adjustable Emitters', 'Garden & Patio', 1420],
  ['GP-006', 'Hanging Planter Macrame Set of 3 Cotton Rope', 'Garden & Patio', 760],
  ['GP-007', 'Bird Feeder Squirrel Proof Metal Hanging', 'Garden & Patio', 1980],
  ['GP-008', 'Pruning Shears Bypass Heavy Duty Titanium Blade', 'Garden & Patio', 830],
  ['GP-009', 'Outdoor String Lights 48ft Shatterproof LED Bulbs', 'Garden & Patio', 2140],
  ['GP-010', 'Weed Puller Tool Stand Up Long Handle Steel', 'Garden & Patio', 1560],
  ['TG-001', 'Magnetic Building Tiles 100 Piece STEM Set', 'Toys & Games', 2290],
  ['TG-002', 'Kids Walkie Talkies 2 Pack 3 Mile Range', 'Toys & Games', 1310],
  ['TG-003', 'Wooden Puzzle Set Animals Toddler 6 Pack', 'Toys & Games', 890],
  ['TG-004', 'Bubble Machine Automatic Blower with 2 Solution Bottles', 'Toys & Games', 1140],
  ['TG-005', 'Fidget Sensory Toy Pack 24 Piece Stress Relief', 'Toys & Games', 620],
  ['TG-006', 'Remote Control Stunt Car 4WD Rechargeable 360 Flip', 'Toys & Games', 1480],
  ['TG-007', 'Dinosaur Figures 12 Pack Realistic Large', 'Toys & Games', 1060],
  ['TG-008', 'Water Beads Sensory Play 50000 Non Toxic', 'Toys & Games', 540],
  ['TG-009', 'Kinetic Play Sand 2lb with Molds Set', 'Toys & Games', 980],
  ['TG-010', 'Slime Making Kit DIY 48 Colors Glitter Supplies', 'Toys & Games', 1240],
];

/** SKUs that are deliberately seeded with no images (compliance gate demo). */
export const NO_IMAGE_SKUS: ReadonlySet<string> = new Set(['HK-009', 'TG-008']);

/** Supplier-side boilerplate the title generator must strip. */
export const SUPPLIER_BOILERPLATE = [
  'Free Shipping',
  'Hot Sale',
  'New Arrival',
  'Dropshipping',
  'Wholesale',
  '2026',
  'Factory Direct',
];
