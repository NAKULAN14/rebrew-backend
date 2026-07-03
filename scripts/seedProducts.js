'use strict';

/**
 * ReBrew — Product Seed Script
 * Usage: node scripts/seedProducts.js
 *
 * - Connects to MongoDB using config/database.js
 * - Deletes all existing products
 * - Inserts 5 ReBrew products
 * - Exits cleanly
 *
 * Slugs are set explicitly because insertMany skips Mongoose
 * pre-save middleware (including the auto-slug hook).
 */

require('dotenv').config();

const { connectDB, disconnectDB } = require('../config/database');
const Product = require('../models/Product');

// ── Seed Data ─────────────────────────────────────────────
const products = [
  {
    name:             'ReBrew Grape',
    slug:             'rebrew-grape',
    flavor:           'grape',
    sku:              'RB-GRAPE-275',
    shortDescription: 'A deep, sun-warmed wild grape ferment. Bold and slightly tart.',
    description:
      'Made from sun-ripened Nashik grapes fermented slowly over 10 days, ReBrew Grape is the closest thing to sitting on a vineyard terrace without the wine. It carries a deep berry nose, a lightly tart body, and the earthy warmth of a natural wild ferment. Zero alcohol. All character. Non-alcoholic fermented fruit soda, 275ml.',
    price:         110,
    compareAtPrice:149,
    stock:          10,
    volume:         275,
    alcoholContent: 0.0,
    isNatural:      true,
    isOrganic:      false,
    isFeatured:     true,
    isNewArrival:   false,
    active:         true,
    tastingNotes:   ['dark berry', 'wild ferment', 'light tannin', 'tart finish'],
    ingredients: [
      {
        name:        'Nashik Grape Juice',
        description: 'Cold-pressed from sun-ripened red grapes. No concentrate, no additives.',
        icon:        '🍇',
      },
      {
        name:        'Wild Yeast Culture',
        description: 'Natural fermentation starter harvested from the fruit itself.',
        icon:        '🌿',
      },
      {
        name:        'Filtered Water',
        description: 'Triple-filtered and pH-balanced for a clean ferment base.',
        icon:        '💧',
      },
      {
        name:        'Unrefined Cane Sugar',
        description: 'Used in small amounts to feed fermentation — most is consumed in the process.',
        icon:        '🌾',
      },
    ],
    metaTitle:       'ReBrew Grape — Non-Alcoholic Fermented Grape Soda | 275ml',
    metaDescription: 'Deep, tart wild grape ferment. Zero alcohol, full flavour. ReBrew non-alcoholic fermented fruit soda made from Nashik grapes.',
    images:         [],
  },

  {
    name:             'ReBrew Apple & Cinnamon',
    slug:             'rebrew-apple-cinnamon',
    flavor:           'apple_cinnamon',
    sku:              'RB-APPLE-275',
    shortDescription: 'Orchard-fresh apple ferment, warmed with Ceylon cinnamon.',
    description:
      'ReBrew Apple & Cinnamon starts with Himachal Pradesh apple juice fermented for 8 days and finished with a cold steep of real Ceylon cinnamon bark — not extract, not powder, actual bark. The result is a warming, lightly fizzy brew that tastes like autumn in a bottle. Complex enough for a dinner table. Refreshing enough for an afternoon. Non-alcoholic fermented fruit soda, 275ml.',
    price:         110,
    compareAtPrice:149,
    stock:          10,
    volume:         275,
    alcoholContent: 0.0,
    isNatural:      true,
    isOrganic:      false,
    isFeatured:     true,
    isNewArrival:   false,
    active:         true,
    tastingNotes:   ['crisp apple', 'warm spice', 'cinnamon bark', 'dry finish'],
    ingredients: [
      {
        name:        'Himachal Pradesh Apple Juice',
        description: 'Single-origin apple juice, cold-pressed from Kinnaur valley apples.',
        icon:        '🍎',
      },
      {
        name:        'Ceylon Cinnamon Bark',
        description: 'Steeped whole — not powdered — for a clean spice note without bitterness.',
        icon:        '🌿',
      },
      {
        name:        'Wild Yeast Culture',
        description: 'Natural fermentation starter for slow, controlled fermentation.',
        icon:        '✨',
      },
      {
        name:        'Filtered Water',
        description: 'Triple-filtered and pH-balanced.',
        icon:        '💧',
      },
      {
        name:        'Unrefined Cane Sugar',
        description: 'Small quantity used to initiate fermentation.',
        icon:        '🌾',
      },
    ],
    metaTitle:       'ReBrew Apple & Cinnamon — Non-Alcoholic Fermented Soda | 275ml',
    metaDescription: 'Orchard apple juice fermented with real Ceylon cinnamon bark. Zero alcohol. ReBrew non-alcoholic fermented fruit soda.',
    images:         [],
  },

  {
    name:             'ReBrew Ginger',
    slug:             'rebrew-ginger',
    flavor:           'ginger',
    sku:              'RB-GINGER-275',
    shortDescription: 'Sharp, fiery Coorg ginger with an earthy wild ferment edge.',
    description:
      'This is not a ginger beer. ReBrew Ginger is built from fresh Coorg ginger juice — one of the most pungent and aromatic ginger varieties in India — fermented over 7 days into a sharp, warming brew that lands somewhere between a craft ginger beer and a living probiotic drink. The heat builds slowly. The finish is long. Non-alcoholic fermented fruit soda, 275ml.',
    price:         110,
    compareAtPrice:149,
    stock:          10,
    volume:         275,
    alcoholContent: 0.0,
    isNatural:      true,
    isOrganic:      true,
    isFeatured:     false,
    isNewArrival:   false,
    active:         true,
    tastingNotes:   ['sharp ginger', 'slow heat', 'earthy ferment', 'long finish'],
    ingredients: [
      {
        name:        'Fresh Coorg Ginger Juice',
        description: 'Cold-pressed from organically grown Coorg ginger. No dried powder used.',
        icon:        '🫚',
      },
      {
        name:        'Ginger Bug Culture',
        description: 'Traditional wild fermentation starter made from ginger, water, and sugar.',
        icon:        '🌿',
      },
      {
        name:        'Filtered Water',
        description: 'Triple-filtered and pH-balanced.',
        icon:        '💧',
      },
      {
        name:        'Unrefined Cane Sugar',
        description: 'Used to activate the ginger bug and feed fermentation.',
        icon:        '🌾',
      },
    ],
    metaTitle:       'ReBrew Ginger — Non-Alcoholic Fermented Ginger Soda | 275ml',
    metaDescription: 'Sharp fermented ginger brew made from fresh Coorg ginger. Zero alcohol, all heat. ReBrew non-alcoholic fermented soda.',
    images:         [],
  },

  {
    name:             'ReBrew Pineapple',
    slug:             'rebrew-pineapple',
    flavor:           'pineapple',
    sku:              'RB-PINEAPPLE-275',
    shortDescription: 'Bright, tropical fermented pineapple — vivid and sun-kissed.',
    description:
      'ReBrew Pineapple is made using the tepache method: Kerala pineapple rinds and flesh fermented with spices for 6 days until it turns bright, tangy, and alive. It\'s the most approachable of the ReBrew range — vivid tropical flavour, a light natural fizz, and a clean finish that makes it impossible to put down. Pairs well with spiced food, or simply with doing nothing. Non-alcoholic fermented fruit soda, 275ml.',
    price:         110,
    compareAtPrice:149,
    stock:          10,
    volume:         275,
    alcoholContent: 0.0,
    isNatural:      true,
    isOrganic:      false,
    isFeatured:     false,
    isNewArrival:   true,
    active:         true,
    tastingNotes:   ['bright tropical', 'tangy pineapple', 'light spice', 'clean finish'],
    ingredients: [
      {
        name:        'Kerala Pineapple',
        description: 'Whole pineapple — flesh and rinds — used for full depth of flavour.',
        icon:        '🍍',
      },
      {
        name:        'Ceylon Cinnamon Bark',
        description: 'Whole bark added during fermentation for a background spice note.',
        icon:        '🌿',
      },
      {
        name:        'Clove',
        description: 'One or two whole cloves — enough to add complexity without dominating.',
        icon:        '✨',
      },
      {
        name:        'Filtered Water',
        description: 'Triple-filtered and pH-balanced.',
        icon:        '💧',
      },
      {
        name:        'Unrefined Cane Sugar',
        description: 'Used to feed the fermentation — most is consumed in the process.',
        icon:        '🌾',
      },
    ],
    metaTitle:       'ReBrew Pineapple — Non-Alcoholic Fermented Tepache | 275ml',
    metaDescription: 'Bright, tangy fermented pineapple tepache made from whole Kerala pineapple. Zero alcohol. ReBrew non-alcoholic fermented fruit soda.',
    images:         [],
  },

  {
    name:             'ReBrew Mint',
    slug:             'rebrew-mint',
    flavor:           'mint',
    sku:              'RB-MINT-275',
    shortDescription: 'Cool, green fermented mint — crisp and unexpectedly complex.',
    description:
      'ReBrew Mint is the lightest, most refreshing brew in the range. Fresh Ooty peppermint leaves are fermented for 5 days with a clean yeast culture, producing a pale green, gently fizzy drink that is cool on entry and warm on the finish. It defies the assumption that fermented drinks need to be fruit-forward — mint carries a wild ferment beautifully. Non-alcoholic fermented fruit soda, 275ml.',
    price:         110,
    compareAtPrice:149,
    stock:          10,
    volume:         275,
    alcoholContent: 0.0,
    isNatural:      true,
    isOrganic:      true,
    isFeatured:     false,
    isNewArrival:   true,
    active:         true,
    tastingNotes:   ['cool mint', 'clean ferment', 'light fizz', 'warm finish'],
    ingredients: [
      {
        name:        'Ooty Peppermint Leaves',
        description: 'Whole fresh leaves steeped and fermented — sourced from Nilgiris hill farms.',
        icon:        '🌱',
      },
      {
        name:        'Wild Yeast Culture',
        description: 'Natural fermentation starter for a clean, controlled ferment.',
        icon:        '✨',
      },
      {
        name:        'Filtered Water',
        description: 'Triple-filtered and pH-balanced for a crisp ferment base.',
        icon:        '💧',
      },
      {
        name:        'Unrefined Cane Sugar',
        description: 'Small quantity to initiate and feed the fermentation.',
        icon:        '🌾',
      },
    ],
    metaTitle:       'ReBrew Mint — Non-Alcoholic Fermented Mint Soda | 275ml',
    metaDescription: 'Cool fermented peppermint drink from Ooty mint leaves. Zero alcohol, crisp and refreshing. ReBrew non-alcoholic fermented fruit soda.',
    images:         [],
  },
];

