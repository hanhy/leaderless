import "./styles.css";
import type {
  DiscussionPhase,
  DiscussionSnapshot,
  PersonConfig,
  SpeakerIntent,
  SpeechStyle,
  Trait,
  TranscriptEntry,
  WorkerRequest,
  WorkerResponse
} from "./types";

const traits: Trait[] = ["分析型", "推进型", "协调型", "质疑型", "总结型", "倾听型"];
const speechStyles: SpeechStyle[] = ["稳健陈述", "主动打断", "强势推进", "温和接续", "结构化总结"];
const colors = ["#ff5f6d", "#00b4d8", "#f7b801", "#7bd88f", "#a78bfa"];

let people: PersonConfig[] = [
  {
    id: 1,
    name: "林蔚",
    gender: "女",
    traits: ["分析型", "总结型"],
    speechStyle: "结构化总结",
    interruptiveness: 0.42,
    persistence: 0.72,
    verbosity: 0.66,
    color: colors[0]
  },
  {
    id: 2,
    name: "周远",
    gender: "男",
    traits: ["推进型", "质疑型"],
    speechStyle: "强势推进",
    interruptiveness: 0.68,
    persistence: 0.84,
    verbosity: 0.5,
    color: colors[1]
  },
  {
    id: 3,
    name: "唐宁",
    gender: "女",
    traits: ["协调型", "倾听型"],
    speechStyle: "温和接续",
    interruptiveness: 0.2,
    persistence: 0.34,
    verbosity: 0.48,
    color: colors[2]
  },
  {
    id: 4,
    name: "沈砚",
    gender: "男",
    traits: ["质疑型", "分析型"],
    speechStyle: "主动打断",
    interruptiveness: 0.86,
    persistence: 0.62,
    verbosity: 0.56,
    color: colors[3]
  },
  {
    id: 5,
    name: "许嘉",
    gender: "其他",
    traits: ["推进型", "总结型"],
    speechStyle: "稳健陈述",
    interruptiveness: 0.36,
    persistence: 0.54,
    verbosity: 0.72,
    color: colors[4]
  }
];

let workers = new Map<number, Worker>();
let transcript: TranscriptEntry[] = [];
let activeTopic = "";
let activeQuestion = "";
let activeSpeakerId: number | undefined;
let activeText = "";
let round = 0;
let isRunning = false;
let sessionEnded = false;
let lastConclusion = "";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root not found.");
}

app.innerHTML = `
  <main class="shell">
    <section class="control-panel" aria-label="讨论控制台">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true"></span>
        <div>
          <h1>无领导小组讨论模拟器</h1>
          <p>五个独立 worker 轮流发言，并在合适时机抢话、让话和总结。</p>
        </div>
      </div>

      <section class="panel-section">
        <div class="section-head">
          <h2>开场设置</h2>
          <span id="sessionState" class="status-pill">未开始</span>
        </div>
        <div id="peopleSettings" class="people-settings"></div>
      </section>

      <section class="panel-section">
        <div class="section-head">
          <h2>议题与追问</h2>
          <span id="roundState" class="muted">第 0 轮</span>
        </div>
        <textarea id="questionInput" rows="5" placeholder="输入开场议题；结论后也可以继续输入追问。"></textarea>
        <div class="action-row">
          <button id="startButton" class="primary-button" type="button">开始讨论</button>
          <button id="endButton" class="ghost-button" type="button" disabled>结束并总结</button>
        </div>
      </section>
    </section>

    <section class="stage" aria-label="圆桌讨论区">
      <div class="table-zone">
        <div class="round-table">
          <div class="table-core">
            <span>圆桌</span>
            <strong id="phaseLabel">等待议题</strong>
          </div>
          <div id="seatLayer" class="seat-layer"></div>
        </div>
      </div>

      <aside class="conversation-panel">
        <div class="section-head">
          <h2>实时讨论</h2>
          <span id="activeSpeaker" class="muted">暂无发言</span>
        </div>
        <div id="activeSpeech" class="active-speech">输入议题后，五位成员会开始讨论。</div>
        <div id="transcriptList" class="transcript-list"></div>
      </aside>
    </section>
  </main>
`;

