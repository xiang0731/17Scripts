# LINUX DO 默认树形评论区

Tampermonkey 用户脚本，用于在访问 LINUX DO 的 Discourse 话题页时，默认打开树形评论区，并补齐树形视图下常用的导航和搜索能力。

当前版本：`1.6.8`

## 功能

- 自动把普通话题链接从 `/t/...` 改写为 `/n/...`，进入 Discourse 树形评论区。
- 保留用户主动进入平面视图的意图，包括“View as flat / 以平面方式查看 / 平面图查看”等链接。
- 访问树形话题页时恢复正确的浏览器标题，避免标题只显示站点名。
- 在树形话题页顶部搜索入口旁新增“本话题搜索”按钮。
- 支持通过 Discourse 搜索接口查找当前话题所有回复，包括尚未加载到页面里的回复。
- 搜索结果同时提供“嵌套查看”和“平面查看”，并可定位到对应楼层。
- 自动跳过不适合树形视图的话题，保持原始平面话题地址。

## 自动跳过的话题类型

脚本会读取 `/t/{topicId}.json` 的话题数据，以下类型不会改写到 `/n/...`：

- 私信话题：`archetype: private_message`
- Banner 话题：`archetype: banner`
- Post Voting / 问答投票话题：`is_post_voting` 或 `subtype: question_answer`
- 普通投票帖：首帖或帖子数据里包含 `polls` / `polls_votes` / `has_polls` 等投票字段

## 安装

1. 安装 Tampermonkey 或兼容的用户脚本管理器。
2. 新建用户脚本。
3. 复制 `LinuxdoComment.js` 的全部内容并保存。
4. 打开 `https://linux.do/` 的话题列表或话题页验证效果。

## 验证

```bash
node --test LinuxdoComment.test.js
node --check LinuxdoComment.js
```

## 版本记录

| 版本 | 改动 |
| --- | --- |
| `1.6.8` | 修复通知楼层跳转在 SPA 打开后又被强制滚动到页面顶部的问题；技术上区分整帖跳转和楼层跳转，带 `/n/.../postNumber` 的目标不再设置 `forceScrollTop`，而是重新排队执行楼层滚动。 |
| `1.6.7` | 修复通知页打开 `/n/.../postNumber` 后停留在页面顶端的问题；技术上从嵌套 URL 路径解析 `postNumber`，复用已有 `[data-post-number="..."]` 定位与 `scrollIntoView({ block: 'center', behavior: 'smooth' })` 滚动逻辑。 |
| `1.6.6` | 修复通知页进入树形视图后丢失目标楼层的问题；技术上将 `/t/slug/topicId/postNumber` 和 `/t/topicId/postNumber` 改写为对应的 `/n/.../postNumber?sort=old`，不再剥离楼层段。 |
| `1.6.5` | 修复通知页点击后由 Discourse SPA 直接路由到 `/t/...` 时不会继续切换到树形视图的问题；技术上在 `history.pushState`、`history.replaceState` 和 `popstate` hook 后重新执行话题嵌套重定向。 |
| `1.6.4` | 修复通知页、通知菜单及用户动态等数据驱动入口不会进入树形视图的问题；技术上除普通 `href` 外，额外识别 `data-url`、`data-href`、`data-topic-url`、`dataset.topicUrl`，以及通知页/用户动态中的 `data-topic-id`、`data-topic-slug`、`data-post-number` 字段，并在预检话题类型后跳转嵌套地址。 |
| `1.6.3` | 修复在树形话题 A 中点击跳转到话题 B 时，Discourse SPA 复用旧树形视图状态导致 B 的二级嵌套回复混入 A 的回复内容；技术上对树形页跨话题跳转使用硬导航，避免复用旧树形视图状态。 |
| `1.6.2` | 跳过 Discourse 不支持树形视图的特殊话题：私信、Banner、Post Voting / `question_answer`、普通投票帖；点击话题链接前增加话题 JSON 预检，发现不支持时保留 `/t/...` 平面地址；补充对应回归测试。 |
| `1.6.1` | 修复“以平面方式查看”等平面视图入口识别不完整，导致用户点击后仍被改写到树形视图的问题。 |
| `1.6` | 修复树形页标题恢复问题；进入话题前读取话题数据并记住标题；跳过私信话题；搜索结果支持嵌套/平面两种查看方式，并能定位到指定楼层。 |
| `1.5` | 新增话题内搜索面板，可在树形话题页搜索当前话题全部回复，并从结果跳转到匹配楼层。 |
| `1.4` | 初始版本：默认将普通 `/t/...` 话题链接改写到 `/n/...` 树形评论区；处理楼层尾缀和页面切换后的滚动位置。 |
