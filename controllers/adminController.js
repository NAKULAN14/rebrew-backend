'use strict';

const User       = require('../models/User');
const Product    = require('../models/Product');
const Order      = require('../models/Order');
const { Review } = require('../models/index');
const { AppError, sendSuccess, sendPaginated } = require('../utils/apiResponse');
const { sendReviewApprovedEmail } = require('../utils/email');
const whatsapp = require('../services/whatsappService');
const logger     = require('../utils/logger');

/* ─────────────────────────────────────────────────────────
   GET /admin/dashboard
   Admin — aggregated dashboard stats
───────────────────────────────────────────────────────── */
exports.getDashboardStats = async (req, res, next) => {
  try {
    const now        = new Date();
    const today      = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo    = new Date(now - 7  * 24 * 60 * 60 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 0);
    console.log("User model:", !!User);
    console.log("Order model:", !!Order);
    console.log("Product model:", !!Product);
    const [
      totalUsers,
      newUsersToday,
      newUsersThisMonth,
      totalOrders,
      ordersToday,
      ordersThisMonth,
      ordersLastMonth,
      pendingOrders,
      revenueResult,
      revenueThisMonth,
      revenueLastMonth,
      totalProducts,
      activeProducts,
      lowStockProducts,
      topProducts,
      recentOrders,
      ordersByStatus,
      dailyRevenue,
    ] = await Promise.all([
      User.countDocuments({ role: 'customer' }),
      User.countDocuments({ role: 'customer', createdAt: { $gte: today } }),
      User.countDocuments({ role: 'customer', createdAt: { $gte: monthStart } }),

      Order.countDocuments({ paymentStatus: 'paid' }),
      Order.countDocuments({ paymentStatus: 'paid', createdAt: { $gte: today } }),
      Order.countDocuments({ paymentStatus: 'paid', createdAt: { $gte: monthStart } }),
      Order.countDocuments({ paymentStatus: 'paid', createdAt: { $gte: lastMonthStart, $lte: lastMonthEnd } }),
      Order.countDocuments({ orderStatus: { $in: ['pending', 'confirmed', 'processing'] } }),

      Order.aggregate([
        { $match: { paymentStatus: 'paid' } },
        { $group: { _id: null, total: { $sum: '$totalAmount' }, avg: { $avg: '$totalAmount' } } },
      ]),
      Order.aggregate([
        { $match: { paymentStatus: 'paid', createdAt: { $gte: monthStart } } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } },
      ]),
      Order.aggregate([
        { $match: { paymentStatus: 'paid', createdAt: { $gte: lastMonthStart, $lte: lastMonthEnd } } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } },
      ]),

      Product.countDocuments(),
      Product.countDocuments({ active: true }),
      Product.countDocuments({ active: true, stock: { $lte: 10, $gt: 0 } }),

      Product.find({ active: true }).sort({ totalSold: -1 }).limit(5).select('name flavor price totalSold stock'),

      Order.find({ paymentStatus: 'paid' })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('user', 'name email')
        .select('orderNumber totalAmount orderStatus paymentStatus createdAt items'),

      Order.aggregate([
        { $group: { _id: '$orderStatus', count: { $sum: 1 } } },
      ]),

      // Last 30 days daily revenue
      Order.aggregate([
        { $match: { paymentStatus: 'paid', createdAt: { $gte: weekAgo } } },
        {
          $group: {
            _id: {
              year:  { $year:  '$createdAt' },
              month: { $month: '$createdAt' },
              day:   { $dayOfMonth: '$createdAt' },
            },
            revenue: { $sum: '$totalAmount' },
            orders:  { $sum: 1 },
          },
        },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
      ]),
    ]);

    const totalRevenue    = revenueResult[0]?.total || 0;
    const avgOrderValue   = Math.round(revenueResult[0]?.avg || 0);
    const thisMonthRev    = revenueThisMonth[0]?.total  || 0;
    const lastMonthRev    = revenueLastMonth[0]?.total  || 0;
    const revenueGrowth   = lastMonthRev > 0
      ? Math.round(((thisMonthRev - lastMonthRev) / lastMonthRev) * 100)
      : 100;
    const orderGrowth     = ordersLastMonth > 0
      ? Math.round(((ordersThisMonth - ordersLastMonth) / ordersLastMonth) * 100)
      : 100;

    return sendSuccess(res, {
      message: 'Dashboard stats fetched.',
      data: {
        users: {
          total:        totalUsers,
          newToday:     newUsersToday,
          newThisMonth: newUsersThisMonth,
        },
        orders: {
          total:          totalOrders,
          today:          ordersToday,
          thisMonth:      ordersThisMonth,
          lastMonth:      ordersLastMonth,
          pending:        pendingOrders,
          growthPercent:  orderGrowth,
          byStatus:       ordersByStatus,
        },
        revenue: {
          total:         totalRevenue,
          thisMonth:     thisMonthRev,
          lastMonth:     lastMonthRev,
          growthPercent: revenueGrowth,
          avgOrderValue,
        },
        products: {
          total:    totalProducts,
          active:   activeProducts,
          lowStock: lowStockProducts,
        },
        topProducts,
        recentOrders,
        dailyRevenue,
      },
    });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   GET /admin/users
   Admin — list all users with search/filter/pagination
