# GitHub 日历参考调研

调研日期：2026-09-19。以下是有公开源码的日历组件及官方演示，适合作为交互与布局参考；不将其误认为具备学校权限、发布流程、事件存储的成品后台。

| 项目 | 已核实的能力 | 本项目可参考的部分 | 适配判断 |
| --- | --- | --- | --- |
| [FullCalendar](https://github.com/fullcalendar/fullcalendar) | 月历网格、事件展示；dayMaxEvents 可限制每格可见事件数并显示更多入口 | 密集月历、跨日条、溢出入口 | 优先作为将来开发时的月历行为参考，本轮不选定技术栈 |
| [TOAST UI Calendar](https://github.com/nhn/tui.calendar) | 月／周／日视图，事件详情与创建弹层 | 分类颜色、日期导航、点击查看详情 | 最接近经典日历方案的交互参考；我们使用右侧面板，并隐藏浏览端编辑能力 |
| [Schedule-X](https://github.com/schedule-x/schedule-x) | 响应式、多语言、可扩展日历组件 | 轻量排版、柔和表面、语言切换 | 适合简约方向参考；具体插件是否属于 Premium 应逐项核查 |

## 来源与许可证

- FullCalendar 核心仓库标注 MIT：[仓库许可证](https://github.com/fullcalendar/fullcalendar/blob/main/LICENSE.md)。标准包和 Premium 的许可不能混用；本次不使用 Premium 代码。[溢出行为文档](https://fullcalendar.io/docs/dayMaxEvents)。
- TOAST UI Calendar 仓库标注 MIT：[仓库](https://github.com/nhn/tui.calendar)。[官方演示](https://ui.toast.com/tui-calendar/)已在浏览器中检查月历视觉；[入门文档](https://github.com/nhn/tui.calendar/blob/main/docs/en/guide/getting-started.md)说明详情弹层、创建表单及 usageStatistics 配置。
- Schedule-X 开源仓库标注 MIT：[仓库](https://github.com/schedule-x/schedule-x)。[官方站点](https://schedule-x.dev/)列出语言、响应式特性及单独的 Premium 插件。

## 设计结论

采用成熟的七列月历、跨日条、更多事件入口与详情面板。学校场景以“事件类型”和“适用学部”为两组独立信息，不继承私人日历的邀请、个人任务、拖拽排期与参与人头像。

三套方向采用相同的示例月份与事件数据，不直接复制任何仓库源码或品牌资产。当前设计文件无需安装上述依赖。此处是设计参考选择，不是最终开发框架选型。
