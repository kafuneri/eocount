# EO Vercount — EdgeOne Blob 强一致网站访问量统计

基于 **腾讯云 EdgeOne Pages (Makers)** 的单管理员、零外部数据库、国内低延迟网站访问量统计服务，使用 **EdgeOne Blob（`consistency: "strong"` 强一致模式）** 存储，100% 兼容 **Vercount** 与 **不蒜子（Busuanzi）** 前端标签及 `/api/v2/log`、`/api/v1/log` 接口。

## 特性
- **强一致无丢数**：EdgeOne Blob 强一致读写，跨运营商（如联通宽带 ↔ 电信流量）切换秒级同步递增。
- **纯 EdgeOne 原生架构**：`Edge Functions + EdgeOne Blob + 纯静态前端`，无需外部 Redis / PostgreSQL。
- **双协议无缝兼容**：同时支持 `vercount_value_*` 与 `busuanzi_value_*` 标签及 `*_container_*` 容器显隐，支持 `window.vercountFetch()`（SPA/PJAX）。
- **UV 分桶去重**：采用 64 桶哈希存储访客指纹（`SHA-256(host|ip|ua)`），极大节省 Blob 读写配额。
- **单管理员后台（`/admin.html`）**：支持实时查看/修改/删除站点与页面计数、JSON 一键备份导出与历史数据导入（支持 `Math.max` 合并与覆盖）。

## 环境变量说明（EdgeOne 控制台配置）

| 变量名 | 必填 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `ADMIN_PASSWORD` | 是 | - | `/admin.html` 后台登录密码 |
| `ADMIN_SESSION_SECRET` | 推荐 | 回退使用 `ADMIN_PASSWORD` | HMAC-SHA256 Cookie 签名密钥 |
| `BLOB_STORE_NAME` | 否 | `vercount-data` | EdgeOne Blob 存储空间名称（首次调用自动创建） |
| `ALLOWED_DOMAINS` | 推荐 | 空（放行全部） | 允许统计的域名白名单，逗号分隔，支持 `*.example.com` |
| `FILTER_BOTS` | 否 | `true` | 是否过滤常见爬虫/脚本（命中时只读不递增） |
| `AUTO_MIGRATE_BUSUANZI` | 否 | `false` | 首次访问某站点/页面时是否尝试从不蒜子拉取历史基数 |

## 本地开发与预览

```bash
npm install
npm run build
npm run validate
npx edgeone makers dev
npm run preview
```
