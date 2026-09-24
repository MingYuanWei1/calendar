# 项目任务跟踪

GitHub 仓库：https://github.com/MingYuanWei1/calendar

规格为 Issue #1，实施任务为 #2–#7。可领取任务使用 `ready-for-agent` 标签；先读取 GitHub 原生阻塞关系，再开始未被阻塞的任务。

学生身份匹配、我的考试初始化及座位变更提醒规格为 [Issue #8](https://github.com/MingYuanWei1/calendar/issues/8)，本地规格为 `docs/student-exam-matching-spec.md`，标记为 `ready-for-agent`。

该规格的实施任务均已标记 `ready-for-agent`，并设置 GitHub 原生阻塞关系：

| 任务 | 阻塞任务 |
| --- | --- |
| [#9 手工录入学生并关联考试座位](https://github.com/MingYuanWei1/calendar/issues/9) | 无 |
| [#10 从表格和 LLM 提取结果整理学生](https://github.com/MingYuanWei1/calendar/issues/10) | #9 |
| [#11 管理员解决学生身份冲突](https://github.com/MingYuanWei1/calendar/issues/11) | #9 |
| [#12 学校邮箱登录后初始化我的考试](https://github.com/MingYuanWei1/calendar/issues/12) | #9 |
| [#13 考试详情定位本人考场并高亮座位](https://github.com/MingYuanWei1/calendar/issues/13) | #12 |
| [#14 新增关联考试弹窗与自主导入](https://github.com/MingYuanWei1/calendar/issues/14) | #12 |
| [#15 已选考试的座位变更提醒](https://github.com/MingYuanWei1/calendar/issues/15) | #12 |

实施任务正文引用父规格 #8；发布拆分任务时未修改或关闭父 Issue。领取时以 GitHub 当前原生阻塞关系和任务状态为准。

读取任务正文与评论可使用 GitHub CLI。对代码进行规格审查时，使用已发布任务的验收标准与本地 feature-spec 文档；用户后续确认的修订优先。
