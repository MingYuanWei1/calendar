# 学校公共校历 · 静态交互设计

打开 [设计评审入口](designs/index.html)。已选 C「轻盈分区」：左侧学部／类型筛选，无小日历。A、B 仅作历史对照。

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

浏览 `http://127.0.0.1:8765/designs/`。无需构建或运行时依赖；直接打开 HTML 也可浏览。

- 学生端：月历／日程、筛选、搜索、中英切换、详情、海报放大和外部报名入口。
- 右上角“管理事件”：演示登录→新增→草稿→预览→发布；支持双语、四种时间形式、多学部、媒体、改期、取消及确认删除。
- [扩展场景](designs/calendar.html?theme=airy&scene=extended)：跨周密集日期、长标题、英文缺省、不同媒体组合与加载失败；默认 19 项基准数据保持不变。

所有数据均虚构。“今天”固定为 2026-09-19；后台仅操作当前页面内存，刷新重置，不接账号、数据库或真实报名服务。示例二维码与链接指向 `https://example.org/?demo=school-calendar`，不代表报名成功。海报为本项目制作的示例排版。

开发检查：`npm ci && npm run typecheck`。二维码资产已提交，不需运行时生成；重建命令：

```sh
node -e "require('qrcode').toFile('designs/assets/registration-qr.svg','https://example.org/?demo=school-calendar',{type:'svg',margin:4,errorCorrectionLevel:'M'})"
```

浏览器验收路径与结果见 [tests](tests/README.md)，测试范围为学生与管理员可见交互，不调用内部函数。

- [完整规格](docs/feature-spec.md) · [GitHub Issue #1](https://github.com/MingYuanWei1/calendar/issues/1)
- [术语](CONTEXT.md) · [产品方案](docs/product-spec.md) · [调研记录](docs/github-research.md)
