<div align="right">
  <a href="README.en.md">English</a>
</div>

# Eocount — 腾讯云 EdgeOne 强一致网站流量计数器

基于 **腾讯云 EdgeOne Pages (Makers)** 的单管理员、零外部数据库、国内低延迟网站访问量统计服务，使用 **EdgeOne Blob（`consistency: "strong"` 强一致读 + `context.waitUntil` 后台写）** 存储，100% 兼容 **Vercount** 与 **不蒜子（Busuanzi）** 前端标签及 `/api/v2/log`、`/api/v1/log` 接口。

## 核心特性

- **国内极速 & 强一致不丢数**：强一致读取当前计数后内存 `+1` 立即返回，`context.waitUntil` 后台异步落盘，兼顾 200–500ms 响应速度与跨运营商、跨省切换绝不丢数。
- **零外部数据库**：全托管于单个 EdgeOne Pages 项目（`Edge Functions + EdgeOne Blob + 纯静态前端`），无需 Redis 或 PostgreSQL，零保活与运维成本。
- **双协议无缝兼容**：同时支持 `vercount_value_*` 与 `busuanzi_value_*` 标签及 `*_container_*` 容器显隐，支持 PJAX / Astro ViewTransitions 防重入防抖与 `window.eocountFetch()` / `window.vercountFetch()`。
- **64 桶访客去重**：基于 `SHA-256(host|ip|ua)` 的短哈希分桶存储（`sites/<域名>/uv/<桶>.json`），大幅节省 Blob 写入配额。
- **近 30 天每日趋势统计**：自动在 `sites/<域名>/summary.json` 中维护最近 30 天每日访问量（`daily`），零额外读写配额即可在后台查看趋势柱状图与今日新增。
- **单管理员后台（`/admin.html`）**：支持中英双语切换、站点置顶收藏与隐藏测试域名、分批进度条加载、按脏数据增量保存、JSON 一键备份与 `Math.max` 合并导入。

## 快速接入

### 1. 在网站中引入统计脚本

```html
<script defer src="https://你的统计域名/js"></script>
```

### 2. 插入计数展示标签

**Vercount 兼容标签：**
```html
本文阅读量 <span id="vercount_value_page_pv">Loading</span> 次
本站总访问 <span id="vercount_value_site_pv">Loading</span> 次
本站总访客 <span id="vercount_value_site_uv">Loading</span> 人
```

**不蒜子兼容标签：**
```html
<span id="busuanzi_container_page_pv">本文阅读量 <span id="busuanzi_value_page_pv"></span> 次</span>
<span id="busuanzi_container_site_pv">本站总访问 <span id="busuanzi_value_site_pv"></span> 次</span>
<span id="busuanzi_container_site_uv">本站总访客 <span id="busuanzi_value_site_uv"></span> 人</span>
```

## EdgeOne Pages 部署指南

1. Fork 或克隆本仓库，在 **腾讯云 EdgeOne Pages** 控制台新建项目并关联 GitHub 仓库（框架预设选择 `None` / 静态，构建命令会自动读取 `edgeone.json`）。
2. 在项目 **存储 → Blob 存储** 中确认已开通 Blob（首次访问会自动创建存储空间）。
3. 在项目 **设置 → 环境变量** 中配置以下变量并**重新部署**：

| 变量名 | 必填 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `ADMIN_PASSWORD` | 是 | - | `/admin.html` 后台登录密码 |
| `ADMIN_SESSION_SECRET` | 推荐 | 回退使用 `ADMIN_PASSWORD` | HMAC-SHA256 Cookie 签名密钥 |
| `BLOB_STORE_NAME` | 否 | `eocount-data` | EdgeOne Blob 存储空间名称 |
| `ALLOWED_DOMAINS` | 推荐 | 空（放行全部） | 允许统计的域名白名单，逗号分隔，支持通配符（如 `*.example.com`） |
| `FILTER_BOTS` | 否 | `true` | 是否过滤常见爬虫/脚本（命中时只读不递增） |
| `AUTO_MIGRATE_BUSUANZI` | 否 | `false` | 首次访问某站点/页面时是否尝试从不蒜子拉取历史基数 |

4. （可选）在 **域名管理** 中绑定自己的已备案自定义域名（如 `eocount.example.com`），即可免签名 Token 直接使用。

## 从 Vercount / 不蒜子迁移

- **从不蒜子迁移**：直接把原有 `busuanzi.ibruce.info` 脚本替换为 Eocount 的 `/js` 脚本地址；如需自动继承旧基数，可开启 `AUTO_MIGRATE_BUSUANZI=true`。
- **从 Vercount 迁移**：在后台 `/admin.html` → **备份** 中使用简化 JSON 格式批量导入历史数据（支持选「取较大值合并」）：
  ```json
  {
    "items": [
      { "url": "https://blog.example.com/", "site_pv": 25599, "site_uv": 9402 },
      { "url": "https://blog.example.com/posts/hello", "page_pv": 1200 }
    ]
  }
  ```

## 本地开发与调试

```bash
npm install
npm run build
npm run validate
npx edgeone makers dev
npm run preview
```

## 开源协议

[MIT](LICENSE)
