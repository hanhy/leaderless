import type {
  DiscussionPhase,
  DiscussionSnapshot,
  PersonConfig,
  SpeakerIntent,
  Trait,
  WorkerRequest,
  WorkerResponse
} from "./types";

const phaseOrder: DiscussionPhase[] = ["opening", "exploring", "debating", "concluding"];

const styleProfiles = {
  稳健陈述: { interrupt: 0.25, persistence: 0.55, tempo: "先铺垫判断，再给依据" },
  主动打断: { interrupt: 0.82, persistence: 0.62, tempo: "抓到漏洞就插入" },
  强势推进: { interrupt: 0.68, persistence: 0.86, tempo: "压缩分歧，推动决策" },
  温和接续: { interrupt: 0.18, persistence: 0.35, tempo: "顺着上一位补充" },
  结构化总结: { interrupt: 0.38, persistence: 0.72, tempo: "先归纳，再落行动" }
} as const;

const traitAngles: Record<Trait, string[]> = {
  分析型: ["数据口径", "风险收益", "优先级", "可验证指标"],
  推进型: ["行动路径", "时间节点", "责任分工", "最小可行方案"],
  协调型: ["共识空间", "利益平衡", "协同方式", "接受度"],
  质疑型: ["反例", "边界条件", "隐含假设", "失败成本"],
  总结型: ["结论框架", "关键判断", "后续步骤", "代表发言"],
  倾听型: ["遗漏声音", "信息补齐", "对齐理解", "缓和冲突"]
};

