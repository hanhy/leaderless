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
VOLC_TTS_API_KEY=replace-with-your-volcengine-tts-key
VOLC_TTS_RESOURCE_ID=seed-tts-2.0
VOLC_TTS_FORMAT=pcm
VOLC_TTS_SAMPLE_RATE=24000
VOLC_TTS_SPEAKER_ZHUGE_LIANG=zh_male_ruyaqingnian_uranus_bigtts
VOLC_TTS_SPEAKER_ZHANG_FEI=zh_male_qingcang_uranus_bigtts
VOLC_TTS_SPEAKER_LIU_BEI=zh_male_wennuanahu_uranus_bigtts
VOLC_TTS_SPEAKER_CAO_CAO=zh_male_aojiaobazong_uranus_bigtts
VOLC_TTS_SPEAKER_GUAN_YU=zh_male_gaolengchenwen_uranus_bigtts
VOLC_TTS_SPEAKER_TANG_SENG=zh_male_tangseng_uranus_bigtts
VOLC_TTS_SPEAKER_SUN_WUKONG=zh_male_sunwukong_uranus_bigtts
VOLC_TTS_SPEAKER_ZHU_BAJIE=zh_male_zhubajie_uranus_bigtts
VOLC_TTS_SPEAKER_SHA_SENG=ICL_uranus_zh_male_younidashu_tob
```

启动：

```bash
npm install
npm run dev
```

打开 Vite 输出的本地地址。前端会通过 `/api/ai/stream` 调用本地大模型代理，通过 `/api/tts/stream` 调用本地火山语音代理，API key 不会进入浏览器代码。

## 实时语音

实时语音使用火山引擎豆包语音 `WebSocket 双向流式-V3`。浏览器把每个人的流式发言增量发给本地 Node 服务，本地服务再转成火山引擎二进制帧协议并把 PCM 音频流回浏览器播放。

默认角色音色可以通过 `VOLC_TTS_SPEAKER_*` 环境变量替换。当前默认值是偏角色气质的通用音色，后续可按火山引擎音色列表换成更贴近人物的 speaker ID。

## 场景

左上角可以切换场景：`圆桌三国` 使用诸葛亮、张飞、刘备、曹操、关羽；`圆桌西游` 使用唐僧、孙悟空、猪八戒、沙僧。切换场景会重置当前讨论记录和人物配置。
