// Express kütüphanesini projemize dahil ediyoruz (Import / İçe Aktarma)
const express = require('express');

// Şifreleri güvenli şekilde şifrelemek için bcrypt kütüphanesini dahil ediyoruz
const bcrypt = require('bcrypt');

// JWT (JSON Web Token) kütüphanesini dahil ediyoruz — dijital kimlik kartı üretimi için
const jwt = require('jsonwebtoken');

// SQLite veritabanı kütüphanesini dahil ediyoruz
const Database = require('better-sqlite3');

// JWT imzalamak için gizli anahtar (production'da .env dosyasına taşınacak)
const JWT_SECRET = 'dolap_gizli_anahtar_2026';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const createAuthToken = (user) => jwt.sign(
    { id: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: '7d' }
);

// Veritabanı dosyasını oluşturuyor / açıyoruz (dolap.db adında bir dosya oluşacak)
const db = new Database('dolap.db');

// Kullanıcılar tablosunu yoksa oluşturuyoruz
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        email      TEXT    UNIQUE NOT NULL,
        password   TEXT    NOT NULL,
        name       TEXT    DEFAULT '',
        bio        TEXT    DEFAULT '',
        total_sales INTEGER DEFAULT 0,
        seller_rating REAL DEFAULT 0,
        is_star_seller INTEGER DEFAULT 0,
        created_at TEXT    DEFAULT (datetime('now'))
    )
`);

// Ürünler tablosunu yoksa oluşturuyoruz
db.exec(`
    CREATE TABLE IF NOT EXISTS products (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL,
        title       TEXT    NOT NULL,
        price       REAL    NOT NULL,
        category    TEXT    DEFAULT '',
        brand       TEXT    DEFAULT '',
        size        TEXT    DEFAULT '',
        fabric_type TEXT    DEFAULT '',
        shoe_size   TEXT    DEFAULT '',
        gender      TEXT    DEFAULT '',
        item_condition TEXT DEFAULT '',
        shipping_type TEXT DEFAULT 'seller',
        package_size TEXT DEFAULT 'medium',
        color       TEXT    DEFAULT '',
        image_url   TEXT    DEFAULT '',
        description TEXT    DEFAULT '',
        created_at  TEXT    DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
    )
`);

// Teklifler tablosu
db.exec(`
    CREATE TABLE IF NOT EXISTS offers (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        buyer_id   INTEGER NOT NULL,
        seller_id  INTEGER NOT NULL,
        amount     REAL    NOT NULL,
        status     TEXT    DEFAULT 'pending',
        created_at TEXT    DEFAULT (datetime('now')),
        FOREIGN KEY (product_id) REFERENCES products(id),
        FOREIGN KEY (buyer_id) REFERENCES users(id),
        FOREIGN KEY (seller_id) REFERENCES users(id)
    )
`);

// Teklif geçmişi olayları
db.exec(`
    CREATE TABLE IF NOT EXISTS offer_events (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        offer_id   INTEGER NOT NULL,
        actor_id   INTEGER NOT NULL,
        event_type TEXT    NOT NULL,
        amount     REAL,
        note       TEXT    DEFAULT '',
        created_at TEXT    DEFAULT (datetime('now')),
        FOREIGN KEY (offer_id) REFERENCES offers(id),
        FOREIGN KEY (actor_id) REFERENCES users(id)
    )
`);

// Yorumlar tablosu
db.exec(`
    CREATE TABLE IF NOT EXISTS comments (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        user_id    INTEGER NOT NULL,
        content    TEXT    NOT NULL,
        created_at TEXT    DEFAULT (datetime('now')),
        FOREIGN KEY (product_id) REFERENCES products(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
    )
`);

// Favoriler tablosu
db.exec(`
    CREATE TABLE IF NOT EXISTS favorites (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        created_at TEXT    DEFAULT (datetime('now')),
        UNIQUE (user_id, product_id),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (product_id) REFERENCES products(id)
    )
`);

// Takip edilen satıcılar tablosu
db.exec(`
    CREATE TABLE IF NOT EXISTS follows (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL,
        seller_id  INTEGER NOT NULL,
        created_at TEXT    DEFAULT (datetime('now')),
        UNIQUE (user_id, seller_id),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (seller_id) REFERENCES users(id)
    )
`);

// Siparişler tablosu
db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        offer_id         INTEGER,
        product_id       INTEGER NOT NULL,
        buyer_id         INTEGER NOT NULL,
        seller_id        INTEGER NOT NULL,
        amount           REAL    NOT NULL,
        shipping_type    TEXT    DEFAULT 'seller',
        package_size     TEXT    DEFAULT 'medium',
        order_status     TEXT    DEFAULT 'created',
        tracking_no      TEXT    DEFAULT '',
        cancel_requested INTEGER DEFAULT 0,
        return_requested INTEGER DEFAULT 0,
        created_at       TEXT    DEFAULT (datetime('now')),
        FOREIGN KEY (offer_id) REFERENCES offers(id),
        FOREIGN KEY (product_id) REFERENCES products(id),
        FOREIGN KEY (buyer_id) REFERENCES users(id),
        FOREIGN KEY (seller_id) REFERENCES users(id)
    )
`);

// Sipariş takip olayları
db.exec(`
    CREATE TABLE IF NOT EXISTS order_events (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id   INTEGER NOT NULL,
        actor_id   INTEGER NOT NULL,
        event_type TEXT    NOT NULL,
        note       TEXT    DEFAULT '',
        created_at TEXT    DEFAULT (datetime('now')),
        FOREIGN KEY (order_id) REFERENCES orders(id),
        FOREIGN KEY (actor_id) REFERENCES users(id)
    )
`);

// Bildirimler
db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL,
        type       TEXT    NOT NULL,
        title      TEXT    NOT NULL,
        message    TEXT    NOT NULL,
        data_json  TEXT    DEFAULT '{}',
        is_read    INTEGER DEFAULT 0,
        created_at TEXT    DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
    )
