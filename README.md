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

学校名称、时区、数据目录和站点地址通过 `.env` 配置。默认 `Asia/Shanghai` 为可调整初始值。公网部署需 HTTPS、正确 `APP_ORIGIN` 和持久化磁盘；详见 [运行与部署](docs/deployment.md)。

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

管理员列表中的「放假与调休」可按日期范围设置全校放假、调休上课或恢复默认。日期安排独立于事件筛选，周一至周五默认工作日、周六日默认普通周末；不会自动导入法定节假日。样本命令也会添加明确标注的休假与调休日期。

### 考试安排

访问 `/exams.html` 查看考试批次，`/exams-admin.html` 管理场次、教室、Excel 座位导入和独立发布。运行 `npm run samples:exams` 添加虚构示例。

Microsoft 单组织 SSO、个人考试勾选、PDF 导出和管理员操作详见 [考试安排使用与部署](docs/exams-setup.md)。未配置学校租户时公开考试安排可用，学生登录功能会显示配置提示。
