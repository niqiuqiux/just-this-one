# 免费部署与后端选型

这份项目选择 **Supabase Free（账号 + PostgreSQL 数据库）+ Cloudflare Pages Free（前端）**。不需要租 VPS，也不需要运行自己的常驻后端。当前项目已完成真实云部署。浏览器通过 Pages 的同域 API 转发访问 Supabase，避免必须从客户端直连另一个服务域名。


## 本项目当前部署

- 正式站点：**https://just-this-one.pages.dev**。
- Cloudflare Pages 项目：`just-this-one`，当前使用 **Direct Upload**；本次上传的是本机已验证的 `dist`，不是 Git 自动构建。后续修改本地文件或推送 Git 不会自动改变这个站点。
- Supabase 项目：`bmblecralbtiwmgfsmim`，数据库迁移 `20261101102105_workspaces.sql` 已应用。
- 登录信息保存在项目本机的 `.account-credentials.local`（文件权限 600，Git 忽略），不放入站点或仓库。
- `/api/supabase/*` 由 `public/_worker.js` 转发，只有登录、退出、当前用户、读取工作区和版本化写入这几条接口。用户令牌透传给 Supabase 验证；代理没有 service-role key，也不会缓存登录或数据响应。
- `public/_routes.json` 让静态资源避开 Functions，只有 API 请求计入 Workers 免费额度（当前每天 100,000 次，与账号其他 Workers 共享）。
- 账号初始化使用的 `setup-owner` 辅助 Edge Function 已停用：当前代码只返回 410，且启用了 JWT 验证。日常登录和同步不使用它；可在 Supabase Functions 控制台删除这个辅助函数。

重新部署可使用 Cloudflare MCP，或先运行 `npm run build`，再用已登录的 Wrangler 执行：

```bash
npx wrangler pages deploy dist --project-name=just-this-one
```

Pages 的生产与预览环境已配置 `SUPABASE_URL` 和 `SUPABASE_PUBLISHABLE_KEY`，均为公开项目配置，不是数据库密码或服务端管理密钥。

## 为什么选它

目标是个人使用、少量文字、手机与电脑同步。Supabase 自带账号认证和数据库访问控制，维护量小，也方便将来导出 PostgreSQL 数据。前端仍然是普通 Vite 静态网站，可以换托管商。

以下信息核对于 **2026-11-01**；免费额度和政策以服务商当时公布的内容为准，不能视为永久不变的承诺。

| 方案 | 免费能力与限制 | 对这个项目的适用性 |
| --- | --- | --- |
| **Supabase Free** | 500 MB 数据库、5 GB 出站流量、50,000 月活用户，最多 2 个活跃免费项目；闲置约一周可能暂停 | 推荐。登录和数据隔离现成，个人文字记录用量低；暂停后需在控制台恢复 |
| **Cloudflare Workers + D1** | Workers 每天 100,000 请求；D1 每天 500 万行读取、10 万行写入、共 5 GB 存储 | 免费额度足够，但要自己维护认证和接口；本次没有同时引入第二套后端 |
| **Appwrite Cloud Free** | 免费组织支持最多 2 个项目；超出资源限制会限制服务，需要等待额度重置、减少资源或升级 | 功能完整的备选；需换用它的 SDK 和数据库权限模型 |
| **Firebase Spark** | Firestore 1 GiB 存储、每天 50,000 次读取 / 20,000 次写入；云函数不在 Spark 免费方案内 | 有离线数据能力，但大陆网络访问需要重点测试，本次不选 |
| **腾讯云 CloudBase** | 当前产品页展示新用户免费体验，个人版体验后 19.9 元/月 | 国内托管候选，但不满足持续免费这个前提 |
| **VPS** | 普通 VPS 需要持续付费；部分厂商的促销或免费实例还需考虑资格、可用区和回收政策 | 自主性高，但要维护系统、证书、备份和认证，不适合这次“少量后端 + 免费”的目标 |

