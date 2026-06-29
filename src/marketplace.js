import { z } from 'zod';
import {
  addComment,
  addFavorite,
  createOffer,
  createProduct,
  createToken,
  createUser,
  deliverOrder,
  followSeller,
  formatProductForApi,
  getBuyerOrderBadges,
  getBuyerOrders,
  getComments,
  getFavoriteProductIds,
  getFollowedSellers,
  getNotifications,
  getOfferHistory,
  getOfferQuota,
  getOrderTracking,
  getPriceInsights,
  getProductById,
  getProductsByIds,
  getReceivedOffers,
  getSellerOrders,
  getSellerPanelStats,
  getSellerProducts,
  getSentOffers,
  getUnreadNotificationCount,
  getUserById,
  getUserIdFromToken,
  listProductsFormatted,
  markAllNotificationsRead,
  markNotificationRead,
  publicUser,
  removeFavorite,
  requestCancel,
  requestReturn,
  respondOffer,
  shipOrder,
  unfollowSeller,
  updateProduct,
  updateUserProfile,
  verifyUser,
} from './store.js';

const RegisterSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(6).max(128),
});

const LoginSchema = RegisterSchema;

const ProductSchema = z.object({
  title: z.string().trim().min(1).max(200),
  price: z.coerce.number().positive().max(1_000_000),
  category: z.string().max(100).optional(),
  brand: z.string().max(100).optional(),
  size: z.string().max(50).optional(),
  fabricType: z.string().max(100).optional(),
  shoeSize: z.string().max(50).optional(),
  gender: z.string().max(50).optional(),
  condition: z.string().max(100).optional(),
  shippingType: z.string().max(50).optional(),
  packageSize: z.string().max(50).optional(),
  color: z.string().max(50).optional(),
  imageUrl: z.string().max(2000).optional(),
  description: z.string().max(4000).optional(),
  isSos: z.boolean().optional(),
  sosDiscountPercent: z.coerce.number().int().min(0).max(99).optional(),
});

const OfferCreateSchema = z.object({
  productId: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive().max(1_000_000),
});

const OfferRespondSchema = z.object({
  action: z.enum(['accept', 'reject', 'counter']),
  counterAmount: z.coerce.number().positive().optional(),
});

function clampInt(value, { min, max, fallback }) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const userId = getUserIdFromToken(token);
  if (!userId) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  req.userId = userId;
  return next();
}

