import { createServer } from "node:http";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
  for (const role of ["诸葛亮", "张飞", "刘备", "曹操", "关羽"]) {
    if (name.includes(role)) return role;
  }
  return name;
}

function addressInstruction(person) {
  const rules = {
    张飞: "刘备=大哥，关羽=二哥，诸葛亮=军师，曹操=曹贼",
    关羽: "刘备=大哥，张飞=三弟，诸葛亮=军师，曹操=曹贼",
    诸葛亮: "刘备=主公，张飞=翼德，关羽=云长，曹操=曹贼",
    刘备: "诸葛亮=军师，张飞=三弟，关羽=二弟，曹操=曹贼",
    曹操: "诸葛亮=诸葛村夫，张飞=环眼贼，关羽=关将军，刘备=大耳贼"
  };
  const rule = rules[roleName(person.name)];
  return rule ? `称呼规则：提到他人时必须用这些称呼：${rule}。` : "";
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
        ? "你在打断：先接住对方已说内容，再补充/修正/反驳，推动结论。90字内。"
        : "自然发言：回应上一位或当前议题，推进共识。90字内。";

  return [
    {
      role: "system",
      content: "中文无领导小组角色。只输出发言本身，无角色名/Markdown/旁白。紧扣上下文，目标是阶段结论。"
    },
    {
      role: "user",
      content: [
        `题：${clip(snapshot.topic, 90)}`,
        `问：${clip(snapshot.question, 90)}`,
        `阶段：${phaseName}，轮次：${snapshot.round}`,
        `你：${person.name}，${person.gender}，${person.traits.join("、")}，${person.speechStyle}。${styleInstruction(person.speechStyle)}`,
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

createServer(async (req, res) => {
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
}).listen(port, host, () => {
  console.log(`Leaderless server listening on http://${host}:${port}`);
});
