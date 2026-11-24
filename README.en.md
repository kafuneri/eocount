<div align="right">
  <a href="README.md">简体中文</a>
</div>

# Eocount

A lightweight, serverless website traffic counter (PV/UV) built on **Tencent Cloud EdgeOne Pages (Makers)** and **EdgeOne Blob** (`consistency: "strong"` reads + `context.waitUntil` background writes). Designed as a fast, zero-database, drop-in replacement for **Vercount** and **Busuanzi**.

## Features

- **Fast & Strong Consistency**: Performs strong-consistency reads, computes `+1` immediately in memory for fast response (200–500ms), and persists updates asynchronously via `context.waitUntil` with automatic retries.
- **Zero External Database**: Runs entirely inside a single EdgeOne Pages project (`Edge Functions + EdgeOne Blob + static HTML`). No external Redis or PostgreSQL required.
- **Drop-in Vercount & Busuanzi Compatibility**:
  - Supports both `vercount_value_*` and `busuanzi_value_*` DOM IDs plus `*_container_*` visibility toggling.
  - Exposes `/api/v2/log` (Vercount v2 format) and `/api/v1/log` (flat JSON).
  - Built-in PJAX / Astro ViewTransitions anti-double-count debounce plus `window.eocountFetch()` / `window.vercountFetch()`.
- **64-Bucket UV Deduplication**: Shards `SHA-256(host|ip|ua)` short hashes across 64 buckets (`sites/<host>/uv/<bucket>.json`) to save Blob writes.
- **Zero-Overhead 30-Day Daily Trend**: Stores daily PV counts in existing `sites/<host>/summary.json` (`daily`, pruned to the latest 30 days) with zero extra Blob requests.
- **Bilingual Admin Dashboard (`/admin.html`)**: Single-admin cookie auth, domain pinning & hiding, chunked progress loading, dirty-only batch saving, and JSON export/import (`Math.max` merge or overwrite).

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

## Deployment on EdgeOne Pages

1. Fork this repository and create a new project in **Tencent Cloud EdgeOne Pages** (`edgeone.json` configures build and rewrites automatically).
2. Ensure **Blob Storage** is enabled in the project console (the store is created automatically on first write).
3. Configure the environment variables below and **redeploy**:

| Variable | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `ADMIN_PASSWORD` | Yes | - | Password for `/admin.html` |
| `ADMIN_SESSION_SECRET` | Recommended | `ADMIN_PASSWORD` | Secret key for HMAC-SHA256 session cookies |
| `BLOB_STORE_NAME` | No | `eocount-data` | EdgeOne Blob store name |
| `ALLOWED_DOMAINS` | Recommended | Empty (allow all) | Comma-separated allowed domains (supports wildcards like `*.example.com`) |
| `FILTER_BOTS` | No | `true` | Return read-only counts for known bots/crawlers |
| `AUTO_MIGRATE_BUSUANZI` | No | `false` | Fetch initial baseline from Busuanzi on first visit |

4. (Optional) Bind a custom domain in **Domain Management** for direct token-free access.

## Migrating Historical Data

In `/admin.html` → **Backup**, import historical totals in `Math.max` merge mode:
```json
{
  "items": [
    { "url": "https://blog.example.com/", "site_pv": 25599, "site_uv": 9402 },
    { "url": "https://blog.example.com/posts/hello", "page_pv": 1200 }
  ]
}
```

## Local Development

```bash
npm install
npm run build
npm run validate
npx edgeone makers dev
npm run preview
```

## License

[MIT](LICENSE)
