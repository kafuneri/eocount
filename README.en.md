<div align="right">
  <a href="README.md">简体中文</a>
</div>

# Eocount

A lightweight, serverless website traffic counter (PV/UV) built on **Tencent Cloud EdgeOne Pages (Makers)** and **EdgeOne Blob** (`consistency: "strong"`). Designed as a fast, zero-database, drop-in replacement for **Vercount** and **Busuanzi**.

## Features

- **Strong Consistency**: Powered by EdgeOne Blob (`consistency: "strong"`), ensuring zero lost counts across different ISPs and edge PoPs.
- **Zero External Database**: Runs entirely on EdgeOne Edge Functions + EdgeOne Blob + static HTML. No external Redis or PostgreSQL required.
- **Drop-in Vercount & Busuanzi Compatibility**:
  - Supports both `vercount_value_*` and `busuanzi_value_*` DOM IDs as well as `*_container_*` visibility toggling.
  - Exposes `/api/v2/log` (Vercount v2 format) and `/api/v1/log` (flat JSON).
  - Supports `window.eocountFetch()` / `window.vercountFetch()` and `pjax:complete` / `astro:page-load` for SPAs.
- **64-Bucket UV Deduplication**: Uses Web Crypto `SHA-256(host|ip|ua)` short hashes sharded across 64 buckets (`sites/<host>/uv/<bucket>.json`) to minimize Blob write operations.
- **Built-in Admin Dashboard (`/admin.html`)**: Stateless HMAC-SHA256 cookie auth, live overview, inline editing/deletion, and JSON export/import (`Math.max` merge or overwrite).
- **Security**: `ALLOWED_DOMAINS` domain whitelist (supports `*.example.com`) and read-only bot User-Agent filtering.

## Quick Usage

### 1. Include the Script

```html
<script defer src="https://your-domain.example.com/js"></script>
```

### 2. Add Counter Elements

**Vercount-compatible tags:**
```html
Page Views: <span id="vercount_value_page_pv">Loading</span>
Site Visits: <span id="vercount_value_site_pv">Loading</span>
Site Visitors: <span id="vercount_value_site_uv">Loading</span>
```

**Busuanzi-compatible tags:**
```html
<span id="busuanzi_container_page_pv">Page Views: <span id="busuanzi_value_page_pv"></span></span>
<span id="busuanzi_container_site_pv">Site Visits: <span id="busuanzi_value_site_pv"></span></span>
<span id="busuanzi_container_site_uv">Site Visitors: <span id="busuanzi_value_site_uv"></span></span>
```

## Environment Variables

Configure these in your EdgeOne Pages project settings:

| Variable | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `ADMIN_PASSWORD` | Yes | - | Password for `/admin.html` |
| `ADMIN_SESSION_SECRET` | Recommended | `ADMIN_PASSWORD` | Secret key for HMAC-SHA256 session cookies |
| `BLOB_STORE_NAME` | No | `eocount-dat` | EdgeOne Blob store name (auto-created on first write) |
| `ALLOWED_DOMAINS` | Recommended | Empty (allow all) | Comma-separated allowed domains (supports `*.example.com`) |
| `FILTER_BOTS` | No | `true` | Return read-only counts for known bots/crawlers |
| `AUTO_MIGRATE_BUSUANZI` | No | `false` | Fetch initial baseline from Busuanzi on first visit |

## Local Development

```bash
npm install
npm run build
npm run validate
npx edgeone makers dev
npm run preview
```

## License

MIT