───────────────────────────────────────────────────────── */
exports.getUsers = async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip  = (page - 1) * limit;

    const filter = {};
    if (req.query.role)   filter.role     = req.query.role;
    if (req.query.active !== undefined) filter.isActive = req.query.active === 'true';
    if (req.query.search) {
      const safe = String(req.query.search).slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name:  { $regex: safe, $options: 'i' } },
        { email: { $regex: safe, $options: 'i' } },
        { phone: { $regex: safe, $options: 'i' } },
      ];
    }
    if (req.query.from || req.query.to) {
      filter.createdAt = {};
      if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
      if (req.query.to)   filter.createdAt.$lte = new Date(req.query.to);
    }

    // H3 FIX: Whitelist enforced in controller — not just in route validator.
    // If the route middleware is ever reordered or bypassed, this prevents
    // arbitrary field injection into the sort clause.
    const ALLOWED_SORT_FIELDS = ['createdAt', 'name', 'email', 'loginCount'];
    const sortField = ALLOWED_SORT_FIELDS.includes(req.query.sortBy)
      ? req.query.sortBy
      : 'createdAt';
    const sortOrder = req.query.order === 'asc' ? 1 : -1;

    const [users, total] = await Promise.all([
      User.find(filter)
        .sort({ [sortField]: sortOrder })
        .skip(skip)
        .limit(limit)
        .select('-password -passwordResetToken -passwordResetExpires -emailVerificationToken -refreshToken')
        .lean(),
      User.countDocuments(filter),
    ]);

    return sendPaginated(res, { data: users, total, page, limit, message: 'Users fetched.' });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   GET /admin/users/:id
   Admin — single user with order history