function hashText(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return Math.abs(hash >>> 0);
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function pick<T>(items: T[], seed: number): T {
  return items[seed % items.length];
}

function uniqueWords(text: string): string[] {
  return Array.from(new Set(text.replace(/[，。！？、；：,.!?;:]/g, " ").split(/\s+/).filter(Boolean))).slice(0, 8);
}

function getPhaseByRound(round: number): DiscussionPhase {
  if (round <= 1) return "opening";
  if (round <= 4) return "exploring";
  if (round <= 7) return "debating";
  return "concluding";
}

function hasSpokenRecently(snapshot: DiscussionSnapshot, personId: number): boolean {
  return snapshot.transcript.slice(-4).some((entry) => entry.speakerId === personId && entry.type !== "interrupt");
}

function buildUtterance(person: PersonConfig, snapshot: DiscussionSnapshot, shouldConclude: boolean, seed: number): string {
  const profile = styleProfiles[person.speechStyle];
  const keywords = uniqueWords(`${snapshot.topic} ${snapshot.question}`);
  const focus = pick(person.traits.flatMap((trait) => traitAngles[trait]), seed);
  const keyword = keywords.length > 0 ? pick(keywords, seed + person.id) : "这个议题";
  const previousSpeech = snapshot.transcript
    .slice()
    .reverse()
    .find((entry) => entry.type === "speech" || entry.type === "interrupt");
  const bridge = previousSpeech && previousSpeech.speakerId !== person.id ? `我接一下${previousSpeech.speakerName}的点，` : "";

  if (shouldConclude) {
    return `${bridge}我建议形成结论：围绕“${snapshot.question}”，我们先确认核心目标，再按${focus}拆成三步执行。第一，保留已经达成一致的判断；第二，把争议点转成可验证的问题；第三，由一名代表对外说明共识、风险和下一步。`;
  }

  const openings: Record<DiscussionPhase, string> = {
    opening: `我先抛一个起点，${keyword}不能只看表面，我们需要先统一评价标准。`,
    exploring: `${bridge}从${focus}看，我认为现在还缺一块信息：谁受影响最大，以及我们用什么指标判断好坏。`,
    debating: `${bridge}这里我有一个不同侧重点，如果只按当前方向走，可能会低估${focus}带来的约束。`,
    concluding: `${bridge}讨论已经比较充分了，我倾向于把结论收束到目标、依据和行动三部分。`
  };

  const details = [
    `我的判断是，先做小范围验证，比一次性追求完整方案更稳。`,
    `如果大家认可，我们可以把分歧写成待验证假设，而不是继续在立场上拉扯。`,
    `这个位置我会优先看${focus}，因为它决定方案能不能真的落地。`,
    `按我的发言习惯，我会${profile.tempo}，所以现在更想把问题拆开。`
  ];

  const length = person.verbosity > 0.66 ? 2 : 1;
  return [openings[snapshot.phase], ...details.slice(0, length)].join("");
}

function evaluate(person: PersonConfig, snapshot: DiscussionSnapshot): SpeakerIntent {
  const seed = hashText(`${person.id}-${snapshot.round}-${snapshot.question}-${snapshot.transcript.length}`);
  const profile = styleProfiles[person.speechStyle];
  const phase = getPhaseByRound(snapshot.round);
  const personalFit =
    (person.traits.includes("总结型") && phase === "concluding" ? 0.22 : 0) +
    (person.traits.includes("推进型") && phase === "debating" ? 0.14 : 0) +
    (person.traits.includes("协调型") && phase === "exploring" ? 0.12 : 0) +
    (person.traits.includes("质疑型") && phase === "debating" ? 0.18 : 0) +
    (person.traits.includes("分析型") && phase === "opening" ? 0.14 : 0);
  const recencyPenalty = hasSpokenRecently(snapshot, person.id) ? 0.22 : 0;
  const currentSpeakerPenalty = snapshot.currentSpeakerId === person.id ? 0.42 : 0;
  const noise = (seed % 19) / 100;
  const transcriptCount = snapshot.transcript.filter((entry) => entry.type === "speech" || entry.type === "interrupt").length;
  const shouldConclude =
    transcriptCount >= 6 &&
    (phase === "concluding" || person.traits.includes("总结型") || person.speechStyle === "结构化总结") &&
    seed % 5 !== 0;
  const desire = clamp(0.34 + personalFit + person.interruptiveness * 0.18 + noise - recencyPenalty - currentSpeakerPenalty);
  const interruptStrength = clamp(person.interruptiveness * 0.65 + profile.interrupt * 0.25 + personalFit - recencyPenalty * 0.5);
  const confidence = clamp(0.42 + person.persistence * 0.26 + personalFit + (shouldConclude ? 0.22 : 0));
  const utterance = buildUtterance(person, { ...snapshot, phase }, shouldConclude, seed);

  return {
    personId: person.id,
    desire,
    interruptStrength,
    acceptsInterruption: clamp(1 - person.persistence * 0.62 - profile.persistence * 0.26),
    utterance,
    reason: shouldConclude ? "认为讨论已足够，可以收束" : "当前视角有补充价值",
    shouldConclude,
    confidence
  };
}

function decideYield(
  person: PersonConfig,
  snapshot: DiscussionSnapshot,
  challenger: SpeakerIntent,
  spokenRatio: number
): { willYield: boolean; reason: string } {
  const profile = styleProfiles[person.speechStyle];
  const phaseWeight = snapshot.phase === "concluding" ? 0.18 : 0;
  const speakerHold = person.persistence * 0.56 + profile.persistence * 0.28 + phaseWeight;
  const challengerPressure = challenger.interruptStrength * 0.58 + challenger.confidence * 0.2 + (spokenRatio > 0.62 ? 0.18 : 0);
  const willYield = challengerPressure > speakerHold;

  return {
    willYield,
    reason: willYield ? "插入强度更高，当前发言人让出话轮" : "当前陈述尚未完成，发言人继续推进"
  };
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === "evaluate") {
    const response: WorkerResponse = {
      requestId: message.requestId,
      type: "intent",
      intent: evaluate(message.person, message.snapshot)
    };
    self.postMessage(response);
    return;
  }

  const response: WorkerResponse = {
    requestId: message.requestId,
    type: "yieldDecision",
    ...decideYield(message.person, message.snapshot, message.challenger, message.spokenRatio)
  };
  self.postMessage(response);
};