// ── Run ───────────────────────────────────────────────────
const seed = async () => {
  try {
    await connectDB();

    // Wipe existing products
    const deleted = await Product.deleteMany({});
    console.log(`\n  Cleared ${deleted.deletedCount} existing product(s).`);

    // insertMany bypasses pre-save middleware (including the slug hook),
    // so slugs are set explicitly in the data above.
    // We use { ordered: true } so the script halts on the first error.
    const inserted = await Product.insertMany(products, { ordered: true });

    console.log(`\n  ✓ Seeded ${inserted.length} products:\n`);
    inserted.forEach((p, i) => {
      console.log(`    ${i + 1}. ${p.name}`);
      console.log(`       slug     : ${p.slug}`);
      console.log(`       flavor   : ${p.flavor}`);
      console.log(`       price    : ₹${p.price}`);
      console.log(`       stock    : ${p.stock}`);
      console.log(`       featured : ${p.isFeatured}`);
      console.log(`       _id      : ${p._id}`);
      console.log('');
    });

    console.log('  Done. Run GET /api/v1/products to verify.\n');
  } catch (err) {
    console.error('\n  Seed failed:', err.message);
    if (err.writeErrors) {
      err.writeErrors.forEach(e =>
        console.error(`  → Document ${e.index}: ${e.errmsg}`)
      );
    }
    process.exit(1);
  } finally {
    await disconnectDB();
    process.exit(0);
  }
};

seed();
