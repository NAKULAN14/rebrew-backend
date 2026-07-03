'use strict';

const { Cart }  = require('../models/index');
const Product   = require('../models/Product');
const { AppError, sendSuccess } = require('../utils/apiResponse');
const logger    = require('../utils/logger');

// ── Helper: fetch cart and populate product details ───────
const getPopulatedCart = (userId) =>
  Cart.findOne({ user: userId }).populate({
    path:   'items.product',
    select: 'name flavor price stock active images slug',
  });

// ── Helper: validate and re-price all cart items ──────────
// SECURITY: Never trust frontend prices. Always recompute from DB.
const validateAndPriceItems = async (items) => {
  const productIds = items.map(i => i.product);
  const products   = await Product.find({
    _id:    { $in: productIds },
    active: true,
  }).select('name flavor price stock active');

  const productMap = new Map(products.map(p => [p._id.toString(), p]));

  const errors  = [];
  const priced  = [];

  for (const item of items) {
    const productId = item.product.toString();
    const product   = productMap.get(productId);

    if (!product) {
      errors.push(`Product ${productId} is no longer available.`);
      continue;
    }
    if (!product.active) {
      errors.push(`"${product.name}" is no longer available.`);
      continue;
    }
    if (product.stock < item.quantity) {
      errors.push(`"${product.name}" has only ${product.stock} unit(s) in stock.`);
      continue;
    }

    priced.push({
      product:  product._id,
      quantity: item.quantity,
      price:    product.price, // Server-side price — not from client
    });
  }

  return { priced, errors };
};

