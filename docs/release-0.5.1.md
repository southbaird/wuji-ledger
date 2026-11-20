## Wuji Ledger · 物迹账本 0.5.1

根据 Obsidian 社区目录的命名要求，将市场显示名称改为 **Wuji Ledger**。插件内的中文界面、功能与数据格式保持不变。

本 GitHub Release 不代表已通过社区目录审核。

### 安装

下载同一版本的 `main.js`、`manifest.json`、`styles.css`，放入 vault 配置目录的 `plugins/wuji-ledger/`，然后在第三方插件中启用 **Wuji Ledger**。默认配置目录为 `.obsidian`。

升级时仅覆盖三个文件，保留 `data.json`、`data.backup.json`、`assets/user/` 和手动安装的 `native/`。

`wuji-cutout` 是可选的 Mac 抠图组件，不属于基础安装。需要时请按 [安装说明](https://github.com/southbaird/wuji-ledger/blob/main/docs/mac-cutout.md) 手动安装；插件不会下载安装组件。本版本沿用 0.5.0 已验证的组件。

### 验证

- 本次名称修正通过构建、发布校验与官方 ESLint 规则检查。
- 实际发布文件通过隔离模拟宿主的桌面／移动端启动检查。
- 功能代码未变，沿用 0.5.0 的 188 项自动化测试结果；不代表手机真机验收。

文件校验值见 `SHA256SUMS.txt`。