**大陆访问**：国外免费服务不能保证国内各地区、各运营商的速度。建议后端选择可用的亚洲区域（如新加坡或东京），并用实际手机网络和家庭宽带分别验证页面、登录和同步。前端可访问不代表后端一定可访问，两部分都需要测。若免费域名或跨境链路不能满足日常使用，要在免费条件、线路和托管地点之间重新取舍。

官方资料：

- [Supabase 定价](https://supabase.com/pricing)、[可用区域](https://supabase.com/docs/guides/platform/regions)、[免费项目暂停说明](https://supabase.com/docs/guides/platform/going-into-prod)
- [Cloudflare Workers 定价](https://developers.cloudflare.com/workers/platform/pricing/)、[D1 定价](https://developers.cloudflare.com/d1/platform/pricing/)
- [Appwrite 免费方案](https://appwrite.io/docs/advanced/billing/free)
- [Firebase 定价](https://firebase.google.com/pricing)
- [CloudBase 产品与套餐](https://cloud.tencent.com/product/tcb)

## 1. 创建免费后端

1. 在 [Supabase](https://supabase.com/dashboard) 创建 **Free** 组织和项目，选择可用的亚洲区域。无需为了此项目升级 Pro。
2. 打开 **SQL Editor**，执行仓库里的 [数据库迁移](../supabase/migrations/20261101102105_workspaces.sql)。这是建表、权限策略和同步函数，不会导入示例记录。
3. 在 **Authentication → Users → Add user / Create new user** 创建自己的邮箱密码账号，选择确认邮箱（Auto Confirm User）。本项目面向个人使用，界面提供登录，不开放自行注册。
4. 在 Authentication 设置中关闭允许新用户自行注册，保留邮箱密码登录。以后新增账号由你在控制台创建，各账号的数据相互独立。

这样不依赖短信，也不需要配置邮件发送服务。Supabase 自带邮件服务只适合测试：默认仅发往项目团队成员，且有严格的频率限制。以后要开放公众注册、邮件验证或找回密码，需另行配置 SMTP 和对应页面。个人账号忘记密码时，可由项目管理员在控制台管理用户；当前版本没有前台找回密码功能。

参考：[Supabase 邮件服务限制](https://supabase.com/docs/guides/auth/auth-smtp)。

## 2. 配置本地项目

使用 Node.js **22.18 或更高版本**。

```bash
npm install
cp .env.example .env.local
```

在 Supabase 项目的连接面板 / Project Settings → API 中找到项目 URL 与 **publishable key**（或旧版 `anon` key），填入 `.env.local`：

```dotenv
VITE_SUPABASE_URL=https://你的项目标识.supabase.co
VITE_SUPABASE_ANON_KEY=你的_publishable_或_anon_key
VITE_SUPABASE_PROXY=true
```

项目地址与 API key 是浏览器公开配置；数据库权限由登录身份与 RLS 控制。**不要填写 `service_role`、secret key、数据库密码或管理 API token。** 它们不能出现在前端构建产物中。`.env.local` 已被 Git 忽略。

```bash
npm run dev
```

打开页面 → 右上角头像或侧栏“使用与数据” → 登录。原浏览器有自己的记录时，可以勾选合并到账号。未修改的示例不会上传；原本机记录仍保留。

没有配置环境变量时，网站继续作为本地工具运行，“账号与数据”会说明云同步尚未开启。修改环境变量后要重启开发服务；线上构建也必须重新执行。

## 3. 免费托管前端

以 [Cloudflare Pages Git 集成](https://developers.cloudflare.com/pages/get-started/git-integration/) 为例：

1. 将项目放到自己的 Git 仓库，在 Cloudflare 创建 Pages 项目并连接仓库。
2. 构建命令：`npm run build`；构建输出目录：`dist`；项目根目录保持仓库根目录。
3. 在构建环境变量中设置 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`、`VITE_SUPABASE_PROXY=true`，以及 `NODE_VERSION=22`（平台需提供 22.18+）。在 Pages 的生产和预览运行环境中，另设置 `SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY` 供同域转发使用（与前述公开值相同）。
4. 部署后使用 Pages 提供的免费 HTTPS 域名访问。无需购买域名；自有域名是可选项。
5. 手机和电脑打开**同一站点地址**，登录同一个账号。

仓库提供 `_worker.js`、`_routes.json`、`_headers` 和 `_redirects`，Vite 构建时会自动复制到 `dist`。Pages 会使用高级模式运行同域 API 转发；不需要 D1 或付费 VPS。如果换到只有静态文件托管能力的平台，将 `VITE_SUPABASE_PROXY` 设为 `false` 后重新构建，让浏览器直连 Supabase，并重新验证访问效果。

上线验收：

1. 电脑新增一条想法，手机打开页面或点击“立即同步”，能看到它。
2. 手机把它加入任务池、完成或恢复，电脑检查相应状态。
3. 在已打开的页面中断开网络，继续记录，联网后确认待同步状态消失。
4. 使用另一个账号，确认看不到第一个账号的记录。
5. 导出一份 JSON 备份，再检查真实网络下登录和同步是否稳定。

## 同步和容量边界

- 未登录的数据使用原来的 `yaoyaole.workspace.v1` 存储，旧版本记录可直接读取。
- 登录账号按项目和用户分开缓存。修改先写本机，600ms 后上传；可见页面每 30 秒检查更新，切回页面、回到前台或恢复网络也会检查。未更新时只返回空结果，避免反复下载整份记录。
- 同步想法、分类、耗时、任务池状态、完成状态以及正在专注的任务；搜索、页面和临时候选勾选保留为设备内状态。
- 云端以账号为单位存储快照，并使用事务内版本检查。两个设备改了不同记录会合并；同一条记录有不同编辑时保留云端版本，并将本机版本另存为“同步副本”。删除遇到另一端的编辑时保留编辑内容，避免静默丢失。
- 每份账号数据限制为 **5,000 条记录、5 MiB JSON 文本**。适合个人想法清单，不适合附件或大规模协作。达到限制时保留本机内容并提示导出整理。
- 浏览器存储也有容量限制；账号缓存会保存当前数据和上次同步基线。存储异常会明确提示，不能把这种状态当作已安全保存在本机。
- 断网记录指已打开页面内的操作及本机缓存；本次没有增加 Service Worker，不保证完全断网时首次打开或刷新网站也能加载。
- 同步未完成时禁止退出账号，避免丢掉尚未上传的修改。同步完成后退出会清除此账号的本机副本，云端和登录前的本地工作区保留。
- JSON 备份仍应定期导出；云同步不能替代备份，免费项目也不提供可下载的自动数据库备份保障。

## 数据隔离与验证

`workspaces.user_id` 关联 Supabase Auth 用户。RLS 只允许读取自己的工作区；浏览器不能直接插入、修改或删除表，只能调用 `save_workspace`。公开 RPC 是 SECURITY INVOKER 包装层，特权写入逻辑位于未暴露的 `private` schema。函数从已验证的登录身份取得用户 ID，同时校验请求中的预期账号，以免账号切换期间旧请求把内容传给新账号。

```bash
npm run typecheck
npm test
npm run build
```

自动化测试使用本地 PostgreSQL 引擎 PGlite 执行真实迁移，验证权限和事务版本逻辑；同步测试验证双设备编辑、离线缓存恢复、丢失响应重试、账号切换、删除恢复和多标签页合并。测试不需要云账号，也不产生云费用。本次部署已验证真实浏览器登录 / 同步 / 退出、390px 手机布局、两组独立会话间的新建 / 完成同步、过期版本拒绝及测试记录清理；手机运营商和家庭网络的日常效果仍需实际使用验证。

### 本次检查的剩余平台限制

Supabase 安全顾问提示未启用泄露密码检测。官方将该功能限制在 Pro 及以上套餐，因此本次维持免费方案，没有升级。初始密码使用独立随机值。参考：[密码强度与泄露密码保护](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)。

站点和同域转发都不开放注册或管理接口。Supabase 项目级“允许新用户注册”开关不由当前 MCP 控制；如果只供个人使用，可以在 Authentication 控制台关闭此开关。直接访问 Supabase 的用户仍受数据库 RLS 与函数身份校验保护。
