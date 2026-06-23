import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";

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

const port = Number(process.env.API_PORT ?? 8787);

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
    .slice(-14)
    .map((entry) => {
      const who = entry.speakerName ?? (entry.type === "user" ? "主持人" : "系统");
      return `${who}（${entry.type}）：${entry.text}`;
    })
    .join("\n");
}

function styleInstruction(style) {
  const styles = {
    稳健陈述: "语气稳健，先承接再给判断，避免抢结论。",
    主动打断: "可以直接指出问题，但必须先点名承接对方刚才的观点。",
    强势推进: "目标导向，压缩分歧，推动形成可执行结论。",
    温和接续: "先肯定已有观点，再补充遗漏，语气温和。",
    结构化总结: "善于归纳，用条理清楚的方式推进阶段结论。"
  };
  return styles[style] ?? "表达清晰，围绕当前议题推进。";
}

function buildMessages(payload) {
  const { person, people, snapshot, turnType, interruption, partialText } = payload;
  const phaseName = {
    opening: "开场陈述",
    exploring: "探索信息",
    debating: "交锋讨论",
    concluding: "收束结论"
  }[snapshot.phase] ?? snapshot.phase;
  const roster = people
    .map(
      (item) =>
        `${item.name}：${item.gender}，性格特质=${item.traits.join("、")}，发言风格=${item.speechStyle}，打断倾向=${item.interruptiveness}，坚持表达=${item.persistence}`
    )
    .join("\n");
  const task =
    turnType === "conclusion"
      ? "请作为小组代表宣读阶段结论。结论要包含共识、主要分歧、下一步行动，不要超过180字。"
      : turnType === "interrupt"
        ? "你正在打断别人。必须先接住对方已经说出的观点，再选择补充、修正或反驳，不能跳到无关内容。目标是把讨论推向阶段结论，不要超过130字。"
        : "请自然发言。必须回应上一位观点或当前议题，推进共识，不要超过130字。";

  return [
    {
      role: "system",
      content:
        "你是一个无领导小组讨论模拟器中的参会者。只输出角色要说的话本身，不要输出角色名、括号说明、Markdown、JSON、旁白或舞台指令。语言为中文，内容要紧扣上下文，主要目标是达成阶段结论。"
    },
    {
      role: "user",
      content: [
        `当前议题：${snapshot.topic}`,
        `本轮问题/追问：${snapshot.question}`,
        `讨论阶段：${phaseName}`,
        `当前轮次：${snapshot.round}`,
        "",
        "参会者设定：",
        roster,
        "",
        `你是：${person.name}`,
        `你的性格特质：${person.traits.join("、")}`,
        `你的发言风格：${person.speechStyle}。${styleInstruction(person.speechStyle)}`,
        "",
        "最近讨论记录：",
        recentTranscript(snapshot.transcript) || "暂无。",
        "",
        interruption
          ? `你要打断的对象：${interruption.speakerName}\n对方已经说到：${partialText || "尚未形成完整句子"}\n打断原因：${interruption.reason}`
          : "",
        "",
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

async function streamAi(req, res) {
  const baseUrl = process.env.AI_BASE_URL;
  const apiKey = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL ?? "qwen3.6-plus";

  if (!baseUrl || !apiKey) {
    writeText(res, 500, "缺少 AI_BASE_URL 或 AI_API_KEY 环境变量。");
    return;
  }

  const payload = await readJson(req);
  const upstream = await fetch(baseUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: buildMessages(payload),
      stream: true,
      temperature: payload.turnType === "conclusion" ? 0.45 : 0.72,
      max_tokens: payload.turnType === "conclusion" ? 360 : 260
    })
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
        if (text) res.write(text);
      } catch {
        // Ignore keep-alive or vendor-specific stream lines.
      }
    }
  }

  res.end();
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

  writeText(res, 404, "Not found.");
}).listen(port, "127.0.0.1", () => {
  console.log(`AI proxy listening on http://127.0.0.1:${port}`);
});
