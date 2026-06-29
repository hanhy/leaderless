import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket, { WebSocketServer } from "ws";

function loadEnvFile() {
  if (!existsSync(".env")) return;
  for (const rawLine of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index).trim().replace(/^export\s+/, "");
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile();

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const staticRoot = resolve(__dirname, "dist");
const port = Number(process.env.API_PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
const contextTurns = Number(process.env.AI_CONTEXT_TURNS ?? 6);
const speechMaxTokens = Number(process.env.AI_SPEECH_MAX_TOKENS ?? 150);
const conclusionMaxTokens = Number(process.env.AI_CONCLUSION_MAX_TOKENS ?? 220);
const volcTtsUrl = process.env.VOLC_TTS_URL ?? "wss://openspeech.bytedance.com/api/v3/tts/bidirection";
const volcTtsResourceId = process.env.VOLC_TTS_RESOURCE_ID ?? "seed-tts-2.0";
const volcTtsFormat = process.env.VOLC_TTS_FORMAT ?? "pcm";
const volcTtsSampleRate = Number(process.env.VOLC_TTS_SAMPLE_RATE ?? 24000);

const ttsEvents = {
  startConnection: 1,
  finishConnection: 2,
  connectionStarted: 50,
  connectionFailed: 51,
  connectionFinished: 52,
  startSession: 100,
  cancelSession: 101,
  finishSession: 102,
  sessionStarted: 150,
  sessionCanceled: 151,
  sessionFinished: 152,
  sessionFailed: 153,
  taskRequest: 200,
  ttsResponse: 352
};

const roleSpeakerFallbacks = {
  "诸葛亮": "zh_male_ruyaqingnian_uranus_bigtts",
  "张飞": "zh_male_qingcang_uranus_bigtts",
  "刘备": "zh_male_wennuanahu_uranus_bigtts",
  "曹操": "zh_male_aojiaobazong_uranus_bigtts",
  "关羽": "zh_male_gaolengchenwen_uranus_bigtts",
  "唐僧": "zh_male_tangseng_uranus_bigtts",
  "孙悟空": "zh_male_sunwukong_uranus_bigtts",
  "猪八戒": "zh_male_zhubajie_uranus_bigtts",
  "沙僧": "ICL_uranus_zh_male_younidashu_tob",
  "李逵": "zh_male_qingcang_uranus_bigtts",
  "林黛玉": "ICL_uranus_zh_female_aomanjiaosheng_tob",
  "阿杰": "zh_male_wennuanahu_uranus_bigtts"
};

const roleAudioParams = {
  "诸葛亮": { speech_rate: 8, loudness_rate: 5, emotion: "storytelling", emotion_scale: 3 },
  "张飞": { speech_rate: 28, loudness_rate: 22, emotion: "angry", emotion_scale: 4 },
  "刘备": { speech_rate: 10, loudness_rate: 6, emotion: "tender", emotion_scale: 3 },
  "曹操": { speech_rate: 18, loudness_rate: 14, emotion: "magnetic", emotion_scale: 3 },
  "关羽": { speech_rate: 4, loudness_rate: 10, emotion: "neutral", emotion_scale: 3 },
  "唐僧": { speech_rate: 8, loudness_rate: 6, emotion: "tender", emotion_scale: 3 },
  "孙悟空": { speech_rate: 28, loudness_rate: 16, emotion: "excited", emotion_scale: 4 },
  "猪八戒": { speech_rate: 18, loudness_rate: 12, emotion: "happy", emotion_scale: 4 },
  "沙僧": { speech_rate: 6, loudness_rate: 8, emotion: "storytelling", emotion_scale: 2 },
  "李逵": { speech_rate: 26, loudness_rate: 22, emotion: "angry", emotion_scale: 4 },
  "林黛玉": { speech_rate: 2, loudness_rate: 2, emotion: "tender", emotion_scale: 3 },
  "阿杰": { speech_rate: 10, loudness_rate: 6, emotion: "neutral", emotion_scale: 2 }
};

const roleToneInstructions = {
  "诸葛亮": "语气沉稳机敏，像军师拆局：先点破关键，再给可执行判断。",
  "张飞": "语气急躁火爆，短句多，容易拍桌子式推进，但不要粗俗辱骂。",
  "刘备": "语气温和包容，先安抚分歧，再把话题拉回共识。",
  "曹操": "语气强势精明，带一点掌控感和试探感，直接权衡利弊。",
  "关羽": "语气寡言稳重，重信义和原则，少说废话，判断要有分量。",
  "唐僧": "语气耐心温和，像劝导众人，重视规则、善意和长远结果。",
  "孙悟空": "语气灵动急切，反应快，敢打断，带一点不服输的锋芒。",
  "猪八戒": "语气松弛直白，带一点小抱怨和现实盘算，但不能跑题。",
  "沙僧": "语气踏实朴素，少争抢，多补充遗漏和落地执行。",
  "李逵": "语气粗豪直冲，重义气，话短有冲劲，遇到绕弯会直接质疑。",
  "林黛玉": "语气细腻敏感，表达含蓄但锋利，善于指出话里不妥和隐藏代价。",
  "阿杰": "语气现代职场化，逻辑清楚，关注效率、风险、排期和责任边界。"
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8"
};

function parseBoolean(value, fallback) {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function clip(text = "", limit = 140) {
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_500_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function recentTranscript(transcript = []) {
  return transcript
    .slice(-contextTurns)
    .map((entry) => {
      const who = entry.speakerName ?? (entry.type === "user" ? "主持人" : "系统");
      return `${who}：${clip(entry.text, 120)}`;
    })
    .join("\n");
}

function styleInstruction(style) {
  const styles = {
    稳健陈述: "稳健，先承接再判断。",
    主动打断: "可直接指出问题，但先承接对方。",
    强势推进: "目标导向，推动落结论。",
    温和接续: "先肯定，再补遗漏。",
    结构化总结: "归纳清楚，推进阶段结论。"
  };
  return styles[style] ?? "表达清晰，围绕议题推进。";
}

function roleName(name = "") {
  for (const role of ["诸葛亮", "张飞", "刘备", "曹操", "关羽", "唐僧", "孙悟空", "猪八戒", "沙僧", "李逵", "林黛玉", "阿杰"]) {
    if (name.includes(role)) return role;
  }
  return name;
}

function speakerEnvKey(role) {
  const keys = {
    "诸葛亮": "VOLC_TTS_SPEAKER_ZHUGE_LIANG",
    "张飞": "VOLC_TTS_SPEAKER_ZHANG_FEI",
    "刘备": "VOLC_TTS_SPEAKER_LIU_BEI",
    "曹操": "VOLC_TTS_SPEAKER_CAO_CAO",
    "关羽": "VOLC_TTS_SPEAKER_GUAN_YU",
    "唐僧": "VOLC_TTS_SPEAKER_TANG_SENG",
    "孙悟空": "VOLC_TTS_SPEAKER_SUN_WUKONG",
    "猪八戒": "VOLC_TTS_SPEAKER_ZHU_BAJIE",
    "沙僧": "VOLC_TTS_SPEAKER_SHA_SENG",
    "李逵": "VOLC_TTS_SPEAKER_LI_KUI",
    "林黛玉": "VOLC_TTS_SPEAKER_LIN_DAIYU",
    "阿杰": "VOLC_TTS_SPEAKER_A_JIE"
  };
  return keys[role];
}

function speakerForName(name = "") {
  const role = roleName(name);
  const envKey = speakerEnvKey(role);
  return (envKey && process.env[envKey]) || process.env.VOLC_TTS_DEFAULT_SPEAKER || roleSpeakerFallbacks[role] || roleSpeakerFallbacks["诸葛亮"];
}

function addressInstruction(person) {
  const rules = {
    张飞: "刘备=大哥，关羽=二哥，诸葛亮=军师，曹操=曹贼",
    关羽: "刘备=大哥，张飞=三弟，诸葛亮=军师，曹操=曹贼，李逵=李兄，林黛玉=林姑娘，孙悟空=孙大圣，阿杰=阿杰",
    诸葛亮: "刘备=主公，张飞=翼德，关羽=云长，曹操=曹贼",
    刘备: "诸葛亮=军师，张飞=三弟，关羽=二弟，曹操=曹贼",
    曹操: "诸葛亮=诸葛村夫，张飞=环眼贼，关羽=关将军，刘备=大耳贼",
    唐僧: "孙悟空=悟空，猪八戒=八戒，沙僧=悟净",
    孙悟空: "唐僧=师傅，猪八戒=八戒/呆子，沙僧=沙师弟，李逵=李逵兄弟，林黛玉=林姑娘，关羽=关将军",
    猪八戒: "唐僧=师傅，孙悟空=猴哥，沙僧=沙师弟",
    沙僧: "唐僧=师傅，孙悟空=大师兄，猪八戒=二师兄",
    李逵: "林黛玉=林姑娘，孙悟空=孙大圣，关羽=关二哥，阿杰=阿杰兄弟",
    林黛玉: "李逵=李大哥，孙悟空=孙大圣，关羽=关将军，阿杰=阿杰先生",
    阿杰: "李逵=李逵大哥，林黛玉=林姑娘，关羽=关将军"
  };
  const rule = rules[roleName(person.name)];
  return rule ? `称呼规则：提到他人时必须用这些称呼：${rule}。` : "";
}

function toneInstruction(person) {
  const tone = roleToneInstructions[roleName(person.name)];
  return tone ? `人物语气：${tone}` : "";
}

function buildMessages(payload) {
  const { person, snapshot, turnType, interruption, partialText } = payload;
  const phaseName = {
    opening: "开场陈述",
    exploring: "探索信息",
    debating: "交锋讨论",
    concluding: "收束结论"
  }[snapshot.phase] ?? snapshot.phase;
  const task =
    turnType === "conclusion"
      ? "代表小组宣读阶段结论：共识、分歧、下一步。120字内。"
      : turnType === "interrupt"
        ? "你在打断：先说“等一下、等等、抱歉我打断一下、不行、不对、这怎么行”等这类过渡词（你自己选择或者生成，不限于这几个词，符合日常场景和上下文语境），不需要先叫对方的称呼，再按你自己的意思推动结论。30字内。"
        : "自然发言：回应上一位或当前议题，推进共识。30字内。";

  return [
    {
      role: "system",
      content: "中文无领导小组角色。只输出发言本身，无角色名/Markdown/旁白。紧扣上下文，目标是阶段结论。讨论涉及到的人物仅限于任务发布者和在场的几个人，不能涉及其他人。跟别人说话的时候，只有1/4的概率会带上被打断人的称呼。让每个人的性格鲜明一点，口语化一些，不要每个人都做非常中肯的论证"
    },
    {
      role: "user",
      content: [
        `题：${clip(snapshot.topic, 90)}`,
        `问：${clip(snapshot.question, 90)}`,
        `阶段：${phaseName}，轮次：${snapshot.round}`,
        `你：${person.name}，${person.gender}，${person.traits.join("、")}，${person.speechStyle}。${styleInstruction(person.speechStyle)}`,
        toneInstruction(person),
        addressInstruction(person),
        "近况：",
        recentTranscript(snapshot.transcript) || "暂无。",
        interruption
          ? `打断${interruption.speakerName}，其已说：${clip(partialText || "尚未形成完整句子", 120)}；原因：${interruption.reason}`
          : "",
        `任务：${task}`
      ].join("\n")
    }
  ];
}

function writeText(res, status, text) {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(text);
}

function safeStaticPath(url = "/") {
  const pathname = new URL(url, "http://localhost").pathname;
  const candidate = pathname === "/" ? "/index.html" : pathname;
  const fullPath = normalize(join(staticRoot, candidate));
  return fullPath.startsWith(staticRoot) ? fullPath : "";
}

function serveStatic(req, res) {
  if (!["GET", "HEAD"].includes(req.method ?? "")) {
    writeText(res, 405, "Method not allowed.");
    return;
  }

  let filePath = safeStaticPath(req.url);
  if (!filePath || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(staticRoot, "index.html");
  }

  if (!existsSync(filePath)) {
    writeText(res, 404, "Not found.");
    return;
  }

  const ext = extname(filePath);
  const isAsset = filePath.includes(`${join("dist", "assets")}`);
  res.writeHead(200, {
    "content-type": mimeTypes[ext] ?? "application/octet-stream",
    "cache-control": isAsset ? "public, max-age=604800, immutable" : "no-cache"
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  createReadStream(filePath).pipe(res);
}

async function streamAi(req, res) {
  const baseUrl = process.env.AI_BASE_URL;
  const apiKey = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL ?? "qwen3.6-plus";
  const enableThinking = parseBoolean(process.env.AI_ENABLE_THINKING, false);
  const thinkingBudget = process.env.AI_THINKING_BUDGET ? Number(process.env.AI_THINKING_BUDGET) : undefined;

  if (!baseUrl || !apiKey) {
    writeText(res, 500, "缺少 AI_BASE_URL 或 AI_API_KEY 环境变量。");
    return;
  }

  const payload = await readJson(req);
  const messages = buildMessages(payload);
  const startedAt = Date.now();
  let firstTokenAt = 0;
  const requestBody = {
    model,
    messages,
    stream: true,
    temperature: payload.turnType === "conclusion" ? 0.35 : 0.62,
    max_tokens: payload.turnType === "conclusion" ? conclusionMaxTokens : speechMaxTokens,
    enable_thinking: enableThinking
  };

  if (thinkingBudget !== undefined) {
    requestBody.thinking_budget = thinkingBudget;
  }

  console.log(
    `[ai] start type=${payload.turnType} role=${payload.person?.name ?? "-"} prompt_chars=${messages.map((item) => item.content.length).reduce((sum, size) => sum + size, 0)} thinking=${enableThinking}`
  );

  const upstream = await fetch(baseUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    writeText(res, upstream.status || 502, detail || "模型服务调用失败。");
    return;
  }

  res.writeHead(200, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    "x-accel-buffering": "no"
  });

  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of upstream.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const json = JSON.parse(data);
        const text = json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.message?.content ?? "";
        if (text) {
          if (!firstTokenAt) {
            firstTokenAt = Date.now();
            console.log(`[ai] first_token_ms=${firstTokenAt - startedAt}`);
          }
          res.write(text);
        }
      } catch {
        // Ignore keep-alive or vendor-specific stream lines.
      }
    }
  }

  res.end();
  console.log(`[ai] done total_ms=${Date.now() - startedAt}`);
}

function jsonBytes(value) {
  return Buffer.from(JSON.stringify(value), "utf8");
}

function frameJson(event, payload = {}, sessionId = "") {
  const payloadBytes = jsonBytes(payload);
  const sessionBytes = sessionId ? Buffer.from(sessionId, "utf8") : undefined;
  const headerLength = sessionBytes ? 12 + sessionBytes.length + 4 : 12;
  const frame = Buffer.alloc(headerLength + payloadBytes.length);

  frame[0] = 0x11;
  frame[1] = 0x14;
  frame[2] = 0x10;
  frame[3] = 0x00;
  frame.writeInt32BE(event, 4);

  if (sessionBytes) {
    frame.writeUInt32BE(sessionBytes.length, 8);
    sessionBytes.copy(frame, 12);
    frame.writeUInt32BE(payloadBytes.length, 12 + sessionBytes.length);
    payloadBytes.copy(frame, 16 + sessionBytes.length);
  } else {
    frame.writeUInt32BE(payloadBytes.length, 8);
    payloadBytes.copy(frame, 12);
  }

  return frame;
}

function parseVolcFrame(data) {
  const frame = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (frame.length < 4) return { messageType: -1, payload: Buffer.alloc(0) };

  const headerSize = (frame[0] & 0x0f) * 4;
  const messageType = frame[1] >> 4;
  const flags = frame[1] & 0x0f;
  const serialization = frame[2] >> 4;
  let offset = headerSize;
  let event;
  let code;

  if ((flags & 0x04) === 0x04 && frame.length >= offset + 4) {
    event = frame.readInt32BE(offset);
    offset += 4;
  }

  if (messageType === 0x0f) {
    if (frame.length >= offset + 4) {
      code = frame.readInt32BE(offset);
      offset += 4;
    }
    const payload = frame.subarray(offset);
    return { messageType, event, code, payload, json: parseMaybeJson(payload) };
  }

  let id = "";
  if (frame.length >= offset + 4) {
    const idLength = frame.readUInt32BE(offset);
    offset += 4;
    if (idLength > 0 && frame.length >= offset + idLength) {
      id = frame.subarray(offset, offset + idLength).toString("utf8");
      offset += idLength;
    }
  }

  let payload = Buffer.alloc(0);
  if (frame.length >= offset + 4) {
    const payloadLength = frame.readUInt32BE(offset);
    offset += 4;
    if (payloadLength > 0 && frame.length >= offset + payloadLength) {
      payload = frame.subarray(offset, offset + payloadLength);
    }
  }

  return {
    messageType,
    event,
    code,
    id,
    payload,
    json: serialization === 1 ? parseMaybeJson(payload) : undefined
  };
}

function parseMaybeJson(payload) {
  if (!payload?.length) return undefined;
  try {
    return JSON.parse(payload.toString("utf8"));
  } catch {
    return undefined;
  }
}

function ttsSessionMeta(speakerName) {
  const role = roleName(speakerName);
  return {
    user: {
      uid: `leaderless-${role || "speaker"}`
    },
    event: ttsEvents.startSession,
    namespace: "BidirectionalTTS",
    req_params: {
      text: "",
      speaker: speakerForName(speakerName),
      audio_params: {
        format: volcTtsFormat,
        sample_rate: volcTtsSampleRate,
        ...(roleAudioParams[role] ?? {})
      }
    }
  };
}

function ttsTextPayload(text) {
  return {
    event: ttsEvents.taskRequest,
    namespace: "BidirectionalTTS",
    req_params: {
      text
    }
  };
}

function sendClientJson(client, payload) {
  if (client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(payload));
  }
}

function setupTtsClient(client) {
  const apiKey = process.env.VOLC_TTS_API_KEY;
  if (!apiKey) {
    sendClientJson(client, { type: "error", message: "缺少 VOLC_TTS_API_KEY 环境变量。" });
    client.close();
    return;
  }

  let upstream;
  let sessionId = "";
  let speakerName = "";
  let sessionReady = false;
  let shouldFinish = false;
  let hasFinished = false;
  const pendingText = [];

  function flushText() {
    if (!upstream || upstream.readyState !== WebSocket.OPEN || !sessionReady) return;
    while (pendingText.length > 0) {
      const text = pendingText.shift();
      if (text) upstream.send(frameJson(ttsEvents.taskRequest, ttsTextPayload(text), sessionId));
    }
    if (shouldFinish && !hasFinished) {
      hasFinished = true;
      upstream.send(frameJson(ttsEvents.finishSession, {}, sessionId));
    }
  }

  function closeUpstream() {
    if (!upstream || upstream.readyState !== WebSocket.OPEN) return;
    try {
      if (!hasFinished && sessionReady) {
        upstream.send(frameJson(ttsEvents.cancelSession, {}, sessionId));
      }
      upstream.send(frameJson(ttsEvents.finishConnection, {}));
    } catch {
      // Best-effort cleanup.
    }
    upstream.close();
  }

  function connectVolc() {
    sessionId = randomUUID().replaceAll("-", "").slice(0, 24);
    upstream = new WebSocket(volcTtsUrl, {
      headers: {
        "X-Api-Key": apiKey,
        "X-Api-Resource-Id": volcTtsResourceId,
        "X-Api-Connect-Id": randomUUID(),
        "X-Control-Require-Usage-Tokens-Return": "text_words"
      }
    });

    upstream.on("open", () => {
      upstream.send(frameJson(ttsEvents.startConnection, {}));
    });

    upstream.on("message", (data) => {
      const frame = parseVolcFrame(data);

      if (frame.messageType === 0x0f) {
        sendClientJson(client, {
          type: "error",
          message: frame.json?.message ?? frame.payload.toString("utf8") ?? "火山语音服务返回错误。"
        });
        return;
      }

      if (frame.event === ttsEvents.connectionStarted) {
        upstream.send(frameJson(ttsEvents.startSession, ttsSessionMeta(speakerName), sessionId));
        return;
      }

      if (frame.event === ttsEvents.sessionStarted) {
        sessionReady = true;
        sendClientJson(client, {
          type: "ready",
          format: volcTtsFormat,
          sampleRate: volcTtsSampleRate
        });
        flushText();
        return;
      }

      if (frame.event === ttsEvents.ttsResponse && frame.payload.length > 0) {
        if (client.readyState === WebSocket.OPEN) client.send(frame.payload);
        return;
      }

      if (frame.event === ttsEvents.sessionFinished || frame.event === ttsEvents.sessionCanceled) {
        sendClientJson(client, { type: "done", usage: frame.json?.usage });
        closeUpstream();
        windowSafeClose(client);
        return;
      }

      if (frame.event === ttsEvents.connectionFailed || frame.event === ttsEvents.sessionFailed) {
        sendClientJson(client, {
          type: "error",
          message: frame.json?.message ?? "火山语音连接或会话失败。"
        });
      }
    });

    upstream.on("error", (error) => {
      sendClientJson(client, { type: "error", message: error.message || "火山语音 WebSocket 异常。" });
    });

    upstream.on("close", () => {
      sendClientJson(client, { type: "closed" });
    });
  }

  client.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString("utf8"));
    } catch {
      sendClientJson(client, { type: "error", message: "TTS 客户端消息格式错误。" });
      return;
    }

    if (message.type === "start") {
      speakerName = String(message.speakerName ?? "");
      connectVolc();
      return;
    }

    if (message.type === "text") {
      const text = String(message.text ?? "");
      if (text.trim()) {
        pendingText.push(text);
        flushText();
      }
      return;
    }

    if (message.type === "finish") {
      shouldFinish = true;
      flushText();
      return;
    }

    if (message.type === "cancel") {
      shouldFinish = true;
      closeUpstream();
      windowSafeClose(client);
    }
  });

  client.on("close", closeUpstream);
}

function windowSafeClose(socket) {
  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
    socket.close();
  }
}

const httpServer = createServer(async (req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "POST" && req.url === "/api/ai/stream") {
    try {
      await streamAi(req, res);
    } catch (error) {
      writeText(res, 500, error instanceof Error ? error.message : "模型代理异常。");
    }
    return;
  }

  serveStatic(req, res);
});

const ttsWss = new WebSocketServer({ noServer: true });
ttsWss.on("connection", setupTtsClient);

httpServer.on("upgrade", (req, socket, head) => {
  const pathname = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`).pathname;
  if (pathname !== "/api/tts/stream") {
    socket.destroy();
    return;
  }

  ttsWss.handleUpgrade(req, socket, head, (client) => {
    ttsWss.emit("connection", client, req);
  });
});

httpServer.listen(port, host, () => {
  console.log(`Leaderless server listening on http://${host}:${port}`);
});
