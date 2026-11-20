## 物迹账本 0.5.0

首次公开发布。本 GitHub Release 不代表已通过 Obsidian 社区目录审核。

### 功能

- 本地物品与配件台账，买卖价格、使用天数、日成本和资产统计。
- 画廊、编辑表格、主题、贴纸收藏、图片分享与随身看板。
- 拖动卡片快捷归档，拖入或粘贴图片快速添加。
- 新安装为空台账，不包含作者记录、商品封面或私人截图。

### 安装

将本页的 `main.js`、`manifest.json`、`styles.css` 放入 vault 配置目录的 `plugins/wuji-ledger/`，然后在 Obsidian 第三方插件中启用。默认配置目录为 `.obsidian`。

升级时只覆盖这三个文件，保留 `data.json`、`data.backup.json`、`assets/user/` 和已经手动安装的 `native/`。字体已经内嵌，汇总使用宿主图标，不需要下载额外图片。

### 可选 Mac 抠图组件

`wuji-cutout` 不是基础安装必需文件，插件不会自动下载安装。需要 Mac 自动抠图时，按照 [安装说明](https://github.com/southbaird/wuji-ledger/blob/main/docs/mac-cutout.md) 手动安装。

要求 macOS 14+，通用二进制支持 Apple Silicon 与 Intel；采用本地 ad-hoc 签名，未宣称 Apple 公证。其他平台仍可使用普通封面和现成贴纸。

### 验证

- 32 个测试文件、188 项自动化测试通过。
- 类型检查和官方 ESLint 规则通过。
- 三文件发布校验，以及隔离模拟宿主中的桌面／移动端启动检查通过；这不等同于 iPhone 真机验收。
- Mac 组件通过架构、签名验证和本机 `--check` 检测。

文件校验值见 `SHA256SUMS.txt`。插件采用 MIT；Bloub 的 MIT 与得意黑的 OFL 许可在源码与发布文件中保留。
