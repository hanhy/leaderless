# Leaderless Group Simulator

一个 TypeScript/Vite 无领导小组讨论模拟器。浏览器负责五人圆桌调度和像素风界面，本地 Node API 代理负责安全调用 OpenAI-compatible 大模型接口。

## 本地运行

复制环境变量模板：

```bash
cp .env.example .env
```

在 `.env` 里填入真实模型参数：

```bash
AI_PROVIDER=aliyun_bailian
AI_BASE_URL=https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions
AI_API_KEY=replace-with-your-key
AI_MODEL=qwen3.6-plus
API_PORT=8787
AI_ENABLE_THINKING=false
AI_CONTEXT_TURNS=6
AI_SPEECH_MAX_TOKENS=150
AI_CONCLUSION_MAX_TOKENS=220
```

启动：

```bash
npm install
npm run dev
```

打开 Vite 输出的本地地址。前端会通过 `/api/ai/stream` 调用本地代理，API key 不会进入浏览器代码。