───────────────────────────────────────────────────────── */
exports.getUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password -passwordResetToken -passwordResetExpires -emailVerificationToken -refreshToken');

    if (!user) return next(new AppError('User not found.', 404));

    // Fetch user's order summary
    const [orders, orderStats] = await Promise.all([
      Order.find({ user: user._id })
        .sort({ createdAt: -1 })
        .limit(10)
        .select('orderNumber totalAmount orderStatus paymentStatus createdAt')
        .lean(),
      Order.aggregate([
        { $match: { user: user._id, paymentStatus: 'paid' } },
        { $group: {
          _id:   null,
          total: { $sum: '$totalAmount' },
          count: { $sum: 1 },
          avg:   { $avg: '$totalAmount' },
        }},
      ]),
    ]);

    const stats = orderStats[0] || { total: 0, count: 0, avg: 0 };

    return sendSuccess(res, {
      message: 'User fetched.',
      data: {
        user,
        orders,
        orderStats: {
          totalSpent:  stats.total,
          orderCount:  stats.count,
          avgOrderVal: Math.round(stats.avg),
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   PUT /admin/users/:id
   Admin — update user role or active status
───────────────────────────────────────────────────────── */
exports.updateUser = async (req, res, next) => {
  try {
    const { role, isActive, isEmailVerified } = req.body;

    // Prevent admin from demoting themselves
    if (req.params.id === req.user._id.toString() && role && role !== 'admin') {
      return next(new AppError('You cannot change your own role.', 403));
    }

    const allowedUpdates = {};
    if (role             !== undefined) allowedUpdates.role             = role;
    if (isActive         !== undefined) allowedUpdates.isActive         = isActive;
    if (isEmailVerified  !== undefined) allowedUpdates.isEmailVerified  = isEmailVerified;

    if (Object.keys(allowedUpdates).length === 0) {
      return next(new AppError('No valid fields to update.', 400));
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      allowedUpdates,
      { new: true, runValidators: true }
    ).select('-password -passwordResetToken -emailVerificationToken');

    if (!user) return next(new AppError('User not found.', 404));

    logger.info(`User ${user.email} updated by admin ${req.user._id}: ${JSON.stringify(allowedUpdates)}`);

    return sendSuccess(res, { message: 'User updated.', data: { user } });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   DELETE /admin/users/:id
   Admin — soft delete (deactivate) user
───────────────────────────────────────────────────────── */
exports.deleteUser = async (req, res, next) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return next(new AppError('You cannot delete your own account.', 403));
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );

    if (!user) return next(new AppError('User not found.', 404));

    logger.info(`User deactivated: ${user.email} by admin ${req.user._id}`);

    return sendSuccess(res, { message: 'User deactivated.' });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   GET /admin/reviews
   Admin — all reviews including unapproved
───────────────────────────────────────────────────────── */
exports.getReviews = async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip  = (page - 1) * limit;

    const filter = {};
    if (req.query.isApproved !== undefined) filter.isApproved = req.query.isApproved === 'true';
    if (req.query.product)   filter.product = req.query.product;
    if (req.query.rating)    filter.rating  = parseInt(req.query.rating);

    const [reviews, total] = await Promise.all([
      Review.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('user',    'name email')
        .populate('product', 'name flavor')
        .lean(),
      Review.countDocuments(filter),
    ]);

    return sendPaginated(res, { data: reviews, total, page, limit, message: 'Reviews fetched.' });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   PUT /admin/reviews/:id
   Admin — approve / reject / add note
───────────────────────────────────────────────────────── */
exports.updateReview = async (req, res, next) => {
  try {
    const { isApproved, adminNote } = req.body;

    const review = await Review.findByIdAndUpdate(
      req.params.id,
      { isApproved, adminNote },
      { new: true }
    ).populate('product', 'name');

    if (!review) return next(new AppError('Review not found.', 404));

    // WhatsApp + email notifications when a review is approved — fire-and-forget
    if (isApproved) {
      const fullReview = await Review.findById(review._id)
        .populate('user',    'name email')
        .populate('product', 'name');

      whatsapp.notifyNewReview(fullReview, fullReview?.user?.name)
        .catch(err => logger.error('WhatsApp review notify failed:', err.message));

      sendReviewApprovedEmail(fullReview)
        .catch(err => logger.error('Review approved email failed:', err.message));
    }

    logger.info(
      `Review ${review._id} ${isApproved ? 'approved' : 'rejected'} by admin ${req.user._id}`
    );

    return sendSuccess(res, { message: `Review ${isApproved ? 'approved' : 'rejected'}.`, data: { review } });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   DELETE /admin/reviews/:id
   Admin — permanently delete review
───────────────────────────────────────────────────────── */
exports.deleteReview = async (req, res, next) => {
  try {
    const review = await Review.findByIdAndDelete(req.params.id);
    if (!review) return next(new AppError('Review not found.', 404));

    logger.info(`Review deleted: ${review._id} by admin ${req.user._id}`);

    return sendSuccess(res, { message: 'Review deleted.' });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   GET /admin/analytics/sales
   Admin — sales analytics by period
───────────────────────────────────────────────────────── */
exports.getSalesAnalytics = async (req, res, next) => {
  try {
    const period = req.query.period || '30d';
    const now    = new Date();

    let startDate;
    let groupBy;
    switch (period) {
      case '7d':
        startDate = new Date(now - 7  * 24 * 60 * 60 * 1000);
        groupBy   = { year: { $year: '$createdAt' }, month: { $month: '$createdAt' }, day: { $dayOfMonth: '$createdAt' } };
        break;
      case '30d':
        startDate = new Date(now - 30 * 24 * 60 * 60 * 1000);
        groupBy   = { year: { $year: '$createdAt' }, month: { $month: '$createdAt' }, day: { $dayOfMonth: '$createdAt' } };
        break;
      case '12m':
        startDate = new Date(now.getFullYear() - 1, now.getMonth(), 1);
        groupBy   = { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } };
        break;
      default:
        startDate = new Date(now - 30 * 24 * 60 * 60 * 1000);
        groupBy   = { year: { $year: '$createdAt' }, month: { $month: '$createdAt' }, day: { $dayOfMonth: '$createdAt' } };
    }

    const [salesData, flavorData, topCustomers] = await Promise.all([
      Order.aggregate([
        { $match: { paymentStatus: 'paid', createdAt: { $gte: startDate } } },
        { $group: { _id: groupBy, revenue: { $sum: '$totalAmount' }, orders: { $sum: 1 } } },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
      ]),

      // Sales by flavor
      Order.aggregate([
        { $match: { paymentStatus: 'paid', createdAt: { $gte: startDate } } },
        { $unwind: '$items' },
        { $group: {
          _id:      '$items.flavor',
          units:    { $sum: '$items.quantity' },
          revenue:  { $sum: '$items.subtotal' },
        }},
        { $sort: { units: -1 } },
      ]),

      // Top customers by spend
      Order.aggregate([
        { $match: { paymentStatus: 'paid', createdAt: { $gte: startDate } } },
        { $group: { _id: '$user', totalSpent: { $sum: '$totalAmount' }, orderCount: { $sum: 1 } } },
        { $sort: { totalSpent: -1 } },
        { $limit: 10 },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
        { $project: {
          totalSpent:  1,
          orderCount:  1,
          'user.name':  1,
          'user.email': 1,
        }},
      ]),
    ]);

    return sendSuccess(res, {
      message: 'Sales analytics fetched.',
      data: { period, salesData, flavorData, topCustomers },
    });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   GET /admin/analytics/inventory
   Admin — stock levels and inventory health
───────────────────────────────────────────────────────── */
exports.getInventoryAnalytics = async (req, res, next) => {
  try {
    const [allProducts, outOfStock, lowStock] = await Promise.all([
      Product.find({ active: true })
        .select('name flavor price stock totalSold isFeatured')
        .sort({ stock: 1 })
        .lean(),
      Product.countDocuments({ active: true, stock: 0 }),
      Product.countDocuments({ active: true, stock: { $gt: 0, $lte: 10 } }),
    ]);

    const totalInventoryValue = allProducts.reduce(
      (sum, p) => sum + p.price * p.stock, 0
    );

    return sendSuccess(res, {
      message: 'Inventory analytics fetched.',
      data: {
        products:            allProducts,
        outOfStock,
        lowStock,
        totalInventoryValue,
        totalActiveProducts: allProducts.length,
      },
    });
  } catch (err) {
    next(err);
  }
};