/* ─────────────────────────────────────────────────────────
   GET /cart
───────────────────────────────────────────────────────── */
exports.getCart = async (req, res, next) => {
  try {
    let cart = await getPopulatedCart(req.user._id);

    if (!cart) {
      // Return empty cart shape
      return sendSuccess(res, {
        message: 'Cart fetched.',
        data: {
          cart: {
            items:     [],
            total:     0,
            itemCount: 0,
          },
        },
      });
    }

    // Re-validate stock and prices on each GET (items may have changed since added)
    let dirty = false;
    const validItems = [];

    for (const item of cart.items) {
      const product = item.product;

      // Product was deleted or deactivated
      if (!product || !product.active) {
        dirty = true;
        continue;
      }

      // Price changed server-side — update cart silently
      if (item.price !== product.price) {
        item.price = product.price;
        dirty = true;
      }

      // Stock dropped below cart quantity — clamp
      if (item.quantity > product.stock) {
        item.quantity = product.stock;
        dirty = true;
      }

      if (item.quantity > 0) validItems.push(item);
    }

    if (dirty) {
      cart.items = validItems;
      await cart.save();
    }

    return sendSuccess(res, {
      message: 'Cart fetched.',
      data: {
        cart: {
          _id:       cart._id,
          items:     cart.items,
          total:     cart.total,
          itemCount: cart.itemCount,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   POST /cart/add
───────────────────────────────────────────────────────── */
exports.addToCart = async (req, res, next) => {
  try {
    const { productId, quantity } = req.body;
    const qty = parseInt(quantity, 10);

    // Validate product exists, is active, has sufficient stock
    const product = await Product.findOne({ _id: productId, active: true });
    if (!product) return next(new AppError('Product not found or unavailable.', 404));

    if (qty < 1 || qty > 99) {
      return next(new AppError('Quantity must be between 1 and 99.', 400));
    }

    let cart = await Cart.findOne({ user: req.user._id });

    if (!cart) {
      cart = new Cart({ user: req.user._id, items: [] });
    }

    const existingIndex = cart.items.findIndex(
      i => i.product.toString() === productId
    );

    if (existingIndex > -1) {
      // Update existing item
      const newQty = cart.items[existingIndex].quantity + qty;

      if (newQty > product.stock) {
        return next(
          new AppError(
            `Cannot add ${qty} more. Only ${product.stock - cart.items[existingIndex].quantity} unit(s) available.`,
            400
          )
        );
      }

      cart.items[existingIndex].quantity = newQty;
      cart.items[existingIndex].price    = product.price; // Refresh price
    } else {
      // Add new item
      if (qty > product.stock) {
        return next(new AppError(`Only ${product.stock} unit(s) available.`, 400));
      }

      cart.items.push({
        product:  product._id,
        quantity: qty,
        price:    product.price, // Server-side price
      });
    }

    await cart.save();

    // Return populated cart
    const populatedCart = await getPopulatedCart(req.user._id);

    logger.info(`Cart: added ${qty}× "${product.name}" for user ${req.user._id}`);

    return sendSuccess(res, {
      statusCode: 201,
      message:    `${product.name} added to cart.`,
      data: {
        cart: {
          _id:       populatedCart._id,
          items:     populatedCart.items,
          total:     populatedCart.total,
          itemCount: populatedCart.itemCount,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   PUT /cart/update
   Update quantity of a specific item. quantity=0 removes it.
───────────────────────────────────────────────────────── */
exports.updateCartItem = async (req, res, next) => {
  try {
    const { productId, quantity } = req.body;
    const qty = parseInt(quantity, 10);

    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart || cart.items.length === 0) {
      return next(new AppError('Cart is empty.', 404));
    }

    const itemIndex = cart.items.findIndex(
      i => i.product.toString() === productId
    );
    if (itemIndex === -1) {
      return next(new AppError('Item not found in cart.', 404));
    }

    // quantity=0 means remove
    if (qty === 0) {
      cart.items.splice(itemIndex, 1);
    } else {
      // Validate stock
      const product = await Product.findOne({ _id: productId, active: true })
        .select('price stock name');

      if (!product) {
        cart.items.splice(itemIndex, 1); // Remove stale item
        await cart.save();
        return next(new AppError('Product is no longer available. It has been removed from your cart.', 410));
      }

      if (qty > product.stock) {
        return next(new AppError(`Only ${product.stock} unit(s) available.`, 400));
      }

      cart.items[itemIndex].quantity = qty;
      cart.items[itemIndex].price    = product.price; // Refresh price
    }

    await cart.save();
    const populatedCart = await getPopulatedCart(req.user._id);

    return sendSuccess(res, {
      message: qty === 0 ? 'Item removed from cart.' : 'Cart updated.',
      data: {
        cart: {
          _id:       populatedCart._id,
          items:     populatedCart.items,
          total:     populatedCart.total,
          itemCount: populatedCart.itemCount,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   DELETE /cart/remove
   Remove a specific item entirely
───────────────────────────────────────────────────────── */
exports.removeFromCart = async (req, res, next) => {
  try {
    const { productId } = req.body;

    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) return next(new AppError('Cart not found.', 404));

    const before = cart.items.length;
    cart.items = cart.items.filter(i => i.product.toString() !== productId);

    if (cart.items.length === before) {
      return next(new AppError('Item not found in cart.', 404));
    }

    await cart.save();
    const populatedCart = await getPopulatedCart(req.user._id);

    return sendSuccess(res, {
      message: 'Item removed from cart.',
      data: {
        cart: {
          _id:       populatedCart?._id,
          items:     populatedCart?.items     || [],
          total:     populatedCart?.total     || 0,
          itemCount: populatedCart?.itemCount || 0,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   DELETE /cart/clear
   Empty the entire cart
───────────────────────────────────────────────────────── */
exports.clearCart = async (req, res, next) => {
  try {
    await Cart.findOneAndUpdate(
      { user: req.user._id },
      { $set: { items: [] } }
    );

    return sendSuccess(res, { message: 'Cart cleared.' });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   POST /cart/validate
   Validate cart items before checkout — check stock & prices
   Returns validated items with server-side prices, or errors.
───────────────────────────────────────────────────────── */
exports.validateCart = async (req, res, next) => {
  try {
    const cart = await Cart.findOne({ user: req.user._id });

    if (!cart || cart.items.length === 0) {
      return next(new AppError('Your cart is empty.', 400));
    }

    const { priced, errors } = await validateAndPriceItems(cart.items);

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Some cart items have issues.',
        errors,
      });
    }

    const SHIPPING_THRESHOLD = 499;
    const SHIPPING_COST      = 40;
    const itemsTotal = priced.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const shipping   = itemsTotal >= SHIPPING_THRESHOLD ? 0 : SHIPPING_COST;
    const grandTotal = itemsTotal + shipping;

    return sendSuccess(res, {
      message: 'Cart is valid.',
      data: {
        items:      priced,
        itemsTotal,
        shipping,
        grandTotal,
        freeShippingAt: SHIPPING_THRESHOLD,
      },
    });
  } catch (err) {
    next(err);
  }
};

// Export validator for use in orderController / paymentController
exports.validateAndPriceItems = validateAndPriceItems;
