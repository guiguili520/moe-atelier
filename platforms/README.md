# 多端入口

当前项目保留一个主 Web/H5 端，并新增微信小程序端：

- H5/PWA：项目根目录，运行 `npm run dev`，访问 `http://localhost:5173`
- 微信小程序：`platforms/wechat-miniprogram`，用微信开发者工具导入该目录

## H5/PWA

适合手机浏览器、桌面浏览器和添加到主屏幕。构建命令：

```bash
npm run build
```

## 微信小程序

小程序端是原生微信小程序实现，不依赖 React 或 Ant Design。校验命令：

```bash
npm run miniapp:wechat:check
```

导入微信开发者工具后，需要在小程序后台配置合法请求域名，或在开发者工具中临时关闭域名校验。