const peopleSettings = document.querySelector<HTMLDivElement>("#peopleSettings")!;
const seatLayer = document.querySelector<HTMLDivElement>("#seatLayer")!;
const transcriptList = document.querySelector<HTMLDivElement>("#transcriptList")!;
const questionInput = document.querySelector<HTMLTextAreaElement>("#questionInput")!;
const startButton = document.querySelector<HTMLButtonElement>("#startButton")!;
const endButton = document.querySelector<HTMLButtonElement>("#endButton")!;
const activeSpeech = document.querySelector<HTMLDivElement>("#activeSpeech")!;
const activeSpeaker = document.querySelector<HTMLSpanElement>("#activeSpeaker")!;
const sessionState = document.querySelector<HTMLSpanElement>("#sessionState")!;
const roundState = document.querySelector<HTMLSpanElement>("#roundState")!;
const phaseLabel = document.querySelector<HTMLElement>("#phaseLabel")!;

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getPhase(): DiscussionPhase {
  if (round <= 1) return "opening";
  if (round <= 4) return "exploring";
  if (round <= 7) return "debating";
  return "concluding";
}

function phaseText(phase: DiscussionPhase): string {
  const labels: Record<DiscussionPhase, string> = {
    opening: "开场陈述",
    exploring: "探索信息",
    debating: "交锋讨论",
    concluding: "收束结论"
  };
  return labels[phase];
}

function addEntry(entry: Omit<TranscriptEntry, "id" | "timestamp" | "round"> & { round?: number }): TranscriptEntry {
  const fullEntry: TranscriptEntry = {
    id: createId("entry"),
    timestamp: Date.now(),
    round,
    ...entry
  };
  transcript.push(fullEntry);
  renderTranscript();
  return fullEntry;
}

function updateStatus(): void {
  const phase = getPhase();
  roundState.textContent = `第 ${round} 轮`;
  phaseLabel.textContent = sessionEnded ? "已结束" : activeTopic ? phaseText(phase) : "等待议题";
  sessionState.textContent = sessionEnded ? "已总结" : isRunning ? "讨论中" : activeTopic ? "可追问" : "未开始";
  startButton.textContent = activeTopic ? "提交追问" : "开始讨论";
  startButton.disabled = isRunning || sessionEnded;
  endButton.disabled = !activeTopic || isRunning || sessionEnded;
}

function renderSettings(): void {
  peopleSettings.innerHTML = people
    .map(
      (person) => `
        <article class="person-editor" data-person-id="${person.id}">
          <div class="person-editor-head">
            <span class="color-dot" style="--person-color: ${person.color}"></span>
            <input class="name-input" data-field="name" value="${person.name}" aria-label="姓名" />
            <select data-field="gender" aria-label="性别">
              ${["女", "男", "其他"].map((gender) => `<option value="${gender}" ${person.gender === gender ? "selected" : ""}>${gender}</option>`).join("")}
            </select>
          </div>
          <div class="trait-grid">
            ${traits
              .map(
                (trait) => `
                  <label>
                    <input type="checkbox" data-trait="${trait}" ${person.traits.includes(trait) ? "checked" : ""} />
                    <span>${trait}</span>
                  </label>
                `
              )
              .join("")}
          </div>
          <label class="field-line">
            <span>发言风格</span>
            <select data-field="speechStyle">
              ${speechStyles
                .map((style) => `<option value="${style}" ${person.speechStyle === style ? "selected" : ""}>${style}</option>`)
                .join("")}
            </select>
          </label>
          <div class="slider-grid">
            <label>
              <span>打断倾向</span>
              <input type="range" min="0" max="1" step="0.01" data-field="interruptiveness" value="${person.interruptiveness}" />
            </label>
            <label>
              <span>坚持表达</span>
              <input type="range" min="0" max="1" step="0.01" data-field="persistence" value="${person.persistence}" />
            </label>
            <label>
              <span>表达长度</span>
              <input type="range" min="0" max="1" step="0.01" data-field="verbosity" value="${person.verbosity}" />
            </label>
          </div>
        </article>
      `
    )
    .join("");
}