`);

db.exec('CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_id, id DESC)');
db.exec('CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders(seller_id, id DESC)');
db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, id DESC)');

// Var olan veritabanları için sütun migration yardımcıları
const ensureColumn = (tableName, columnName, definition) => {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all().map((c) => c.name);
    if (!columns.includes(columnName)) {
        db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
    }
};

ensureColumn('users', 'total_sales', 'total_sales INTEGER DEFAULT 0');
ensureColumn('users', 'seller_rating', 'seller_rating REAL DEFAULT 0');
ensureColumn('users', 'is_star_seller', 'is_star_seller INTEGER DEFAULT 0');
ensureColumn('users', 'is_verified', 'is_verified INTEGER DEFAULT 0');

ensureColumn('products', 'brand', "brand TEXT DEFAULT ''");
ensureColumn('products', 'size', "size TEXT DEFAULT ''");
ensureColumn('products', 'fabric_type', "fabric_type TEXT DEFAULT ''");
ensureColumn('products', 'shoe_size', "shoe_size TEXT DEFAULT ''");
ensureColumn('products', 'gender', "gender TEXT DEFAULT ''");
ensureColumn('products', 'item_condition', "item_condition TEXT DEFAULT ''");
ensureColumn('products', 'shipping_type', "shipping_type TEXT DEFAULT 'seller'");
ensureColumn('products', 'package_size', "package_size TEXT DEFAULT 'medium'");
ensureColumn('products', 'color', "color TEXT DEFAULT ''");
ensureColumn('products', 'is_sos', 'is_sos INTEGER DEFAULT 0');
ensureColumn('products', 'sos_discount_percent', 'sos_discount_percent INTEGER DEFAULT 0');
ensureColumn('products', 'sale_status', "sale_status TEXT DEFAULT 'available'");

ensureColumn('offers', 'order_id', 'order_id INTEGER');

console.log('Veritabanı bağlantısı kuruldu ve tablo hazır.');

// Express uygulamasını başlatıyoruz
const app = express();

// Sunucunun çalışacağı kapı numarasını (Port) belirliyoruz
const PORT = 3000;

// Sunucunun gelen JSON formatındaki paketleri (verileri) okumasını sağlar
app.use(express.json());

const supportIntents = [
    {
        intent: 'cargo_tracking',
        patterns: [/kargo/, /teslimat/, /nerede/, /takip/, /siparişim nerede/],
        answer: 'Kargonuzu uygulamada Profil > Siparişlerim > Takip adımından izleyebilirsiniz. Takip numaranız varsa bu alana girerek anlık kargo durumunu görebilirsiniz. 48 saatten uzun süredir hareket yoksa canlı desteğe bağlanın.'
    },
    {
        intent: 'return_process',
        patterns: [/iade/, /geri gönder/, /ürünü geri/, /cayma/],
        answer: 'İade için Profil > Siparişlerim > Sipariş Detayı > İade Talebi adımını kullanın. Ürün tesliminden sonra 14 gün içinde iade talebi oluşturabilirsiniz. Talep onaylandıktan sonra kargo kodu verilir ve ücret iade incelemesinden sonra hesabınıza yansır.'
    },
    {
        intent: 'cancel_process',
        patterns: [/iptal/, /vazgeç/, /siparişimi iptal/, /alımı iptal/],
        answer: 'Sipariş henüz kargoya verilmediyse Sipariş Detayı ekranından iptal talebi oluşturabilirsiniz. Kargoya verildiyse doğrudan iptal yerine iade süreci uygulanır. Satıcı 24 saat içinde onay vermezse talep otomatik değerlendirmeye alınır.'
    },
    {
        intent: 'customer_service',
        patterns: [/müşteri hizmet/, /canlı destek/, /destek/, /yardım/, /şikayet/],
        answer: 'Müşteri hizmetlerine Profil > Yardım Merkezi > Canlı Destek üzerinden ulaşabilirsiniz. Hızlı çözüm için sipariş numarası, ürün adı ve yaşadığınız sorunu kısa maddelerle paylaşın.'
    }
];

const detectSupportIntent = (message) => {
    const text = String(message || '').toLowerCase();
    for (const item of supportIntents) {
        if (item.patterns.some((pattern) => pattern.test(text))) {
            return item;
        }
    }
    return null;
};

const normalizeOrderNo = (orderNo) => {
    const normalized = String(orderNo || '').trim().slice(0, 32);
    return normalized || null;
};

const DAILY_OFFER_LIMIT = 20;

const getTodayOfferUsage = (userId) => {
    const row = db.prepare(`
        SELECT COUNT(*) AS total
        FROM offers
        WHERE buyer_id = ?
          AND date(created_at) = date('now')
    `).get(userId);

    return Number(row?.total || 0);
};

const addOfferEvent = (offerId, actorId, eventType, amount = null, note = '') => {
    db.prepare(`
        INSERT INTO offer_events (offer_id, actor_id, event_type, amount, note)
        VALUES (?, ?, ?, ?, ?)
    `).run(offerId, actorId, eventType, amount, note);
};

const addOrderEvent = (orderId, actorId, eventType, note = '') => {
    db.prepare(`
        INSERT INTO order_events (order_id, actor_id, event_type, note)
        VALUES (?, ?, ?, ?)
    `).run(orderId, actorId, eventType, note);
};

const notifyUser = (userId, type, title, message, data = {}) => {
    db.prepare(`
        INSERT INTO notifications (user_id, type, title, message, data_json)
        VALUES (?, ?, ?, ?, ?)
    `).run(userId, type, title, message, JSON.stringify(data || {}));
};

const getFallbackSupportReply = (message, orderNo = null) => {
    const matchedIntent = detectSupportIntent(message);
    if (matchedIntent) {
        if (matchedIntent.intent === 'cargo_tracking' && orderNo) {
            return {
                intent: matchedIntent.intent,
                reply: `Sipariş no ${orderNo} için kargo takibini Profil > Siparişlerim > Sipariş Detayı > Takip alanından kontrol edebilirsiniz. Durum 48 saatten uzun süredir güncellenmiyorsa canlı desteğe bağlanmanızı öneririm.`
            };
        }

        if ((matchedIntent.intent === 'return_process' || matchedIntent.intent === 'cancel_process') && orderNo) {
            return {
                intent: matchedIntent.intent,
                reply: `Sipariş no ${orderNo} için işlem başlatmak üzere Profil > Siparişlerim > Sipariş Detayı ekranına gidin. Kargoya verilmediyse iptal, verildiyse iade talebi oluşturabilirsiniz.`
            };
        }

        return {
            intent: matchedIntent.intent,
            reply: matchedIntent.answer
        };
    }

    return {
        intent: 'general',
        reply: 'Size yardımcı olabilirim. Özellikle "kargom nerede", "iade", "iptal" veya "müşteri hizmetleri" konularından birini yazarsanız adım adım yönlendireyim.'
    };
};

const getOpenAISupportReply = async (message, history = [], orderNo = null) => {
    if (!OPENAI_API_KEY || typeof fetch !== 'function') {
        return null;
    }

    const safeHistory = Array.isArray(history)
        ? history
            .slice(-10)
            .map((h) => ({
                role: h.role === 'assistant' ? 'assistant' : 'user',
                text: String(h.text || '').slice(0, 500)
            }))
            .filter((h) => h.text)
        : [];

    const systemPrompt = `Sen Vitrin uygulamasının destek asistanısın.\nTürkçe, net, kısa ve aksiyon odaklı yanıt ver.\nÖncelik: kargo takibi, iade, iptal, müşteri hizmetleri.\nUydurma bilgi verme; emin değilsen kullanıcıyı yardım merkezine yönlendir.\nKullanıcı sipariş numarası verdiyse cevapta bunu kullanarak kişiselleştirilmiş adım ver.`;

    const input = [
        {
            role: 'system',
            content: [{ type: 'input_text', text: systemPrompt }]
        },
        ...safeHistory.map((h) => ({
            role: h.role,
            content: [{ type: 'input_text', text: h.text }]
        })),
        {
            role: 'user',
            content: [{ type: 'input_text', text: String(message || '').slice(0, 1000) }]
        },
        ...(orderNo
            ? [{
                role: 'user',
                content: [{ type: 'input_text', text: `Kullanıcının sipariş numarası: ${orderNo}` }]
            }]
            : [])
    ];

    try {
        const response = await fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: OPENAI_MODEL,
                input,
                temperature: 0.3,
                max_output_tokens: 220
            })
        });

        if (!response.ok) {
            return null;
        }

        const data = await response.json();
        const reply = data?.output_text?.trim();
        if (!reply) {
            return null;
        }

        return reply;
    } catch (err) {
        return null;
    }
};

// Ana sayfaya (/) bir istek (Request) geldiğinde çalışacak test rotası (Route)
app.get('/', (req, res) => {
    res.send('Dolap Uygulaması Sunucusu Canlı ve Çalışıyor!');
});

// Kullanıcı Kayıt Kapısı (Register Endpoint)
app.post('/api/register', async (req, res) => {
    // 1. Flutter'dan gelen paketin içinden email ve password'ü çıkartıyoruz
    const { email, password } = req.body;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // 2. Basit bir kontrol: Email veya şifre boş gönderilmiş mi?
    if (!email || !password) {
        return res.status(400).json({
            success: false,
            message: 'Lütfen e-posta ve şifre alanlarını doldurun!'
        });
    }

    // 3. Basit bir kontrol: E-posta formatı geçerli mi?
    if (!emailRegex.test(email)) {
        return res.status(400).json({
            success: false,
            message: 'Lütfen geçerli bir e-posta adresi girin!'
        });
    }

    // 4. Basit bir kontrol: Şifre en az 6 karakter olmalı
    if (password.length < 6) {
        return res.status(400).json({
            success: false,
            message: 'Şifre en az 6 karakter olmalıdır!'
        });
    }

    // 5. Şifreyi bcrypt ile güvenli bir şekilde şifreliyoruz
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // 6. Kullanıcıyı veritabanına kaydediyoruz
    let createdUser;
    try {
        const stmt = db.prepare('INSERT INTO users (email, password) VALUES (?, ?)');
        const result = stmt.run(email, hashedPassword);
        createdUser = { id: Number(result.lastInsertRowid), email };
        console.log(`Yeni kullanıcı kaydedildi — ID: ${result.lastInsertRowid}, E-posta: ${email}`);
    } catch (err) {
        // Aynı e-posta zaten kayıtlıysa hata dönüyoruz
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({
                success: false,
                message: 'Bu e-posta adresi zaten kayıtlı!'
            });
        }
        throw err; // Beklenmedik hatalarda yukarı fırlat
    }

    // 7. Flutter'a kayıt başarılı mesajı ve gerçek JWT token dönüyoruz
    const token = createAuthToken(createdUser);

    res.status(201).json({
        success: true,
        message: 'Kullanıcı başarıyla kaydedildi.',
        token,
        user: createdUser
    });
});

// Kullanıcı Giriş Kapısı (Login Endpoint)
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    // 1. Boş alan kontrolü
    if (!email || !password) {
        return res.status(400).json({
            success: false,
            message: 'Lütfen e-posta ve şifre alanlarını doldurun!'
        });
    }

    // 2. Kullanıcıyı veritabanında ara
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
        return res.status(401).json({
            success: false,
            message: 'E-posta veya şifre hatalı!'
        });
    }

    // 3. Gelen şifreyi veritabanındaki hash ile karşılaştır
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
        return res.status(401).json({
            success: false,
            message: 'E-posta veya şifre hatalı!'
        });
    }

    // 4. Kimlik doğrulama başarılı — JWT token üret (7 gün geçerli)
    const token = createAuthToken(user);

    console.log(`Kullanıcı giriş yaptı: ${email}`);

    // 5. Flutter'a token ve kullanıcı bilgisini dön
    res.status(200).json({
        success: true,
        message: 'Giriş başarılı!',
        token,
        user: {
            id: user.id,
            email: user.email
        }
    });
});

// ─── Kimlik Doğrulama Middleware'i (Auth Middleware) ───────────────────────
// Korumalı endpoint'lere gelmeden önce token'ı kontrol eder
const authenticate = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const hasBearer = typeof authHeader === 'string' && authHeader.startsWith('Bearer ');
    const token = hasBearer ? authHeader.slice(7).trim() : null;

    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Bu işlem için giriş yapman gerekiyor!'
        });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded; // Kullanıcı bilgisini isteğe ekliyoruz
        next();
    } catch (err) {
        return res.status(401).json({
            success: false,
            message: 'Geçersiz veya süresi dolmuş token!'
        });
    }
};

// Jeton doğrulama (Splash sırasında kullanılacak)
app.get('/api/auth/verify', authenticate, (req, res) => {
    const user = db.prepare(
        'SELECT id, email, name, created_at FROM users WHERE id = ?'
    ).get(req.user.id);

    if (!user) {
        return res.status(401).json({ success: false, message: 'Kullanıcı bulunamadı.' });
    }

    return res.status(200).json({ success: true, user });
});

// ─── Profil Endpoint'leri ────────────────────────────────────────────────────

// Profil Görüntüleme (GET)
app.get('/api/profile', authenticate, (req, res) => {
    const user = db.prepare(
        'SELECT id, email, name, bio, created_at, total_sales, seller_rating, is_star_seller, is_verified FROM users WHERE id = ?'
    ).get(req.user.id);

    if (!user) {
        return res.status(404).json({ success: false, message: 'Kullanıcı bulunamadı!' });
    }

    const showcase = db.prepare(
        `SELECT id, title, price, image_url, created_at
         FROM products
         WHERE user_id = ?
         ORDER BY datetime(created_at) DESC`
    ).all(req.user.id);

    res.status(200).json({ success: true, user, showcase });
});

// Profil Güncelleme (PUT)
app.put('/api/profile', authenticate, (req, res) => {
    const { name, bio } = req.body;

    if (name !== undefined && name.length > 50) {
        return res.status(400).json({
            success: false,
            message: 'İsim en fazla 50 karakter olabilir!'
        });
    }

    db.prepare(
        'UPDATE users SET name = COALESCE(?, name), bio = COALESCE(?, bio) WHERE id = ?'
    ).run(
        name ?? null,
        bio ?? null,
        req.user.id
    );

    const updated = db.prepare(
        'SELECT id, email, name, bio, created_at, total_sales, seller_rating, is_star_seller, is_verified FROM users WHERE id = ?'
    ).get(req.user.id);

    console.log(`Profil güncellendi — ID: ${req.user.id}`);
    res.status(200).json({ success: true, message: 'Profil güncellendi!', user: updated });
});

// ─── Ürün Endpoint'leri ─────────────────────────────────────────────────────

// Ürün Listeleme (Herkese Açık)
app.get('/api/products', (req, res) => {
    const {
        q,
        category,
        brand,
        size,
        fabricType,
        shoeSize,
        gender,
        condition,
        shippingType,
        packageSize,
        descriptionQuery,
        color,
        minPrice,
        maxPrice,
        bestSellers,
        starSellers,
        smartMode,
        smartTags,
        sosOnly,
        limit,
        offset
    } = req.query;

    const where = [];
    const params = {};

    // SOS modu filtresi: Son 24 saat içindeki ürünler
    if (sosOnly === '1' || sosOnly === 'true') {
        where.push('p.is_sos = 1');
        where.push("datetime(p.created_at) > datetime('now', '-1 day')");
    }

    if (q) {
        where.push(`(
            LOWER(p.title) LIKE @q OR
            LOWER(p.description) LIKE @q OR
            LOWER(p.category) LIKE @q OR
            LOWER(p.brand) LIKE @q OR
            LOWER(p.color) LIKE @q
        )`);
        params.q = `%${String(q).toLowerCase()}%`;
    }

    if (category) {
        where.push('LOWER(p.category) = @category');
        params.category = String(category).toLowerCase();
    }
    if (brand) {
        where.push('LOWER(p.brand) = @brand');
        params.brand = String(brand).toLowerCase();
    }
    if (size) {
        where.push('LOWER(p.size) = @size');
        params.size = String(size).toLowerCase();
    }
    if (fabricType) {
        where.push('LOWER(p.fabric_type) = @fabricType');
        params.fabricType = String(fabricType).toLowerCase();
    }
    if (shoeSize) {
        where.push('LOWER(p.shoe_size) = @shoeSize');
        params.shoeSize = String(shoeSize).toLowerCase();
    }
    if (gender) {
        where.push('LOWER(p.gender) = @gender');
        params.gender = String(gender).toLowerCase();
    }
    if (condition) {
        where.push('LOWER(p.item_condition) = @condition');
        params.condition = String(condition).toLowerCase();
    }
    if (shippingType) {
        where.push('LOWER(p.shipping_type) = @shippingType');
        params.shippingType = String(shippingType).toLowerCase();
    }
    if (packageSize) {
        where.push('LOWER(p.package_size) = @packageSize');
        params.packageSize = String(packageSize).toLowerCase();
    }
    if (color) {
        where.push('LOWER(p.color) = @color');
        params.color = String(color).toLowerCase();
    }
    if (descriptionQuery) {
        where.push('LOWER(p.description) LIKE @descriptionQuery');
        params.descriptionQuery = `%${String(descriptionQuery).toLowerCase()}%`;
    }

    if (minPrice !== undefined) {
        const parsed = Number(minPrice);
        if (!Number.isNaN(parsed)) {
            where.push('p.price >= @minPrice');
            params.minPrice = parsed;
        }
    }
    if (maxPrice !== undefined) {
        const parsed = Number(maxPrice);
        if (!Number.isNaN(parsed)) {
            where.push('p.price <= @maxPrice');
            params.maxPrice = parsed;
        }
    }

    if (bestSellers === '1' || bestSellers === 'true') {
        where.push('u.total_sales >= 20');
    }
    if (starSellers === '1' || starSellers === 'true') {
        where.push('u.is_star_seller = 1');
    }

    const parsedLimit = Math.min(Math.max(Number(limit) || 80, 1), 200);
    const parsedOffset = Math.max(Number(offset) || 0, 0);
    params.limit = parsedLimit;
    params.offset = parsedOffset;

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const products = db.prepare(`
        SELECT
            p.id,
            p.title,
            p.price,
            p.category,
            p.brand,
            p.size,
            p.fabric_type,
            p.shoe_size,
            p.gender,
            p.item_condition,
            p.shipping_type,
            p.package_size,
            p.color,
            p.image_url,
            p.description,
            p.created_at,
            u.id AS seller_id,
            COALESCE(u.name, '') AS seller_name,
            COALESCE(u.total_sales, 0) AS seller_total_sales,
            COALESCE(u.seller_rating, 0) AS seller_rating,
            COALESCE(u.is_star_seller, 0) AS is_star_seller
        FROM products p
        JOIN users u ON u.id = p.user_id
        ${whereSql}
        ORDER BY p.id DESC
        LIMIT @limit OFFSET @offset
    `).all(params);

    // Bizi ayrıştıran hızlı bulma: Akıllı puanlama (smartMode)
    const queryText = String(q || '').toLowerCase().trim();
    const tags = String(smartTags || '')
        .toLowerCase()
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
    const smartEnabled = smartMode === '1' || smartMode === 'true';

    const scored = products.map((p) => {
        let score = 0;
        const bag = `${p.title} ${p.description} ${p.category} ${p.brand} ${p.color} ${p.fabric_type} ${p.gender}`.toLowerCase();

        if (queryText) {
            if (String(p.title).toLowerCase().includes(queryText)) score += 40;
            if (String(p.brand).toLowerCase().includes(queryText)) score += 25;
            if (String(p.description).toLowerCase().includes(queryText)) score += 15;
        }

        for (const tag of tags) {
            if (bag.includes(tag)) score += 12;
        }

        // SOS Modu Boost: Acil satıcılar için özel boost!
        if (Number(p.is_sos) === 1) score += 50;

        if (Number(p.is_star_seller) === 1) score += 10;
        if (Number(p.seller_total_sales) >= 20) score += 8;
        if (Number(p.seller_rating) >= 4.5) score += 6;

        return { ...p, quick_score: score };
    });

    if (smartEnabled || queryText || tags.length) {
        scored.sort((a, b) => b.quick_score - a.quick_score || b.id - a.id);
    }

    // Facet'ler: Kullanıcı tek dokunuşla daha hızlı daraltsın
    const topCount = (items, field, max = 8) => {
        const map = new Map();
        for (const item of items) {
            const val = String(item[field] || '').trim();
            if (!val) continue;
            map.set(val, (map.get(val) || 0) + 1);
        }
        return [...map.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, max)
            .map(([value, count]) => ({ value, count }));
    };

    const facets = {
        brands: topCount(scored, 'brand'),
        colors: topCount(scored, 'color'),
        sizes: topCount(scored, 'size'),
        fabrics: topCount(scored, 'fabric_type'),
        genders: topCount(scored, 'gender'),
        conditions: topCount(scored, 'item_condition')
    };

    res.status(200).json({ success: true, products: scored, facets });
});

// Ürün Ekleme (Giriş Gerekli)
app.post('/api/products', authenticate, (req, res) => {
    const {
        title,
        price,
        category,
        brand,
        size,
        fabricType,
        shoeSize,
        gender,
        condition,
        shippingType,
        packageSize,
        color,
        imageUrl,
        description,
        isSos,
        sosDiscountPercent
    } = req.body;

    if (!title || price === undefined || price === null) {
        return res.status(400).json({
            success: false,
            message: 'Ürün başlığı ve fiyat zorunludur!'
        });
    }

    const parsedPrice = Number(price);
    if (Number.isNaN(parsedPrice) || parsedPrice <= 0) {
        return res.status(400).json({
            success: false,
            message: 'Fiyat geçerli bir sayı olmalıdır!'
        });
    }

    // SOS modu validasyonu
    let isSosMode = isSos ? 1 : 0;
    let discountPercent = 0;
    if (isSosMode) {
        const discount = Number(sosDiscountPercent);
        if (Number.isNaN(discount) || discount < 0 || discount > 99) {
            return res.status(400).json({
                success: false,
                message: 'SOS indirim yüzdesı 0-99 arasında olmalıdır!'
            });
        }
        discountPercent = Math.floor(discount);
    }

    const result = db.prepare(`
        INSERT INTO products (
            user_id, title, price, category, brand, size, fabric_type,
            shoe_size, gender, item_condition, shipping_type, package_size, color,
            image_url, description, is_sos, sos_discount_percent
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        req.user.id,
        String(title).trim(),
        parsedPrice,
        category ? String(category).trim() : '',
        brand ? String(brand).trim() : '',
        size ? String(size).trim() : '',
        fabricType ? String(fabricType).trim() : '',
        shoeSize ? String(shoeSize).trim() : '',
        gender ? String(gender).trim() : '',
        condition ? String(condition).trim() : '',
        shippingType ? String(shippingType).trim() : 'seller',
        packageSize ? String(packageSize).trim() : 'medium',
        color ? String(color).trim() : '',
        imageUrl ? String(imageUrl).trim() : '',
        description ? String(description).trim() : '',
        isSosMode,
        discountPercent
    );

    const createdProduct = db.prepare(`
        SELECT
            id, title, price, category, brand, size, fabric_type, shoe_size,
            gender, item_condition, shipping_type, package_size, color, image_url, description,
            is_sos, sos_discount_percent, created_at
        FROM products
        WHERE id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json({
        success: true,
        message: 'Ürün başarıyla eklendi.',
        product: createdProduct
    });
});

app.get('/api/products/price-insights', (req, res) => {
    const category = String(req.query.category || '').trim();
    const brand = String(req.query.brand || '').trim();
    const title = String(req.query.title || '').trim();

    const where = [];
    const params = {};

    if (category) {
        where.push('LOWER(category) = @category');
        params.category = category.toLowerCase();
    }
    if (brand) {
        where.push('LOWER(brand) = @brand');
        params.brand = brand.toLowerCase();
    }

    const titleTokens = title
        .toLowerCase()
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 3)
        .slice(0, 3);

    titleTokens.forEach((token, i) => {
        where.push(`LOWER(title) LIKE @titleToken${i}`);
        params[`titleToken${i}`] = `%${token}%`;
    });

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const products = db.prepare(`
        SELECT id, title, price, category, brand, created_at
        FROM products
        ${whereSql}
        ORDER BY id DESC
        LIMIT 30
    `).all(params);

    if (!products.length) {
        return res.status(200).json({
            success: true,
            count: 0,
            avgPrice: null,
            minPrice: null,
            maxPrice: null,
            similarProducts: []
        });
    }

    const prices = products.map((p) => Number(p.price)).filter((p) => !Number.isNaN(p));
    const avgPrice = prices.reduce((sum, v) => sum + v, 0) / prices.length;
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);

    return res.status(200).json({
        success: true,
        count: products.length,
        avgPrice: Number(avgPrice.toFixed(2)),
        minPrice,
        maxPrice,
        similarProducts: products
    });
});

// ─── Teklif Endpoint'leri ──────────────────────────────────────────────────

app.get('/api/offers/quota', authenticate, (req, res) => {
    const used = getTodayOfferUsage(req.user.id);
    const remaining = Math.max(DAILY_OFFER_LIMIT - used, 0);

    return res.status(200).json({
        success: true,
        dailyLimit: DAILY_OFFER_LIMIT,
        used,
        remaining
    });
});

app.post('/api/offers', authenticate, (req, res) => {
    const { productId, amount } = req.body || {};

    const parsedProductId = Number(productId);
    const parsedAmount = Number(amount);

    if (!Number.isInteger(parsedProductId) || parsedProductId <= 0) {
        return res.status(400).json({ success: false, message: 'Geçerli bir ürün seçmelisin.' });
    }

    if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ success: false, message: 'Teklif tutarı geçerli olmalı.' });
    }

    const product = db.prepare('SELECT id, user_id, title, price FROM products WHERE id = ?').get(parsedProductId);
    if (!product) {
        return res.status(404).json({ success: false, message: 'Ürün bulunamadı.' });
    }

    if (Number(product.user_id) === Number(req.user.id)) {
        return res.status(400).json({ success: false, message: 'Kendi ürününe teklif veremezsin.' });
    }

    const used = getTodayOfferUsage(req.user.id);
    if (used >= DAILY_OFFER_LIMIT) {
        return res.status(429).json({
            success: false,
            message: 'Günlük teklif hakkın doldu (20/20).',
            dailyLimit: DAILY_OFFER_LIMIT,
            used,
            remaining: 0
        });
    }

    const result = db.prepare(`
        INSERT INTO offers (product_id, buyer_id, seller_id, amount, status)
        VALUES (?, ?, ?, ?, 'pending')
    `).run(parsedProductId, req.user.id, product.user_id, parsedAmount);

    addOfferEvent(result.lastInsertRowid, req.user.id, 'created', parsedAmount, 'İlk teklif oluşturuldu');
    notifyUser(product.user_id, 'offer_received', 'Yeni teklif alındı', `${product.title} için ₺${parsedAmount} teklif geldi.`, {
        offerId: result.lastInsertRowid,
        productId: parsedProductId
    });

    const created = db.prepare(`
        SELECT o.id, o.product_id, o.buyer_id, o.seller_id, o.amount, o.status, o.created_at,
               p.title AS product_title, p.price AS product_price
        FROM offers o
        JOIN products p ON p.id = o.product_id
        WHERE o.id = ?
    `).get(result.lastInsertRowid);

    const newUsed = used + 1;
    return res.status(201).json({
        success: true,
        message: 'Teklif gönderildi.',
        offer: created,
        dailyLimit: DAILY_OFFER_LIMIT,
        used: newUsed,
        remaining: Math.max(DAILY_OFFER_LIMIT - newUsed, 0)
    });
});

app.get('/api/offers/sent', authenticate, (req, res) => {
    const offers = db.prepare(`
        SELECT o.id, o.product_id, o.amount, o.status, o.created_at,
               p.title AS product_title, p.price AS product_price,
               COALESCE(u.name, u.email) AS seller_name
        FROM offers o
        JOIN products p ON p.id = o.product_id
        JOIN users u ON u.id = o.seller_id
        WHERE o.buyer_id = ?
        ORDER BY o.id DESC
    `).all(req.user.id);

    return res.status(200).json({ success: true, offers });
});

app.get('/api/offers/received', authenticate, (req, res) => {
    const offers = db.prepare(`
        SELECT o.id, o.product_id, o.amount, o.status, o.created_at,
               p.title AS product_title, p.price AS product_price,
               COALESCE(u.name, u.email) AS buyer_name
        FROM offers o
        JOIN products p ON p.id = o.product_id
        JOIN users u ON u.id = o.buyer_id
        WHERE o.seller_id = ?
        ORDER BY o.id DESC
    `).all(req.user.id);

    return res.status(200).json({ success: true, offers });
});

app.get('/api/offers/:offerId/history', authenticate, (req, res) => {
    const offerId = Number(req.params.offerId);
    if (!Number.isInteger(offerId) || offerId <= 0) {
        return res.status(400).json({ success: false, message: 'Geçersiz teklif.' });
    }

    const offer = db.prepare('SELECT id, buyer_id, seller_id FROM offers WHERE id = ?').get(offerId);
    if (!offer) {
        return res.status(404).json({ success: false, message: 'Teklif bulunamadı.' });
    }

    if (Number(offer.buyer_id) !== Number(req.user.id) && Number(offer.seller_id) !== Number(req.user.id)) {
        return res.status(403).json({ success: false, message: 'Bu teklif geçmişini görüntüleme yetkin yok.' });
    }

    const events = db.prepare(`
        SELECT e.id, e.event_type, e.amount, e.note, e.created_at,
               e.actor_id,
               COALESCE(u.name, u.email) AS actor_name
        FROM offer_events e
        JOIN users u ON u.id = e.actor_id
        WHERE e.offer_id = ?
        ORDER BY e.id ASC
    `).all(offerId);

    return res.status(200).json({ success: true, events });
});

app.post('/api/offers/:offerId/respond', authenticate, (req, res) => {
    const offerId = Number(req.params.offerId);
    const action = String(req.body?.action || '').toLowerCase();
    const counterAmount = Number(req.body?.counterAmount);

    if (!Number.isInteger(offerId) || offerId <= 0) {
        return res.status(400).json({ success: false, message: 'Geçersiz teklif.' });
    }

    if (!['accept', 'reject', 'counter'].includes(action)) {
        return res.status(400).json({ success: false, message: 'Geçersiz işlem.' });
    }

    const offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(offerId);
    if (!offer) {
        return res.status(404).json({ success: false, message: 'Teklif bulunamadı.' });
    }

    const status = String(offer.status);
    const isSeller = Number(offer.seller_id) === Number(req.user.id);
    const isBuyer = Number(offer.buyer_id) === Number(req.user.id);

    const canSellerAct = status === 'pending' && isSeller;
    const canBuyerAct = status === 'countered' && isBuyer;

    if (!canSellerAct && !canBuyerAct) {
        return res.status(403).json({ success: false, message: 'Bu teklif için işlem yetkin yok.' });
    }

    if (action === 'counter') {
        if (!canSellerAct) {
            return res.status(400).json({ success: false, message: 'Karşı teklif sadece satıcı tarafından, bekleyen teklifte yapılabilir.' });
        }

        if (Number.isNaN(counterAmount) || counterAmount <= 0) {
            return res.status(400).json({ success: false, message: 'Karşı teklif tutarı geçerli olmalı.' });
        }

        db.prepare('UPDATE offers SET amount = ?, status = ? WHERE id = ?').run(counterAmount, 'countered', offerId);
        addOfferEvent(offerId, req.user.id, 'countered', counterAmount, 'Satıcı karşı teklif gönderdi');
        notifyUser(offer.buyer_id, 'offer_countered', 'Karşı teklif geldi', `Teklifinize karşı ₺${counterAmount} tutarında yeni teklif geldi.`, {
            offerId
        });

        return res.status(200).json({
            success: true,
            message: 'Karşı teklif gönderildi.',
            status: 'countered',
            amount: counterAmount
        });
    }

    const nextStatus = action === 'accept' ? 'accepted' : 'rejected';
    db.prepare('UPDATE offers SET status = ? WHERE id = ?').run(nextStatus, offerId);
    addOfferEvent(offerId, req.user.id, nextStatus, Number(offer.amount), action === 'accept' ? 'Teklif kabul edildi' : 'Teklif reddedildi');

    if (nextStatus === 'accepted') {
        const product = db.prepare('SELECT id, title, shipping_type, package_size FROM products WHERE id = ?').get(offer.product_id);
        const orderResult = db.prepare(`
            INSERT INTO orders (offer_id, product_id, buyer_id, seller_id, amount, shipping_type, package_size, order_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'created')
        `).run(
            offer.id,
            offer.product_id,
            offer.buyer_id,
            offer.seller_id,
            offer.amount,
            product?.shipping_type || 'seller',
            product?.package_size || 'medium'
        );

        db.prepare('UPDATE offers SET order_id = ? WHERE id = ?').run(orderResult.lastInsertRowid, offer.id);
        db.prepare("UPDATE products SET sale_status = 'sold' WHERE id = ?").run(offer.product_id);
        db.prepare('UPDATE users SET total_sales = COALESCE(total_sales, 0) + 1 WHERE id = ?').run(offer.seller_id);

        addOrderEvent(orderResult.lastInsertRowid, req.user.id, 'order_created', 'Teklif kabul edildi, sipariş oluşturuldu');
        notifyUser(offer.buyer_id, 'offer_accepted', 'Teklifin kabul edildi', `${product?.title || 'Ürün'} için teklifin kabul edildi.`, {
            offerId,
            orderId: orderResult.lastInsertRowid
        });
        notifyUser(offer.seller_id, 'order_created', 'Yeni sipariş oluştu', `${product?.title || 'Ürün'} için sipariş oluşturuldu.`, {
            offerId,
            orderId: orderResult.lastInsertRowid
        });
    } else {
        notifyUser(offer.buyer_id, 'offer_rejected', 'Teklif reddedildi', 'Gönderdiğiniz teklif reddedildi.', { offerId });
    }

    return res.status(200).json({
        success: true,
        message: action === 'accept' ? 'Teklif kabul edildi.' : 'Teklif reddedildi.',
        status: nextStatus
    });
});

// ─── Yorum Endpoint'leri ───────────────────────────────────────────────────

app.get('/api/products/:productId/comments', (req, res) => {
    const productId = Number(req.params.productId);
    if (!Number.isInteger(productId) || productId <= 0) {
        return res.status(400).json({ success: false, message: 'Geçersiz ürün.' });
    }

    const comments = db.prepare(`
        SELECT c.id, c.content, c.created_at,
               c.user_id,
               COALESCE(u.name, u.email) AS user_name
        FROM comments c
        JOIN users u ON u.id = c.user_id
        WHERE c.product_id = ?
        ORDER BY c.id DESC
    `).all(productId);

    return res.status(200).json({ success: true, comments });
});

app.post('/api/products/:productId/comments', authenticate, (req, res) => {
    const productId = Number(req.params.productId);
    const content = String(req.body?.content || '').trim();

    if (!Number.isInteger(productId) || productId <= 0) {
        return res.status(400).json({ success: false, message: 'Geçersiz ürün.' });
    }

    if (!content) {
        return res.status(400).json({ success: false, message: 'Yorum boş olamaz.' });
    }

    if (content.length > 500) {
        return res.status(400).json({ success: false, message: 'Yorum en fazla 500 karakter olabilir.' });
    }

    const product = db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
    if (!product) {
        return res.status(404).json({ success: false, message: 'Ürün bulunamadı.' });
    }

    const result = db.prepare(`
        INSERT INTO comments (product_id, user_id, content)
        VALUES (?, ?, ?)
    `).run(productId, req.user.id, content);

    const comment = db.prepare(`
        SELECT c.id, c.content, c.created_at, c.user_id,
               COALESCE(u.name, u.email) AS user_name
        FROM comments c
        JOIN users u ON u.id = c.user_id
        WHERE c.id = ?
    `).get(result.lastInsertRowid);

    return res.status(201).json({ success: true, message: 'Yorum eklendi.', comment });
});

// ─── Favori Endpoint'leri ──────────────────────────────────────────────────

app.get('/api/favorites', authenticate, (req, res) => {
    const favorites = db.prepare(`
        SELECT
            f.id AS favorite_id,
            f.created_at AS favorited_at,
            p.id,
            p.title,
            p.price,
            p.brand,
            p.size,
            p.item_condition,
            p.shipping_type,
            p.image_url
        FROM favorites f
        JOIN products p ON p.id = f.product_id
        WHERE f.user_id = ?
        ORDER BY f.id DESC
    `).all(req.user.id);

    return res.status(200).json({ success: true, products: favorites });
});

app.post('/api/favorites/:productId', authenticate, (req, res) => {
    const productId = Number(req.params.productId);
    if (!Number.isInteger(productId) || productId <= 0) {
        return res.status(400).json({ success: false, message: 'Geçersiz ürün.' });
    }

    const product = db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
    if (!product) {
        return res.status(404).json({ success: false, message: 'Ürün bulunamadı.' });
    }

    const existing = db.prepare('SELECT id FROM favorites WHERE user_id = ? AND product_id = ?').get(req.user.id, productId);
    if (existing) {
        return res.status(200).json({ success: true, message: 'Ürün zaten favorilerde.', isFavorite: true });
    }

    db.prepare('INSERT INTO favorites (user_id, product_id) VALUES (?, ?)').run(req.user.id, productId);
    return res.status(201).json({ success: true, message: 'Favorilere eklendi.', isFavorite: true });
});

app.delete('/api/favorites/:productId', authenticate, (req, res) => {
    const productId = Number(req.params.productId);
    if (!Number.isInteger(productId) || productId <= 0) {
        return res.status(400).json({ success: false, message: 'Geçersiz ürün.' });
    }

    db.prepare('DELETE FROM favorites WHERE user_id = ? AND product_id = ?').run(req.user.id, productId);
    return res.status(200).json({ success: true, message: 'Favorilerden kaldırıldı.', isFavorite: false });
});

// ─── Takip Endpoint'leri ───────────────────────────────────────────────────

app.get('/api/follows', authenticate, (req, res) => {
    const sellers = db.prepare(`
        SELECT
            f.seller_id,
            f.created_at,
            COALESCE(u.name, u.email) AS seller_name,
            COALESCE(u.seller_rating, 0) AS seller_rating,
            COALESCE(u.total_sales, 0) AS total_sales,
            (
                SELECT COUNT(*) FROM follows f2 WHERE f2.seller_id = f.seller_id
            ) AS follower_count
        FROM follows f
        JOIN users u ON u.id = f.seller_id
        WHERE f.user_id = ?
        ORDER BY f.id DESC
    `).all(req.user.id);

    return res.status(200).json({ success: true, sellers });
});

app.post('/api/follows/:sellerId', authenticate, (req, res) => {
    const sellerId = Number(req.params.sellerId);
    if (!Number.isInteger(sellerId) || sellerId <= 0) {
        return res.status(400).json({ success: false, message: 'Geçersiz satıcı.' });
    }

    if (sellerId === Number(req.user.id)) {
        return res.status(400).json({ success: false, message: 'Kendini takip edemezsin.' });
    }

    const seller = db.prepare('SELECT id FROM users WHERE id = ?').get(sellerId);
    if (!seller) {
        return res.status(404).json({ success: false, message: 'Satıcı bulunamadı.' });
    }

    const exists = db.prepare('SELECT id FROM follows WHERE user_id = ? AND seller_id = ?').get(req.user.id, sellerId);
    if (exists) {
        return res.status(200).json({ success: true, message: 'Zaten takip ediliyor.', isFollowing: true });
    }

    db.prepare('INSERT INTO follows (user_id, seller_id) VALUES (?, ?)').run(req.user.id, sellerId);
    return res.status(201).json({ success: true, message: 'Satıcı takip edildi.', isFollowing: true });
});

app.delete('/api/follows/:sellerId', authenticate, (req, res) => {
    const sellerId = Number(req.params.sellerId);
    if (!Number.isInteger(sellerId) || sellerId <= 0) {
        return res.status(400).json({ success: false, message: 'Geçersiz satıcı.' });
    }

    db.prepare('DELETE FROM follows WHERE user_id = ? AND seller_id = ?').run(req.user.id, sellerId);
    return res.status(200).json({ success: true, message: 'Takipten çıkarıldı.', isFollowing: false });
});

// ─── Öneri Endpoint'i ──────────────────────────────────────────────────────

app.get('/api/products/recommended', authenticate, (req, res) => {
    const userId = Number(req.user.id);

    const followedSellerIds = db.prepare(
        'SELECT seller_id FROM follows WHERE user_id = ?'
    ).all(userId).map((r) => Number(r.seller_id));

    const favoriteSignals = db.prepare(`
        SELECT p.category, p.brand
        FROM favorites f
        JOIN products p ON p.id = f.product_id
        WHERE f.user_id = ?
        ORDER BY f.id DESC
        LIMIT 30
    `).all(userId);

    const likedCategories = new Set(
        favoriteSignals.map((x) => String(x.category || '').toLowerCase()).filter(Boolean)
    );
    const likedBrands = new Set(
        favoriteSignals.map((x) => String(x.brand || '').toLowerCase()).filter(Boolean)
    );

    const products = db.prepare(`
        SELECT
            p.id,
            p.user_id,
            p.title,
            p.price,
            p.category,
            p.brand,
            p.size,
            p.item_condition,
            p.shipping_type,
            p.package_size,
            p.image_url,
            p.description,
            p.created_at,
            COALESCE(u.name, u.email) AS seller_name,
            COALESCE(u.seller_rating, 0) AS seller_rating
        FROM products p
        JOIN users u ON u.id = p.user_id
        WHERE p.user_id != ?
        ORDER BY p.id DESC
        LIMIT 140
    `).all(userId);

    const scored = products.map((p) => {
        let score = 0;
        if (followedSellerIds.includes(Number(p.user_id))) score += 50;
        if (likedCategories.has(String(p.category || '').toLowerCase())) score += 18;
        if (likedBrands.has(String(p.brand || '').toLowerCase())) score += 14;
        if (Number(p.seller_rating) >= 4.5) score += 6;
        return { ...p, rec_score: score };
    });

    scored.sort((a, b) => b.rec_score - a.rec_score || b.id - a.id);

    return res.status(200).json({
        success: true,
        products: scored.slice(0, 30)
    });
});

// ─── Satıcı Paneli Endpoint'leri ───────────────────────────────────────────

app.get('/api/seller/panel', authenticate, (req, res) => {
    const userId = Number(req.user.id);
    const seller = db.prepare(`
        SELECT id, email, name, total_sales, seller_rating, is_star_seller, is_verified
        FROM users WHERE id = ?
    `).get(userId);

    const activeProducts = db.prepare(
        "SELECT COUNT(*) AS total FROM products WHERE user_id = ? AND COALESCE(sale_status, 'available') = 'available'"
    ).get(userId)?.total || 0;

    const pendingShipments = db.prepare(
        "SELECT COUNT(*) AS total FROM orders WHERE seller_id = ? AND order_status IN ('created', 'packed')"
    ).get(userId)?.total || 0;

    return res.status(200).json({
        success: true,
        seller,
        stats: {
            activeProducts: Number(activeProducts),
            pendingShipments: Number(pendingShipments),
            totalSales: Number(seller?.total_sales || 0)
        },
        trust: {
            rating: Number(seller?.seller_rating || 0),
            isStarSeller: Number(seller?.is_star_seller || 0) === 1,
            isVerified: Number(seller?.is_verified || 0) === 1,
            badge: Number(seller?.is_verified || 0) === 1 ? 'Doğrulanmış Satıcı' : 'Standart Satıcı'
        }
    });
});

app.get('/api/seller/products', authenticate, (req, res) => {
    const products = db.prepare(`
        SELECT id, title, price, category, brand, size, shipping_type, package_size, image_url, description, created_at,
               COALESCE(sale_status, 'available') AS sale_status
        FROM products
        WHERE user_id = ?
        ORDER BY id DESC
    `).all(req.user.id);

    return res.status(200).json({ success: true, products });
});

app.put('/api/seller/products/:productId', authenticate, (req, res) => {
    const productId = Number(req.params.productId);
    const { title, description, price, shippingType, packageSize, saleStatus } = req.body || {};

    const product = db.prepare('SELECT id, user_id FROM products WHERE id = ?').get(productId);
    if (!product) return res.status(404).json({ success: false, message: 'Ürün bulunamadı.' });
    if (Number(product.user_id) !== Number(req.user.id)) return res.status(403).json({ success: false, message: 'Yetki yok.' });

    const validSaleStatus = ['available', 'reserved', 'sold'];
    const normalizedSaleStatus = validSaleStatus.includes(String(saleStatus || '').toLowerCase())
        ? String(saleStatus).toLowerCase()
        : null;

    db.prepare(`
        UPDATE products
        SET title = COALESCE(?, title),
            description = COALESCE(?, description),
            price = COALESCE(?, price),
            shipping_type = COALESCE(?, shipping_type),
            package_size = COALESCE(?, package_size),
            sale_status = COALESCE(?, sale_status)
        WHERE id = ?
    `).run(
        title ? String(title).trim() : null,
        description ? String(description).trim() : null,
        Number.isFinite(Number(price)) ? Number(price) : null,
        shippingType ? String(shippingType).trim() : null,
        packageSize ? String(packageSize).trim() : null,
        normalizedSaleStatus,
        productId
    );

    const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    return res.status(200).json({ success: true, message: 'Ürün güncellendi.', product: updated });
});

app.get('/api/seller/orders', authenticate, (req, res) => {
    const orders = db.prepare(`
        SELECT o.*, p.title AS product_title, p.image_url,
               COALESCE(u.name, u.email) AS buyer_name
        FROM orders o
        JOIN products p ON p.id = o.product_id
        JOIN users u ON u.id = o.buyer_id
        WHERE o.seller_id = ?
        ORDER BY o.id DESC
    `).all(req.user.id);

    return res.status(200).json({ success: true, orders });
});

app.post('/api/seller/orders/:orderId/ship', authenticate, (req, res) => {
    const orderId = Number(req.params.orderId);
    const trackingNo = String(req.body?.trackingNo || '').trim();
    const shipmentStatus = String(req.body?.shipmentStatus || 'shipped').toLowerCase();

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Sipariş bulunamadı.' });
    if (Number(order.seller_id) !== Number(req.user.id)) return res.status(403).json({ success: false, message: 'Yetki yok.' });

    const valid = ['packed', 'shipped', 'in_transit'];
    const next = valid.includes(shipmentStatus) ? shipmentStatus : 'shipped';

    db.prepare('UPDATE orders SET tracking_no = COALESCE(?, tracking_no), order_status = ? WHERE id = ?')
        .run(trackingNo || null, next, orderId);

    addOrderEvent(orderId, req.user.id, next, trackingNo ? `Takip No: ${trackingNo}` : 'Kargo durumu güncellendi');
    notifyUser(order.buyer_id, 'shipment_update', 'Kargo güncellendi', `Siparişinizin kargo durumu: ${next}`, { orderId });

    return res.status(200).json({ success: true, message: 'Kargo durumu güncellendi.', orderStatus: next });
});

app.post('/api/seller/orders/:orderId/deliver', authenticate, (req, res) => {
    const orderId = Number(req.params.orderId);
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Sipariş bulunamadı.' });
    if (Number(order.seller_id) !== Number(req.user.id)) return res.status(403).json({ success: false, message: 'Yetki yok.' });

    db.prepare("UPDATE orders SET order_status = 'delivered' WHERE id = ?").run(orderId);
    addOrderEvent(orderId, req.user.id, 'delivered', 'Sipariş teslim edildi.');
    notifyUser(order.buyer_id, 'order_delivered', 'Sipariş teslim edildi', 'Siparişiniz teslim edildi olarak işaretlendi.', { orderId });

    return res.status(200).json({ success: true, message: 'Sipariş teslim edildi olarak güncellendi.' });
});

// ─── Alıcı Paneli Endpoint'leri ───────────────────────────────────────────

app.get('/api/buyer/orders', authenticate, (req, res) => {
    const orders = db.prepare(`
        SELECT o.*, p.title AS product_title, p.image_url,
               COALESCE(u.name, u.email) AS seller_name,
               COALESCE(u.seller_rating, 0) AS seller_rating,
               COALESCE(u.is_star_seller, 0) AS is_star_seller,
               COALESCE(u.is_verified, 0) AS is_verified
        FROM orders o
        JOIN products p ON p.id = o.product_id
        JOIN users u ON u.id = o.seller_id
        WHERE o.buyer_id = ?
        ORDER BY o.id DESC
    `).all(req.user.id);

    return res.status(200).json({ success: true, orders });
});

app.get('/api/buyer/orders/badges', authenticate, (req, res) => {
    const userId = Number(req.user.id);

    const activeShipmentCount = db.prepare(`
        SELECT COUNT(*) AS total
        FROM orders
        WHERE buyer_id = ?
          AND order_status IN ('created', 'packed', 'shipped', 'in_transit', 'return_requested')
    `).get(userId)?.total || 0;

    const deliveredCount = db.prepare(`
        SELECT COUNT(*) AS total
        FROM orders
        WHERE buyer_id = ?
          AND order_status = 'delivered'
    `).get(userId)?.total || 0;

    return res.status(200).json({
        success: true,
        badges: {
            activeShipmentCount: Number(activeShipmentCount),
            deliveredCount: Number(deliveredCount)
        }
    });
});

app.post('/api/buyer/orders/:orderId/cancel-request', authenticate, (req, res) => {
    const orderId = Number(req.params.orderId);
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Sipariş bulunamadı.' });
    if (Number(order.buyer_id) !== Number(req.user.id)) return res.status(403).json({ success: false, message: 'Yetki yok.' });

    if (!['created', 'packed'].includes(String(order.order_status))) {
        return res.status(400).json({ success: false, message: 'Bu aşamada iptal talebi açılamaz.' });
    }

    db.prepare('UPDATE orders SET cancel_requested = 1 WHERE id = ?').run(orderId);
    addOrderEvent(orderId, req.user.id, 'cancel_requested', 'Alıcı iptal talebi oluşturdu.');
    notifyUser(order.seller_id, 'cancel_request', 'İptal talebi alındı', 'Bir sipariş için iptal talebi oluşturuldu.', { orderId });

    return res.status(200).json({ success: true, message: 'İptal talebi oluşturuldu.' });
});

app.post('/api/buyer/orders/:orderId/return-request', authenticate, (req, res) => {
    const orderId = Number(req.params.orderId);
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Sipariş bulunamadı.' });
    if (Number(order.buyer_id) !== Number(req.user.id)) return res.status(403).json({ success: false, message: 'Yetki yok.' });

    if (String(order.order_status) !== 'delivered') {
        return res.status(400).json({ success: false, message: 'İade talebi için sipariş teslim edilmiş olmalı.' });
    }

    db.prepare('UPDATE orders SET return_requested = 1, order_status = ? WHERE id = ?').run('return_requested', orderId);
    addOrderEvent(orderId, req.user.id, 'return_requested', 'Alıcı iade talebi oluşturdu.');
    notifyUser(order.seller_id, 'return_request', 'İade talebi alındı', 'Bir sipariş için iade talebi oluşturuldu.', { orderId });

    return res.status(200).json({ success: true, message: 'İade talebi oluşturuldu.' });
});

app.get('/api/orders/:orderId/tracking', authenticate, (req, res) => {
    const orderId = Number(req.params.orderId);
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Sipariş bulunamadı.' });

    const actorId = Number(req.user.id);
    if (actorId !== Number(order.buyer_id) && actorId !== Number(order.seller_id)) {
        return res.status(403).json({ success: false, message: 'Yetki yok.' });
    }

    const events = db.prepare(`
        SELECT e.id, e.event_type, e.note, e.created_at,
               COALESCE(u.name, u.email) AS actor_name
        FROM order_events e
        JOIN users u ON u.id = e.actor_id
        WHERE e.order_id = ?
        ORDER BY e.id ASC
    `).all(orderId);

    return res.status(200).json({ success: true, order, events });
});

// ─── Bildirim Endpoint'leri ───────────────────────────────────────────────

app.get('/api/notifications', authenticate, (req, res) => {
    const notifications = db.prepare(`
        SELECT id, type, title, message, data_json, is_read, created_at
        FROM notifications
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT 100
    `).all(req.user.id);

    return res.status(200).json({ success: true, notifications });
});

app.get('/api/notifications/unread-count', authenticate, (req, res) => {
    const unreadCount = db.prepare(`
        SELECT COUNT(*) AS total
        FROM notifications
        WHERE user_id = ? AND is_read = 0
    `).get(req.user.id)?.total || 0;

    return res.status(200).json({ success: true, unreadCount: Number(unreadCount) });
});

app.post('/api/notifications/:notificationId/read', authenticate, (req, res) => {
    const notificationId = Number(req.params.notificationId);
    db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(notificationId, req.user.id);
    return res.status(200).json({ success: true, message: 'Okundu olarak işaretlendi.' });
});

app.post('/api/notifications/read-all', authenticate, (req, res) => {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
    return res.status(200).json({ success: true, message: 'Tüm bildirimler okundu.' });
});

// Destek Asistanı (AI + fallback)
app.post('/api/support/chat', async (req, res) => {
    const { message, history, orderNo } = req.body || {};

    if (!message || !String(message).trim()) {
        return res.status(400).json({
            success: false,
            message: 'Mesaj alanı zorunludur.'
        });
    }

    const normalizedMessage = String(message).trim().slice(0, 1000);
    const normalizedOrderNo = normalizeOrderNo(orderNo);
    const fallback = getFallbackSupportReply(normalizedMessage, normalizedOrderNo);
    const aiReply = await getOpenAISupportReply(normalizedMessage, history, normalizedOrderNo);

    return res.status(200).json({
        success: true,
        reply: aiReply || fallback.reply,
        intent: fallback.intent,
        usedAI: Boolean(aiReply),
        orderNo: normalizedOrderNo,
        suggestions: [
            'Kargom nerede?',
            'İade nasıl yaparım?',
            'Sipariş iptali mümkün mü?',
            'Canlı desteğe nasıl bağlanırım?'
        ]
    });
});

// Sunucuyu belirtilen port üzerinden dinlemeye (Listen) alıyoruz
app.listen(PORT, () => {
    console.log(`Sunucu http://localhost:${PORT} adresinde başarıyla başlatıldı.`);
});