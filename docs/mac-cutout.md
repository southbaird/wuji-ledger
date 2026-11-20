# 可选 Mac 抠图组件

基础插件不需要这个组件。只有需要在插件里调用 Apple Vision 自动去除图片背景时才安装；普通封面、现成贴纸和分享功能都可以直接使用。

要求：macOS 14 或更高版本、Obsidian 桌面版。组件兼容 Apple Silicon 与 Intel。

1. 从本仓库对应版本的 Release 下载 `wuji-cutout`；或从公开 Swift 源码自行构建。
2. 在插件目录 `wuji-ledger` 内创建 `native` 文件夹，将文件放为 `native/wuji-cutout`。
3. 在终端为这个明确的文件增加执行权限：`chmod u+x "/完整路径/native/wuji-cutout"`。
4. 重新启用插件。封面表单会出现「转为贴纸」入口。

组件只带本地 ad-hoc 签名，不宣称经过 Apple 公证。如果 macOS 拦截下载的可执行文件，请先核对公开源码与 Release 校验值，再通过系统提供的确认流程处理；不要全局关闭 Gatekeeper。也可以直接在自己的 Mac 上从源码构建。

```sh
npm ci
npm run build:native
```

构建结果为 `dist/native/wuji-cutout`。需要安装 Xcode Command Line Tools。默认 `npm run build` 不会构建或安装组件。

运行时只读取你选中的图片，在系统临时目录制作透明 PNG，再保存到插件的 `assets/user/`。没有网络上传，不自动下载或升级依赖。转换失败保留原封面。
