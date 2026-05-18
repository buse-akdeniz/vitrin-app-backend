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
        color       TEXT    DEFAULT '',
        image_url   TEXT    DEFAULT '',
        description TEXT    DEFAULT '',
        created_at  TEXT    DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
    )
`);

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

ensureColumn('products', 'brand', "brand TEXT DEFAULT ''");
ensureColumn('products', 'size', "size TEXT DEFAULT ''");
ensureColumn('products', 'fabric_type', "fabric_type TEXT DEFAULT ''");
ensureColumn('products', 'shoe_size', "shoe_size TEXT DEFAULT ''");
ensureColumn('products', 'gender', "gender TEXT DEFAULT ''");
ensureColumn('products', 'item_condition', "item_condition TEXT DEFAULT ''");
ensureColumn('products', 'shipping_type', "shipping_type TEXT DEFAULT 'seller'");
ensureColumn('products', 'color', "color TEXT DEFAULT ''");
ensureColumn('products', 'is_sos', 'is_sos INTEGER DEFAULT 0');
ensureColumn('products', 'sos_discount_percent', 'sos_discount_percent INTEGER DEFAULT 0');

console.log('Veritabanı bağlantısı kuruldu ve tablo hazır.');

// Express uygulamasını başlatıyoruz
const app = express();

// Sunucunun çalışacağı kapı numarasını (Port) belirliyoruz
const PORT = 3000;

// Sunucunun gelen JSON formatındaki paketleri (verileri) okumasını sağlar
app.use(express.json());

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
    try {
        const stmt = db.prepare('INSERT INTO users (email, password) VALUES (?, ?)');
        const result = stmt.run(email, hashedPassword);
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

    // 7. Flutter'a kayıt başarılı mesajı ve geçici bir token dönüyoruz
    res.status(201).json({
        success: true,
        message: 'Kullanıcı başarıyla kaydedildi.',
        token: 'sahte_token_xyz123'
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
    const token = jwt.sign(
        { id: user.id, email: user.email },
        JWT_SECRET,
        { expiresIn: '7d' }
    );

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
    const token = authHeader && authHeader.split(' ')[1]; // "Bearer <token>"

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

// ─── Profil Endpoint'leri ────────────────────────────────────────────────────

// Profil Görüntüleme (GET)
app.get('/api/profile', authenticate, (req, res) => {
    const user = db.prepare(
        'SELECT id, email, name, bio, created_at FROM users WHERE id = ?'
    ).get(req.user.id);

    if (!user) {
        return res.status(404).json({ success: false, message: 'Kullanıcı bulunamadı!' });
    }

    res.status(200).json({ success: true, user });
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
        'SELECT id, email, name, bio, created_at FROM users WHERE id = ?'
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
    if (color) {
        where.push('LOWER(p.color) = @color');
        params.color = String(color).toLowerCase();
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
            shoe_size, gender, item_condition, shipping_type, color,
            image_url, description, is_sos, sos_discount_percent
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        color ? String(color).trim() : '',
        imageUrl ? String(imageUrl).trim() : '',
        description ? String(description).trim() : '',
        isSosMode,
        discountPercent
    );

    const createdProduct = db.prepare(`
        SELECT
            id, title, price, category, brand, size, fabric_type, shoe_size,
            gender, item_condition, shipping_type, color, image_url, description,
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

// Sunucuyu belirtilen port üzerinden dinlemeye (Listen) alıyoruz
app.listen(PORT, () => {
    console.log(`Sunucu http://localhost:${PORT} adresinde başarıyla başlatıldı.`);
});