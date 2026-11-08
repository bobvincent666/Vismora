# 上游同步与本地验证记录

日期：2026-11-08。

## 同步范围

- 上游：`https://github.com/anhao/ai-pose-gallery-zh`，分支 `main`。
- 原基线：`19ea0e586b32f8cac588b6fdfbed4cfd15db05b7`。
- 更新后基线：`488939139c69acfe078372b39d4bd0c457dc060e`，包含上游新增的 49 个提交。
- 同步后再次查询远端，确认远端与本地 HEAD 一致。
- 已保留本地的人物 B、可选女士服装、动态图片输入校验、云端异步图片接口及电商教程。没有创建额外提交。
- 已合并新版深度参考图、工作流高级参数、任务进度跟踪、刷新恢复与历史参考对比。

## 恢复方式

同步前的 24 个本地修改及未跟踪文件已复制至项目同级目录 `ai-pose-gallery-backup-20261108-pre-sync`，该目录有恢复说明。Git 中另保留名为 `pre-upstream-sync-20261108` 的 stash。当前修改保留在工作区，暂存区为空。

## 验证结果

- `corepack pnpm install --frozen-lockfile`：通过。
- `corepack pnpm build`：通过。
- `corepack pnpm lint`：通过。
- `node --test`：21 项通过，无失败。
- `git diff --check`：通过；Git 中无未解决冲突。
- 工作台页面返回 HTTP 200；本地 ComfyUI 连接成功。
- 在独立测试浏览器中导入 `docs/ecommerce-workflows/two-person-optional-womens-clothing.api.json`，上传姿势、人像和人物 B，未上传服装，实际完成一次本地生成。
- 核对实际提交数据：姿势对应节点 11、人像对应节点 12、人物 B 对应节点 13，可选服装节点 15 在未上传时移除。
- 生成期间刷新页面，页面恢复原任务并显示结果，未重复提交。任务 ID：`a8a34c82-d74d-4d2d-996a-b5f039d35e97`。
- 未调用收费云端服务；云端接口通过模拟请求验证上传、提交、查询和失败处理，不代表已验证真实账号额度或服务商可用性。

本次实际生成用于确认同步后的链路、图片映射和任务恢复正常，不代表所有姿势或不同种子均能精确还原。