function renderSeats(): void {
  const angleOffset = -90;
  seatLayer.innerHTML = people
    .map((person, index) => {
      const angle = angleOffset + index * 72;
      const isActive = activeSpeakerId === person.id;
      const grid = Array.from({ length: 64 })
        .map((_, dotIndex) => {
          const traitWeight = person.traits.length * 7;
          const lit = (dotIndex + person.id * 5 + traitWeight) % 4 !== 0;
          return `<span style="--dot-color:${lit ? person.color : "rgba(255,255,255,0.22)"}"></span>`;
        })
        .join("");

      return `
        <article class="seat ${isActive ? "is-active" : ""}" style="--angle:${angle}deg; --person-color:${person.color}">
          <div class="avatar-grid" aria-hidden="true">${grid}</div>
          <div class="seat-label">
            <strong>${person.name}</strong>
            <span>${person.speechStyle}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderTranscript(): void {
  if (transcript.length === 0) {
    transcriptList.innerHTML = `<p class="empty-log">讨论记录会显示在这里。</p>`;
    return;
  }

  transcriptList.innerHTML = transcript
    .slice()
    .reverse()
    .map((entry) => {
      const color = entry.speakerId ? people.find((person) => person.id === entry.speakerId)?.color ?? "#d9dde7" : "#d9dde7";
      return `
        <article class="log-entry ${entry.type}" style="--person-color:${color}">
          <div class="log-meta">
            <span>${entry.speakerName ?? entry.type}</span>
            <span>${entry.phase ? phaseText(entry.phase) : `第 ${entry.round} 轮`}</span>
          </div>
          <p>${entry.text}</p>
        </article>
      `;
    })
    .join("");
}

function getSnapshot(): DiscussionSnapshot {
  return {
    topic: activeTopic,
    question: activeQuestion || activeTopic,
    phase: getPhase(),
    round,
    transcript,
    currentSpeakerId: activeSpeakerId,
    activeText
  };
}

function ensureWorkers(): void {
  for (const person of people) {
    if (!workers.has(person.id)) {
      workers.set(person.id, new Worker(new URL("./speakerWorker.ts", import.meta.url), { type: "module" }));
    }
  }
}

function terminateWorkers(): void {
  workers.forEach((worker) => worker.terminate());
  workers = new Map<number, Worker>();
}

function askWorker(worker: Worker, request: WorkerRequest): Promise<WorkerResponse> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      worker.removeEventListener("message", handleMessage);
      reject(new Error("worker timeout"));
    }, 1800);

    function handleMessage(event: MessageEvent<WorkerResponse>): void {
      if (event.data.requestId !== request.requestId) return;
      window.clearTimeout(timeout);
      worker.removeEventListener("message", handleMessage);
      resolve(event.data);
    }

    worker.addEventListener("message", handleMessage);
    worker.postMessage(request);
  });
}

async function evaluateAll(exceptId?: number): Promise<SpeakerIntent[]> {
  const snapshot = getSnapshot();
  const responses = await Promise.all(
    people
      .filter((person) => person.id !== exceptId)
      .map(async (person) => {
        const worker = workers.get(person.id);
        if (!worker) return undefined;
        const response = await askWorker(worker, {
          requestId: createId("intent"),
          type: "evaluate",
          person,
          snapshot
        });
        return response.type === "intent" ? response.intent : undefined;
      })
  );

  return responses.filter((intent): intent is SpeakerIntent => Boolean(intent));
}

async function decideYield(speaker: PersonConfig, challenger: SpeakerIntent, spokenRatio: number): Promise<boolean> {
  const worker = workers.get(speaker.id);
  if (!worker) return true;
  const response = await askWorker(worker, {
    requestId: createId("yield"),
    type: "yield",
    person: speaker,
    snapshot: getSnapshot(),
    challenger,
    spokenRatio
  });
  return response.type === "yieldDecision" ? response.willYield : true;
}

function splitSpeech(text: string): string[] {
  const chunks = text.match(/[^。！？；]+[。！？；]?/g) ?? [text];
  return chunks.map((chunk) => chunk.trim()).filter(Boolean);
}

async function maybeInterrupt(speaker: PersonConfig, spokenRatio: number): Promise<SpeakerIntent | undefined> {
  const contenders = await evaluateAll(speaker.id);
  const challenger = contenders
    .filter((intent) => intent.desire > 0.45 && intent.interruptStrength > 0.52)
    .sort((a, b) => b.interruptStrength + b.confidence - (a.interruptStrength + a.confidence))[0];

  if (!challenger) return undefined;
  const willYield = await decideYield(speaker, challenger, spokenRatio);
  return willYield ? challenger : undefined;
}

async function speak(intent: SpeakerIntent, type: TranscriptEntry["type"] = "speech"): Promise<boolean> {
  const speaker = people.find((person) => person.id === intent.personId);
  if (!speaker) return false;

  activeSpeakerId = speaker.id;
  activeText = "";
  activeSpeaker.textContent = `${speaker.name} 发言中`;
  renderSeats();

  const chunks = splitSpeech(intent.utterance);
  for (let index = 0; index < chunks.length; index += 1) {
    activeText = `${activeText}${chunks[index]}`;
    activeSpeech.innerHTML = `<strong style="color:${speaker.color}">${speaker.name}</strong><p>${activeText}</p>`;

    const spokenRatio = (index + 1) / chunks.length;
    await sleep(650 + Math.min(320, chunks[index].length * 14));

    if (!intent.shouldConclude && index < chunks.length - 1 && spokenRatio > 0.28) {
      const interruption = await maybeInterrupt(speaker, spokenRatio);
      if (interruption) {
        addEntry({
          type,
          speakerId: speaker.id,
          speakerName: speaker.name,
          text: `${activeText}（被打断）`,
          phase: getPhase()
        });
        const interrupter = people.find((person) => person.id === interruption.personId);
        addEntry({
          type: "interrupt",
          speakerId: interruption.personId,
          speakerName: interrupter?.name,
          text: `${interrupter?.name ?? "有人"}插入发言。触发原因：${interruption.reason}`,
          phase: getPhase()
        });
        await speak(interruption, interruption.shouldConclude ? "conclusion" : "speech");
        return interruption.shouldConclude;
      }
    }
  }

  addEntry({
    type: intent.shouldConclude ? "conclusion" : type,
    speakerId: speaker.id,
    speakerName: speaker.name,
    text: intent.utterance,
    phase: getPhase()
  });
  lastConclusion = intent.shouldConclude ? `${speaker.name}代表小组宣读结论：${intent.utterance}` : lastConclusion;
  activeSpeakerId = undefined;
  activeSpeaker.textContent = "等待下一轮";
  renderSeats();
  return intent.shouldConclude;
}

function selectRepresentative(): PersonConfig {
  return (
    people.find((person) => person.traits.includes("总结型")) ??
    people.slice().sort((a, b) => b.persistence + b.verbosity - (a.persistence + a.verbosity))[0]
  );
}

async function readFinalConclusion(): Promise<void> {
  const representative = selectRepresentative();
  const conclusion: SpeakerIntent = {
    personId: representative.id,
    desire: 1,
    interruptStrength: 0,
    acceptsInterruption: 0,
    reason: "主持人要求代表宣读结论",
    shouldConclude: true,
    confidence: 1,
    utterance:
      lastConclusion ||
      `我们形成阶段性结论：针对“${activeQuestion || activeTopic}”，小组认为应先统一目标和评价标准，再把分歧拆成可验证假设，最后用责任分工和时间节点推动执行。`
  };
  await speak(conclusion, "conclusion");
}

async function runDiscussion(question: string): Promise<void> {
  isRunning = true;
  activeQuestion = question;
  lastConclusion = "";
  updateStatus();

  addEntry({
    type: "user",
    text: activeTopic === question ? `开场议题：${question}` : `追问：${question}`
  });

  let concluded = false;
  const maxTurns = Math.max(7, Math.min(10, 6 + Math.round(question.length / 24)));

  for (let turn = 0; turn < maxTurns && !concluded && !sessionEnded; turn += 1) {
    round += 1;
    updateStatus();
    const intents = await evaluateAll();
    const selected = intents.sort((a, b) => b.desire + b.confidence * 0.36 - (a.desire + a.confidence * 0.36))[0];
    if (!selected) break;
    concluded = await speak(selected, selected.shouldConclude ? "conclusion" : "speech");
    await sleep(240);
  }

  if (!concluded && !sessionEnded) {
    await readFinalConclusion();
  }

  activeSpeakerId = undefined;
  activeText = "";
  activeSpeaker.textContent = "本轮已形成结论";
  activeSpeech.textContent = lastConclusion || "本轮讨论已形成阶段性结论，可以继续追问或结束总结。";
  isRunning = false;
  updateStatus();
  renderSeats();
}

function buildSummary(): string {
  const questions = transcript.filter((entry) => entry.type === "user").map((entry) => entry.text);
  const conclusions = transcript.filter((entry) => entry.type === "conclusion").map((entry) => entry.text);
  const interruptions = transcript.filter((entry) => entry.type === "interrupt").length;
  const participation = people
    .map((person) => {
      const count = transcript.filter((entry) => entry.speakerId === person.id && (entry.type === "speech" || entry.type === "conclusion")).length;
      return `${person.name}${count}次`;
    })
    .join("，");

  return [
    `本场讨论围绕 ${questions.length} 个议题/追问展开：${questions.join("；")}`,
    `五位成员共发生 ${interruptions} 次打断仲裁，发言参与度为：${participation}。`,
    `主要结论：${conclusions.slice(-3).join("；") || "尚未形成明确结论"}。`,
    "建议后续把结论拆成负责人、截止时间和验证指标，避免共识停留在口头层面。"
  ].join("\n");
}

function endSession(): void {
  sessionEnded = true;
  terminateWorkers();
  const summary = buildSummary();
  addEntry({
    type: "summary",
    speakerName: "系统总结",
    text: summary
  });
  activeSpeaker.textContent = "已结束";
  activeSpeech.textContent = summary;
  updateStatus();
  renderSeats();
}

function bindSettingsEvents(): void {
  peopleSettings.addEventListener("input", (event) => {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    const editor = target.closest<HTMLElement>("[data-person-id]");
    if (!editor) return;
    const person = people.find((item) => item.id === Number(editor.dataset.personId));
    if (!person) return;

    if (target instanceof HTMLInputElement && target.dataset.trait) {
      const trait = target.dataset.trait as Trait;
      person.traits = target.checked ? Array.from(new Set([...person.traits, trait])) : person.traits.filter((item) => item !== trait);
      if (person.traits.length === 0) person.traits = ["倾听型"];
      renderSeats();
      return;
    }

    const field = target.dataset.field as keyof PersonConfig | undefined;
    if (!field) return;
    if (field === "interruptiveness" || field === "persistence" || field === "verbosity") {
      person[field] = Number(target.value);
    } else if (field === "name") {
      person.name = target.value.trim() || `成员${person.id}`;
    } else if (field === "gender") {
      person.gender = target.value as PersonConfig["gender"];
    } else if (field === "speechStyle") {
      person.speechStyle = target.value as SpeechStyle;
    }
    renderSeats();
  });
}

startButton.addEventListener("click", async () => {
  const question = questionInput.value.trim();
  if (!question) {
    questionInput.focus();
    return;
  }

  if (!activeTopic) {
    activeTopic = question;
    ensureWorkers();
  }

  questionInput.value = "";
  await runDiscussion(question);
});

endButton.addEventListener("click", endSession);

renderSettings();
renderSeats();
renderTranscript();
bindSettingsEvents();
updateStatus();
