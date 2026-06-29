# Vitrin Backend API

Node.js servisi: marketplace API, S3 presigned upload, AI chat (HTTP + WebSocket).

## Yerel geliştirme

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

- API: `http://localhost:3000/api`
- Health: `http://localhost:3000/health`
- Chat WS: `ws://localhost:3000/ws/chat`

## Ana endpoint grupları

| Grup | Örnek |
|------|--------|
| Auth | `POST /api/register`, `POST /api/login` |
| Ürünler | `GET /api/products/feed`, `POST /api/products` |
| Upload | `POST /api/uploads/presign`, `POST /api/uploads/complete` |
| Teklif/Sipariş | `POST /api/offers`, `GET /api/buyer/orders` |
| Chat | `POST /api/support/chat`, WebSocket `/ws/chat` |

## Railway deploy

Kök dizinde `railway.json` + `nixpacks.toml` mevcuttur.

Detaylı adımlar: [docs/deploy_railway.md](../docs/deploy_railway.md)

Env şablonu: [.env.railway.example](.env.railway.example)

Deploy sonrası smoke test:

```bash
API_BASE_URL=https://YOUR-DOMAIN.up.railway.app/api ./scripts/railway_smoke.sh
```

## Flutter prod build

```bash
./scripts/flutter_prod_build.sh apk config/flutter.prod.env
```

Şablon: [config/flutter.prod.example.env](../config/flutter.prod.example.env)

## Notlar

- Upload auth: giriş yapmış kullanıcı token'ı veya `UPLOAD_API_TOKEN` kabul edilir.
- Prod'da `AUTH_SALT` ve `UPLOAD_API_TOKEN` mutlaka set edilmelidir.
- JSON store için Railway Volume önerilir (`DATA_DIR=/app/backend/data`).
