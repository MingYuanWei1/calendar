# 学校公共校历

面向学生的公开校历，沿用已确认的 C 方案：左侧学部与事件类型筛选、月历／日程、中英切换、事件详情；手机默认日程与全屏详情。管理员可真实登录、维护草稿、上传海报／二维码、发布、改期、取消和删除事件。

线上站点：https://calendar.keydion.com 。Cloudflare 架构、部署与管理说明见 [Cloudflare 部署](docs/cloudflare-deployment.md)。

## 启动

需要 Node.js 24.13+。

```sh
npm ci
cp .env.example .env
npm run admin:create -- --generate
npm start
```

打开 `http://localhost:3000`。管理员账号与随机密码保存于 `.data/admin-login.txt`，不进入版本控制。首次数据库为空；数据保存至 `.data/`，刷新和重启不会重置。

- `npm run typecheck`：正式前端与设计稿的类型检查。
- `npm test`：真实 HTTP 集成验收，包括认证、持久化、草稿隔离、媒体权限和事件状态。
- `npm run backup`：数据库一致性快照与图片备份。

时区、数据目录和站点地址通过 `.env` 配置。默认 `Asia/Shanghai` 为可调整初始值。公网部署需 HTTPS、正确 `APP_ORIGIN` 和持久化磁盘；详见 [运行与部署](docs/deployment.md)。

## 登录与账户权限

页头统一使用登录弹窗，支持 Microsoft 学校账号和本地账号密码。已登录时禁止再次打开登录弹窗或发起账号密码／Microsoft 登录（接口返回 409）；更换账户必须先退出。登录后点击账户头像打开菜单，管理入口按角色显示；role ≥ 2 显示「管理后台」，进入 `/console.html`。

每个账户持久保存数字 `role`：

| role | 名称 | 权限 |
| --- | --- | --- |
| 1 | reader | 浏览校历、考试及登录后的个人考试选择等基本功能 |
| 2 | moderator | reader 功能，以及事件、考试、学科、海报、放假与调休管理 |
| 3 | admin | moderator 功能，以及账户管理 |

管理页面在返回 HTML 前校验权限：未登录返回空响应 401，权限不足返回空响应 403，不展示管理页面或登录／权限提示；受限页面禁止缓存。本地与 Cloudflare Pages 使用相同规则。`/console.html`、`/students.html` 需要 role ≥ 2；控制台内的「账户」页及其接口需要 role = 3。

账户管理位于管理后台的「账户」页（`/console.html#accounts`），仅 admin 可访问账户数据、创建本地账户、调整角色、启用／停用及删除账户。删除会清除本地登录凭据、所有会话和个人考试选择，不能删除当前登录账户。Microsoft 账户删除后再次登录会按 reader 重新创建；需要阻止其登录时应停用账户。Microsoft 账户首次登录后自动加入，默认 `role=1`；由 admin 按需调整。当前登录的管理员不能降级或停用自己，系统至少保留一个可用管理员。

已有本地管理员账户在升级时自动迁移为 `role=3`，已有密码继续有效。首次安装仍通过 `npm run admin:create -- --generate` 初始化管理员；角色保存在 `accounts` 表，不从浏览器或 Microsoft 姓名字段推断。角色变更在下一次 API 请求生效，停用会撤销该账户已有会话。两种登录方式均使用最长 8 小时的会话，统一退出会清除两种会话。

## 管理后台

`/console.html` 集中管理事件、放假与调休、考试、账户（仅 admin 可见）和设置，界面采用 Industry 蓝图风格（Barlow 字体随项目部署于 `public/fonts/`）。地址栏 hash 对应页面，例如 `#events/new`、`#exams/<批次 id>`，刷新后保持所在页面。旧的 `/?manage=events` 会跳转到管理后台；`/exams-admin.html` 与 `/accounts.html` 已移除。

## 学校 Logo

校历与考试安排页面的页头统一读取固定地址 `/logo.png`，对应项目文件 `public/logo.png`。将学校 Logo 的 PNG 图片放到该位置即可，无需修改代码；建议使用透明背景的正方形图片，显示时会保持比例。

当前未附带学校 Logo 图片；文件不存在或加载失败时，继续显示 `LOGO` 文字占位符。替换图片后刷新页面；线上站点需将文件随项目重新部署，若仍显示旧图可强制刷新浏览器。

## 文档

- [成品版范围](docs/production-spec.md) · [成品验收记录](tests/production.md)
- [术语](CONTEXT.md) · [已确认产品方案](docs/product-spec.md)
- [历史静态设计评审](designs/index.html) · [原静态规格](docs/feature-spec.md) · [调研记录](docs/github-research.md)

历史设计稿仍可通过独立静态服务器查看；正式服务只提供 `public/`，不公开源码、历史示例或数据目录。报名由外部渠道承办，本网站不保存报名信息。

## 样本事件

执行 `npm run samples` 为学校时区的当前月份和下个月加入 26 项双语示例：24 项公开事件（含取消／改期状态）和 2 项管理员草稿。所有事件明确标注为虚构示例。重复执行同一月份不会覆盖已有记录或重复导入；可用 `npm run samples -- --month=2026-09` 指定月份。示例仅在显式运行命令时添加，可在后台逐项编辑或删除。

管理后台的「放假与调休」页在月历中点选开始、结束日期，可按日期范围设置全校放假、调休上课或恢复默认。日期安排独立于事件筛选，周一至周五默认工作日、周六日默认普通周末；不会自动导入法定节假日。样本命令也会添加明确标注的休假与调休日期。

### 考试安排

访问 `/exams.html` 查看考试批次，管理后台的「考试」页（`/console.html#exams`）管理批次、场次、教室座位图（可拖动换位）、Excel 导入、LLM 提取和独立发布；每次修改即时保存为草稿并可撤销。运行 `npm run samples:exams` 添加虚构示例。

Microsoft 单组织 SSO、个人考试勾选、PDF 导出和管理员操作详见 [考试安排使用与部署](docs/exams-setup.md)。未配置学校租户时公开考试安排可用，学生登录功能会显示配置提示。
