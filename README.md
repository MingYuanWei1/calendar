# 学校公共校历 · 设计阶段

打开 [三套设计方向](designs/index.html)，在顶部切换经典日历、校园公告、轻盈分区。也可以直接用浏览器打开该文件，无需安装依赖。

可比较电脑与手机排版，并演示事件详情、类型／学部筛选、搜索、日程列表、中英切换、当天事件溢出、取消与改期状态。数据均为虚构，演示日期固定为 2026-09-19；报名入口只展示说明。

- [已确认需求](docs/requirements.md)
- [后续设计规格](docs/feature-spec.md) · [GitHub Issue #1](https://github.com/MingYuanWei1/calendar/issues/1)
- [术语](CONTEXT.md)
- [产品方案](docs/product-spec.md)
- [GitHub 参考调研](docs/github-research.md)
- [三套视觉设计说明](docs/design-plan.md)

本阶段不连接真实数据，不包含可运行后台。选定视觉方向后继续设计其余页面。

本地预览可在项目目录运行：

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

然后打开 `http://127.0.0.1:8765/designs/`。
