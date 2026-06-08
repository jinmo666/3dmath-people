# 政务大厅咨询数字人 Demo

这是一个低成本落地用的本地 Web Demo：

- 魔珐星云 SDK 负责数字人端侧渲染、TTS 播报和打断。
- DeepSeek 负责政务大厅开放式咨询问答。
- 前端输入魔珐 `AppID` 和 `AppSecret`，不在代码里硬编码。
- 页面里的 `AppID`、`AppSecret`、`DeepSeek API Key` 都使用密码框掩码输入，不写入本地存储。
- DeepSeek Key 推荐放在服务端环境变量；前端临时输入只用于本地调试。

## 运行

要求 Node.js 18 或更高版本。

```powershell
cd E:\3d数字人\gov-hall-digital-human
$env:DEEPSEEK_API_KEY="sk-你的 DeepSeek Key"
npm start
```

然后打开：

```text
http://localhost:5173
```

如果暂时不设置 `DEEPSEEK_API_KEY`，页面会显示 DeepSeek Key 输入框，本地调试时可以临时填入。

## 使用

1. 点击侧边栏 `接入`，输入魔珐星云 `AppID` 和 `AppSecret`。
2. 点击 `连接数字人`。
3. 回到 `咨询` 模块输入群众问题，或点击 `常用` 模块里的快捷咨询按钮。
4. 数字人会调用 DeepSeek 生成答复，并通过魔珐 SDK 播报。
5. 群众中途改问时，点击 `打断播报`，或直接发送新问题。

## 配置

可选环境变量：

```text
PORT=5173
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
```

## 文件结构

```text
gov-hall-digital-human/
  server.js                  # DeepSeek 服务端代理和静态资源服务
  public/
    index.html               # 政务大厅数字人工作台
    styles.css               # 页面样式
    app.js                   # Xmov SDK、DeepSeek 流式问答、播报打断逻辑
    assets/hall-map.svg      # 大厅窗口示意图
```

## 生产注意

- DeepSeek API Key 不建议放在浏览器端，正式部署应使用服务端环境变量或密钥管理服务。
- 业务政策类问题建议后续接入本地政务知识库或业务数据库，减少模型自由发挥。
- 具体政策答复应以当地政务大厅最新公示和窗口审核为准。

## 参考

- DeepSeek API Docs: https://api-docs.deepseek.com/
- 魔珐星云 Lite SDK CDN: https://media.xingyun3d.com/xingyun3d/general/litesdk/xmovAvatar@latest.js
