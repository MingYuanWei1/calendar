# 运行与部署

## 本地运行

要求 Node.js 24.13+。本项目使用 Node 自带 SQLite；无需单独安装数据库。

```sh
npm ci
cp .env.example .env
npm run admin:create -- --generate
npm start
```

访问 `http://localhost:3000`。随机管理员凭据写入 `.data/admin-login.txt`，文件权限为仅当前用户可读写；请妥善保管，不要提交或分享该文件。首次数据库为空，不自动发布测试事件。

配置 `.env` 中的学校名称、中英文名称、学校时区和站点地址。默认时区为 `Asia/Shanghai`，是可修改的初始值，不代表已确认学校所在地。`APP_ORIGIN` 必须与浏览器所用地址完全一致（包括端口），避免将 `localhost` 与 `127.0.0.1` 混用。

管理员密码需要 12–256 个字符；账号限 3–64 个英文字母、数字或 `_.-`。执行同一初始化命令会重置账号密码并注销其旧会话。如需设置自选密码，可在终端安全读入，不要把密码直接写入命令历史：

```sh
read -s -p 'New administrator password: ' ADMIN_PASSWORD
export ADMIN_PASSWORD
npm run admin:create
unset ADMIN_PASSWORD
```

登录有效期 8 小时。没有自助注册或邮件重置；通过受控服务器终端重置管理员。学生端无需账号。默认以单个管理员使用；如确有需要，可设置 `ADMIN_USERNAME` 创建其他账号，权限相同。

## 服务器部署

本版本适合单台有持久磁盘的 Node 主机。准备域名与 HTTPS 反向代理，将其转发至回环地址 `127.0.0.1:3000`；配置 `NODE_ENV=production` 和正确的 HTTPS `APP_ORIGIN`。HTTPS 环境会启用 Secure 会话 Cookie。若反向代理来自本机回环地址，设置 `TRUST_PROXY=loopback`，并让代理覆盖 `X-Forwarded-For` 为真实客户端地址；其他拓扑应填写受信代理的精确 IP／网段，不要信任任意来源。未配置时忽略转发头。这样登录限速按真实客户端区分，避免所有访客共享代理地址。不要将数据库放在临时文件系统，或运行多个共享不同磁盘的实例。

可使用 systemd、平台进程管理器或 Docker 保持进程运行。Docker 构建文件已提供，数据必须挂载至 `/data`。例如：

```sh
docker build -t school-calendar .
docker volume create calendar-data
docker run --rm -v calendar-data:/data -e APP_ORIGIN=https://calendar.example.org school-calendar node scripts/admin.mjs --generate
docker run -d --name school-calendar --restart unless-stopped -p 127.0.0.1:3000:3000 -v calendar-data:/data -e APP_ORIGIN=https://calendar.example.org -e SCHOOL_TIMEZONE=Asia/Shanghai school-calendar
```

域名是占位，须替换。凭据位于该数据卷的 `admin-login.txt`，使用服务器的受控终端读取。Docker 路径未在本机执行容器验收；本轮已验收原生 Node 运行方式。未部署任何公网服务。

## 数据与备份

`DATA_DIR` 保存数据库、WAL 文件、图片及本地管理员凭据。图片上传后重新编码为 WebP，限制单张 5 MB、4000 万像素。未被已发布事件引用的图片只向已登录管理员提供；草稿与未保存上传不公开。

```sh
npm run backup
```

备份输出到 `backups/<时间>/`，包含一致的 SQLite 快照和图片。快照先生成，图片随后复制；图片不自动删除，保证快照引用的文件可用。备份包含账号密码哈希和会话，按私密数据保管。长期使用时可定期备份并监控磁盘占用；未引用图片目前保留，不自动清理。

恢复时先停止网站，保留当前数据目录作为回滚副本，将备份中的 `calendar.sqlite` 和 `media/` 复制到一个新的数据目录，更新 `DATA_DIR` 后启动。不要把旧的 `-wal`／`-shm` 文件混入新目录。恢复后建议重新运行管理员初始化命令使备份中的会话失效。

## 验证与参考

`npm test` 运行真实 HTTP 集成场景，临时数据库在结束后删除；`npm run typecheck` 检查正式前端与历史设计稿。浏览器记录见 `tests/production.md`。

实现参考：[Node.js SQLite API](https://nodejs.org/download/release/v24.16.0/docs/api/sqlite.html)、[Express 安全指南](https://expressjs.com/en/advanced/best-practice-security.html)。