export function registerMarketplaceRoutes(app, cacheApi) {
  const { invalidateFeedCache, feedCacheKey, getCachedFeed, setCachedFeed } = cacheApi;

  const feedHandler = (req, res) => {
    const key = feedCacheKey(req);
    const cached = getCachedFeed(key);
    if (cached) {
      res.setHeader('x-cache', 'hit');
      res.setHeader('cache-control', 'public, max-age=5');
      return res.json(cached);
    }

    const q = String(req.query.q ?? '').trim().toLowerCase();
    const sosOnly = String(req.query.sosOnly ?? '').trim() === '1';
    const smartMode = String(req.query.smartMode ?? '').trim();
    const limit = clampInt(req.query.limit, { min: 1, max: 50, fallback: 20 });
    const cursorRaw = String(req.query.cursor ?? '').trim();
    const start = clampInt(cursorRaw, { min: 0, max: 100000, fallback: 0 });

    const filtered = listProductsFormatted({ q, sosOnly, smartMode });
    const slice = filtered.slice(start, start + limit);
    const nextCursor = start + slice.length;
    const hasMore = nextCursor < filtered.length;

    const payload = {
      success: true,
      products: slice,
      facets: {
        sosOnly: { count: filtered.filter((p) => p.isSos).length },
        total: filtered.length,
      },
      pageInfo: {
        nextCursor: hasMore ? String(nextCursor) : '',
        hasMore,
        total: filtered.length,
      },
      nextCursor: hasMore ? String(nextCursor) : '',
      hasMore,
      total: filtered.length,
    };

    setCachedFeed(key, payload);
    res.setHeader('x-cache', 'miss');
    res.setHeader('cache-control', 'public, max-age=5');
    return res.json(payload);
  };

  app.post('/api/register', (req, res) => {
    const parsed = RegisterSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: 'Geçersiz kayıt bilgisi' });
    }
    const result = createUser(parsed.data);
    if (!result.ok) {
      return res.status(400).json({ success: false, message: result.message });
    }
    return res.json({ success: true, message: 'Kayıt başarılı' });
  });

  app.post('/api/login', (req, res) => {
    const parsed = LoginSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: 'Geçersiz giriş bilgisi' });
    }
    const result = verifyUser(parsed.data);
    if (!result.ok) {
      return res.status(401).json({ success: false, message: result.message });
    }
    const token = createToken(result.user.id);
    return res.json({
      success: true,
      token,
      user: publicUser(result.user),
    });
  });

  app.get('/api/auth/verify', authMiddleware, (req, res) => {
    const user = getUserById(req.userId);
    if (!user) return res.status(401).json({ success: false });
    return res.json({ success: true, user: publicUser(user) });
  });

  app.get('/api/profile', authMiddleware, (req, res) => {
    const user = getUserById(req.userId);
    if (!user) return res.status(401).json({ success: false });
    const showcase = getSellerProducts(req.userId).slice(0, 12);
    return res.json({ success: true, user: publicUser(user), showcase });
  });

  app.put('/api/profile', authMiddleware, (req, res) => {
    const user = updateUserProfile(req.userId, {
      name: req.body?.name,
      bio: req.body?.bio,
    });
    if (!user) return res.status(404).json({ success: false, message: 'Kullanıcı bulunamadı' });
    return res.json({ success: true, user: publicUser(user) });
  });

  app.get('/api/products/price-insights', (req, res) => {
    const insights = getPriceInsights({
      title: req.query.title,
      category: req.query.category,
      brand: req.query.brand,
    });
    return res.json(insights);
  });

  app.get('/api/products/recommended', authMiddleware, (_req, res) => {
    const products = listProductsFormatted({}).slice(0, 10);
    res.json({ success: true, products });
  });

  app.get('/api/products/feed', feedHandler);
  app.get('/api/products', feedHandler);

  app.post('/api/products', authMiddleware, (req, res) => {
    const parsed = ProductSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: 'Geçersiz ürün bilgisi' });
    }
    const product = formatProductForApi(createProduct(req.userId, parsed.data));
    invalidateFeedCache();
    return res.json({
      success: true,
      message: 'Ürün eklendi',
      product,
    });
  });

  app.get('/api/favorites', authMiddleware, (req, res) => {
    const ids = getFavoriteProductIds(req.userId);
    const products = getProductsByIds(ids).map(formatProductForApi);
    return res.json({ success: true, products });
  });

  app.post('/api/favorites/:productId', authMiddleware, (req, res) => {
    const productId = Number(req.params.productId);
    if (!Number.isFinite(productId)) {
      return res.status(400).json({ success: false, message: 'Geçersiz ürün' });
    }
    addFavorite(req.userId, productId);
    return res.json({ success: true, message: 'Favorilere eklendi' });
  });

  app.delete('/api/favorites/:productId', authMiddleware, (req, res) => {
    const productId = Number(req.params.productId);
    if (!Number.isFinite(productId)) {
      return res.status(400).json({ success: false, message: 'Geçersiz ürün' });
    }
    removeFavorite(req.userId, productId);
    return res.json({ success: true, message: 'Favorilerden çıkarıldı' });
  });

  app.get('/api/follows', authMiddleware, (req, res) => {
    res.json({ success: true, sellers: getFollowedSellers(req.userId) });
  });

  app.post('/api/follows/:sellerId', authMiddleware, (req, res) => {
    const sellerId = Number(req.params.sellerId);
    if (!Number.isFinite(sellerId)) {
      return res.status(400).json({ success: false, message: 'Geçersiz satıcı' });
    }
    const result = followSeller(req.userId, sellerId);
    if (!result.ok) return res.status(400).json({ success: false, message: result.message });
    return res.json({ success: true, message: result.message });
  });

  app.delete('/api/follows/:sellerId', authMiddleware, (req, res) => {
    const sellerId = Number(req.params.sellerId);
    if (!Number.isFinite(sellerId)) {
      return res.status(400).json({ success: false, message: 'Geçersiz satıcı' });
    }
    const result = unfollowSeller(req.userId, sellerId);
    return res.json({ success: true, message: result.message });
  });

  app.get('/api/offers/quota', authMiddleware, (req, res) => {
    const quota = getOfferQuota(req.userId);
    res.json({ success: true, ...quota });
  });

  app.post('/api/offers', authMiddleware, (req, res) => {
    const parsed = OfferCreateSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: 'Geçersiz teklif' });
    }
    const result = createOffer(req.userId, parsed.data);
    if (!result.ok) return res.status(400).json({ success: false, message: result.message });
    return res.json({ success: true, message: result.message, offer: result.offer });
  });

  app.get('/api/offers/sent', authMiddleware, (req, res) => {
    res.json({ success: true, offers: getSentOffers(req.userId) });
  });

  app.get('/api/offers/received', authMiddleware, (req, res) => {
    res.json({ success: true, offers: getReceivedOffers(req.userId) });
  });

  app.post('/api/offers/:offerId/respond', authMiddleware, (req, res) => {
    const offerId = Number(req.params.offerId);
    const parsed = OfferRespondSchema.safeParse(req.body || {});
    if (!Number.isFinite(offerId) || !parsed.success) {
      return res.status(400).json({ success: false, message: 'Geçersiz istek' });
    }
    const result = respondOffer(req.userId, offerId, parsed.data);
    if (!result.ok) return res.status(400).json({ success: false, message: result.message });
    return res.json({ success: true, message: result.message });
  });

  app.get('/api/offers/:offerId/history', authMiddleware, (req, res) => {
    const offerId = Number(req.params.offerId);
    if (!Number.isFinite(offerId)) {
      return res.status(400).json({ success: false, message: 'Geçersiz teklif' });
    }
    const events = getOfferHistory(offerId, req.userId);
    if (!events) return res.status(404).json({ success: false, message: 'Teklif bulunamadı' });
    return res.json({ success: true, events });
  });

  app.get('/api/notifications', authMiddleware, (req, res) => {
    res.json({ success: true, notifications: getNotifications(req.userId) });
  });

  app.get('/api/notifications/unread-count', authMiddleware, (req, res) => {
    res.json({ success: true, unreadCount: getUnreadNotificationCount(req.userId) });
  });

  app.post('/api/notifications/:notificationId/read', authMiddleware, (req, res) => {
    const notificationId = Number(req.params.notificationId);
    if (!markNotificationRead(req.userId, notificationId)) {
      return res.status(404).json({ success: false, message: 'Bildirim bulunamadı' });
    }
    return res.json({ success: true });
  });

  app.post('/api/notifications/read-all', authMiddleware, (req, res) => {
    markAllNotificationsRead(req.userId);
    return res.json({ success: true });
  });

  app.get('/api/buyer/orders', authMiddleware, (req, res) => {
    res.json({ success: true, orders: getBuyerOrders(req.userId) });
  });

  app.get('/api/buyer/orders/badges', authMiddleware, (req, res) => {
    res.json({ success: true, badges: getBuyerOrderBadges(req.userId) });
  });

  app.post('/api/buyer/orders/:orderId/cancel-request', authMiddleware, (req, res) => {
    const orderId = Number(req.params.orderId);
    const result = requestCancel(req.userId, orderId);
    if (!result.ok) return res.status(404).json({ success: false, message: result.message });
    return res.json({ success: true, message: result.message });
  });

  app.post('/api/buyer/orders/:orderId/return-request', authMiddleware, (req, res) => {
    const orderId = Number(req.params.orderId);
    const result = requestReturn(req.userId, orderId);
    if (!result.ok) return res.status(404).json({ success: false, message: result.message });
    return res.json({ success: true, message: result.message });
  });

  app.get('/api/orders/:orderId/tracking', authMiddleware, (req, res) => {
    const orderId = Number(req.params.orderId);
    const tracking = getOrderTracking(orderId, req.userId);
    if (!tracking) return res.status(404).json({ success: false, message: 'Sipariş bulunamadı' });
    return res.json({ success: true, ...tracking });
  });

  app.get('/api/seller/panel', authMiddleware, (req, res) => {
    const panel = getSellerPanelStats(req.userId);
    res.json({ success: true, ...panel });
  });

  app.get('/api/seller/products', authMiddleware, (req, res) => {
    res.json({ success: true, products: getSellerProducts(req.userId) });
  });

  app.put('/api/seller/products/:productId', authMiddleware, (req, res) => {
    const productId = Number(req.params.productId);
    const product = updateProduct(req.userId, productId, {
      title: req.body?.title,
      description: req.body?.description,
      price: req.body?.price,
      shippingType: req.body?.shippingType,
      packageSize: req.body?.packageSize,
      saleStatus: req.body?.saleStatus,
    });
    if (!product) return res.status(404).json({ success: false, message: 'Ürün bulunamadı' });
    invalidateFeedCache();
    return res.json({ success: true, product: formatProductForApi(product) });
  });

  app.get('/api/seller/orders', authMiddleware, (req, res) => {
    res.json({ success: true, orders: getSellerOrders(req.userId) });
  });

  app.post('/api/seller/orders/:orderId/ship', authMiddleware, (req, res) => {
    const orderId = Number(req.params.orderId);
    const result = shipOrder(req.userId, orderId, {
      trackingNo: req.body?.trackingNo,
      shipmentStatus: req.body?.shipmentStatus,
    });
    if (!result.ok) return res.status(404).json({ success: false, message: result.message });
    return res.json({ success: true, message: result.message });
  });

  app.post('/api/seller/orders/:orderId/deliver', authMiddleware, (req, res) => {
    const orderId = Number(req.params.orderId);
    const result = deliverOrder(req.userId, orderId);
    if (!result.ok) return res.status(404).json({ success: false, message: result.message });
    return res.json({ success: true, message: result.message });
  });

  app.get('/api/products/:productId/comments', (req, res) => {
    const productId = Number(req.params.productId);
    if (!Number.isFinite(productId)) {
      return res.status(400).json({ success: false, message: 'Geçersiz ürün' });
    }
    res.json({ success: true, comments: getComments(productId) });
  });

  app.post('/api/products/:productId/comments', authMiddleware, (req, res) => {
    const productId = Number(req.params.productId);
    if (!Number.isFinite(productId)) {
      return res.status(400).json({ success: false, message: 'Geçersiz ürün' });
    }
    const result = addComment(req.userId, productId, req.body?.content);
    if (!result.ok) return res.status(400).json({ success: false, message: result.message });
    return res.json({ success: true, comment: result.comment });
  });
}
