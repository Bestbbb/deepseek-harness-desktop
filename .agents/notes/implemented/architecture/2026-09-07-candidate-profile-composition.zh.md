# Agent Note: Candidate Profile composition before runtime activation

Status: implemented

[English](2026-09-07-candidate-profile-composition.md) | 中文

## 问题

已安装的依赖候选不能证明其 Bundle 补丁能与现有用户配置组合。在活动 Profile 上检查可能修改运行中的应用。复制包链接时若不保留解析上下文，也可能使候选误读原依赖，或无法解析传递导入。

## 决策

可选的[操作历史](2026-09-07-preparation-operation-history.zh.md)保留组合观测，不改变 Profile 验证或授予启用权限。

可选的 [Bundle 准备服务](../../../../packages/desktop/bundle-preparation/README.zh.md) 在重新安装审核文件后提供 `prepareComposition()`。它把部署指定的 Profile 复制到独立 Harness 主目录，保留用户清单字段及 Bundle 顺序，覆盖候选包，并离线刷新 Profile 锁文件。内部链接指向复制树；外部链接被实体化，受条目数及字节数限制。文件复制请求文件系统写时复制，不共享可写内容。候选仅在启动时加载补丁，并复制全局补丁，不复制 Session 存储。

验证先检查配置的 dsh 版本，再调用其正常的不启动插件的 `--dump-config` 命令。它不启动插件，也不求值 `!!js`。准备期间源清单/Profile 补丁/全局补丁发生变化会拒绝结果。成功的 `composition-checked-not-enabled` 回执记录独立 Profile、锁文件、转储及源配置指纹。操作共享安装器的截止时间、限量输出及受管理进程退出等待；失败只移除其候选目录。

上游 Bundle 解析器必须选择审核候选的包目录。安装目录中存在同名包时，准备流程在排队前失败，因为安装目录优先的解析器否则会校验并启动不同代码。因此，市场产物与默认运行时依赖图保持分离。

## 考虑过的替代方案

**直接从活动 Profile 卸载。** 因与活动安装相同的任务保护理由而拒绝。卸载使用共享的复制与组合验证器，保留原代际及插件数据。它要求观测到的活动 Profile、精确包版本，以及解析到该 Profile 内部的直接依赖；源清单和复制清单都需检查。独立卸载回执与历史记录避免声称已安装代码来自当前审核目录条目。原生队列确认仍与准备成功分离。

**验证前修改活动 Profile。** 拒绝，因为配置重载和安装失败可能影响用户当前任务。

**实现另一套补丁求值器。** 拒绝，因为现有 dsh 转储无需执行插件代码就能组合实际 Bundle 层。并行维护另一套语义会使检查成功变得不可靠。

**改变上游 Bundle 解析优先级。** 拒绝，因为安装目录优先可使内置 Bundle 与运行中的 Harness 保持一致。可选市场产物使用 Profile 本地安装，不改变此规则。

**让所有候选依赖指向原安装。** 拒绝，因为后续源修改会改变候选。内部 pnpm 链接改为在副本中保留相对包解析上下文。

## 后果

[打包冒烟测试](../../../../apps/desktop/scripts/smoke-plugins.mjs) 通过真实 dsh 启动器独立启动生成的候选，在验证 Host/浏览器贡献后，再测试原 Profile 的现有安装/移除路径。单元测试约束复制、内部依赖解析、源编辑拒绝、复制限制、CLI 版本错误、取消及清理。原生 Windows/WebView 验收和任意外部依赖布局仍是独立的平台与兼容性工作。

这只是配置组合证据，不是健康检查或启用授权。它不是全部源模块的原子快照，也不重写用户配置中的绝对路径。候选目录可能包含私有配置，不得作为公开诊断。持久操作恢复、任务空闲准入、生产 Profile 切换、回退和市场 UI 在[市场提案](../../proposed/architecture/2026-09-06-desktop-plugin-marketplace.zh.md)中仍未完成。[离线候选决策](2026-09-06-offline-bundle-candidates.zh.md) 仍负责仅依赖准备。
