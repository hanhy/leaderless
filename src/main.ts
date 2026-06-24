import "./styles.css";
import journeyWestTableArt from "./assets/round-table-journey-west-pixel.png";
import threeKingdomsTableArt from "./assets/round-table-three-kingdoms-pixel.png";
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

type SceneId = "three-kingdoms" | "journey-west";

interface SeatPosition {
  bubbleX: number;
  bubbleY: number;
  labelX: number;
  labelY: number;
}

interface SceneConfig {
  id: SceneId;
  label: string;
  title: string;
  art: string;
  alt: string;
  people: PersonConfig[];
  seats: SeatPosition[];
}

const scenes: Record<SceneId, SceneConfig> = {
  "three-kingdoms": {
    id: "three-kingdoms",
    label: "场景一：圆桌三国",
    title: "圆桌三国",
    art: threeKingdomsTableArt,
    alt: "诸葛亮、张飞、刘备、曹操、关羽围坐圆桌的像素风场景",
    people: [
      {
        id: 1,
        name: "点子王-诸葛亮",
        gender: "男",
        traits: ["分析型", "总结型", "推进型"],
        speechStyle: "结构化总结",
        interruptiveness: 0.52,
        persistence: 0.8,
        verbosity: 0.82,
        color: colors[0]
      },
      {
        id: 2,
        name: "吵架王-张飞",
        gender: "男",
        traits: ["推进型", "质疑型"],
        speechStyle: "主动打断",
        interruptiveness: 0.95,
        persistence: 0.9,
        verbosity: 0.62,
        color: colors[1]
      },
      {
        id: 3,
        name: "端水大师-刘备",
        gender: "男",
        traits: ["协调型", "倾听型", "总结型"],
        speechStyle: "温和接续",
        interruptiveness: 0.24,
        persistence: 0.58,
        verbosity: 0.7,
        color: colors[2]
      },
      {
        id: 4,
        name: "土豪哥-曹操",
        gender: "男",
        traits: ["推进型", "分析型"],
        speechStyle: "强势推进",
        interruptiveness: 0.76,
        persistence: 0.86,
        verbosity: 0.68,
        color: colors[3]
      },
      {
        id: 5,
        name: "不爱说话-关羽",
        gender: "男",
        traits: ["倾听型", "质疑型"],
        speechStyle: "稳健陈述",
        interruptiveness: 0.18,
        persistence: 0.76,
        verbosity: 0.38,
        color: colors[4]
      }
    ],
    seats: [
      { bubbleX: 50, bubbleY: 22, labelX: 50, labelY: 2 },
      { bubbleX: 77, bubbleY: 40, labelX: 88, labelY: 54 },
      { bubbleX: 69, bubbleY: 76, labelX: 72, labelY: 95 },
      { bubbleX: 31, bubbleY: 76, labelX: 28, labelY: 95 },
      { bubbleX: 23, bubbleY: 40, labelX: 12, labelY: 54 }
    ]
  },
  "journey-west": {
    id: "journey-west",
    label: "场景二：圆桌西游",
    title: "圆桌西游",
    art: journeyWestTableArt,
    alt: "唐僧、孙悟空、猪八戒、沙僧围坐圆桌的像素风场景",
    people: [
      {
        id: 1,
        name: "唐僧",
        gender: "男",
        traits: ["协调型", "倾听型", "总结型"],
        speechStyle: "温和接续",
        interruptiveness: 0.16,
        persistence: 0.68,
        verbosity: 0.72,
        color: colors[0]
      },
      {
        id: 2,
        name: "孙悟空",
        gender: "男",
        traits: ["推进型", "质疑型", "分析型"],
        speechStyle: "主动打断",
        interruptiveness: 0.92,
        persistence: 0.9,
        verbosity: 0.58,
        color: colors[1]
      },
      {
        id: 3,
        name: "猪八戒",
        gender: "男",
        traits: ["质疑型", "协调型"],
        speechStyle: "强势推进",
        interruptiveness: 0.66,
        persistence: 0.62,
        verbosity: 0.7,
        color: colors[2]
      },
      {
        id: 4,
        name: "沙僧",
        gender: "男",
        traits: ["倾听型", "总结型"],
        speechStyle: "稳健陈述",
        interruptiveness: 0.22,
        persistence: 0.72,
        verbosity: 0.46,
        color: colors[3]
      }
    ],
    seats: [
      { bubbleX: 50, bubbleY: 24, labelX: 50, labelY: 3 },
      { bubbleX: 22, bubbleY: 48, labelX: 10, labelY: 61 },
      { bubbleX: 78, bubbleY: 48, labelX: 90, labelY: 61 },
      { bubbleX: 50, bubbleY: 82, labelX: 50, labelY: 96 }
    ]
  }
};

let currentSceneId: SceneId = "three-kingdoms";
let people: PersonConfig[] = clonePeople(scenes[currentSceneId].people);

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
let typewriterSequence: Promise<boolean> = Promise.resolve(false);
let voiceEnabled = true;

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
          <p>多角色独立 worker 轮流发言，并在合适时机抢话、让话和总结。</p>
        </div>
        <label class="scene-picker">
          <span>场景</span>
          <select id="sceneSelect" aria-label="选择场景">
            ${Object.values(scenes)
              .map((scene) => `<option value="${scene.id}" ${scene.id === currentSceneId ? "selected" : ""}>${scene.label}</option>`)
              .join("")}
          </select>
        </label>
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
          <button id="voiceButton" class="ghost-button voice-button is-on" type="button">语音开启</button>
        </div>
      </section>
    </section>

    <section class="stage" aria-label="圆桌讨论区">
      <div class="table-zone">
        <div class="round-table">
          <img id="sceneImage" class="pixel-scene" src="${currentScene().art}" alt="${currentScene().alt}" />
          <div class="phase-badge">
            <span id="sceneTitle">${currentScene().title}</span>
            <strong id="phaseLabel">等待议题</strong>
          </div>
          <div id="seatLayer" class="seat-layer"></div>
          <div id="interruptEffect" class="interrupt-effect" aria-hidden="true"></div>
        </div>
      </div>

      <aside class="conversation-panel">
        <div class="section-head">
          <h2>实时讨论</h2>
          <span id="activeSpeaker" class="muted">暂无发言</span>
        </div>
        <div id="activeSpeech" class="active-speech">输入议题后，成员会开始讨论。</div>
        <div id="transcriptList" class="transcript-list"></div>
      </aside>
    </section>
  </main>
`;

const peopleSettings = document.querySelector<HTMLDivElement>("#peopleSettings")!;
const seatLayer = document.querySelector<HTMLDivElement>("#seatLayer")!;
const transcriptList = document.querySelector<HTMLDivElement>("#transcriptList")!;
const questionInput = document.querySelector<HTMLTextAreaElement>("#questionInput")!;
const sceneSelect = document.querySelector<HTMLSelectElement>("#sceneSelect")!;
const sceneImage = document.querySelector<HTMLImageElement>("#sceneImage")!;
const sceneTitle = document.querySelector<HTMLSpanElement>("#sceneTitle")!;
const startButton = document.querySelector<HTMLButtonElement>("#startButton")!;
const endButton = document.querySelector<HTMLButtonElement>("#endButton")!;
const voiceButton = document.querySelector<HTMLButtonElement>("#voiceButton")!;
const activeSpeech = document.querySelector<HTMLDivElement>("#activeSpeech")!;
const activeSpeaker = document.querySelector<HTMLSpanElement>("#activeSpeaker")!;
const sessionState = document.querySelector<HTMLSpanElement>("#sessionState")!;
const roundState = document.querySelector<HTMLSpanElement>("#roundState")!;
const phaseLabel = document.querySelector<HTMLElement>("#phaseLabel")!;
const interruptEffect = document.querySelector<HTMLDivElement>("#interruptEffect")!;

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function clonePeople(source: PersonConfig[]): PersonConfig[] {
  return source.map((person) => ({
    ...person,
    traits: [...person.traits]
  }));
}

function currentScene(): SceneConfig {
  return scenes[currentSceneId];
}

class PcmSpeechPlayer {
  private context?: AudioContext;
  private socket?: WebSocket;
  private pendingText: string[] = [];
  private sources = new Set<AudioBufferSourceNode>();
  private donePromise?: Promise<void>;
  private resolveDone?: () => void;
  private finishRequested = false;
  private nextStartTime = 0;
  private sampleRate = 24000;

  async start(speaker: PersonConfig): Promise<void> {
    if (!voiceEnabled) return;
    this.stop();
    this.pendingText = [];
    this.finishRequested = false;
    this.donePromise = new Promise((resolve) => {
      this.resolveDone = resolve;
    });
    this.context = this.context ?? new AudioContext();
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
    this.nextStartTime = this.context.currentTime + 0.04;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    this.socket = new WebSocket(`${protocol}//${window.location.host}/api/tts/stream`);
    this.socket.binaryType = "arraybuffer";
    this.socket.addEventListener("open", () => {
      this.socket?.send(JSON.stringify({ type: "start", speakerName: speaker.name }));
      this.flushText();
      this.flushFinish();
    });
    this.socket.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        this.handleControlMessage(event.data);
        return;
      }
      this.playPcm(event.data);
    });
    this.socket.addEventListener("error", () => {
      this.stop();
    });
    this.socket.addEventListener("close", () => {
      this.resolveDone?.();
    });
  }

  send(text: string): void {
    if (!voiceEnabled || !text.trim()) return;
    this.pendingText.push(text);
    this.flushText();
  }

  async finishAndWait(timeoutMs = 30000): Promise<void> {
    if (!voiceEnabled || !this.socket) return;
    this.finishRequested = true;
    this.flushFinish();
    let finished = false;
    await Promise.race([
      this.donePromise?.then(() => {
        finished = true;
      }),
      sleep(timeoutMs)
    ]);
    const idle = await this.waitForPlaybackIdle(Math.min(12000, Math.max(3000, timeoutMs / 2)));
    if (!finished || !idle) {
      this.stop();
    }
  }

  stop(): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "cancel" }));
    }
    this.socket?.close();
    this.socket = undefined;
    this.pendingText = [];
    this.finishRequested = false;
    this.sources.forEach((source) => {
      try {
        source.stop();
      } catch {
        // Source may already be stopped.
      }
    });
    this.sources.clear();
    this.resolveDone?.();
    this.donePromise = undefined;
    this.resolveDone = undefined;
    this.nextStartTime = this.context?.currentTime ?? 0;
  }

  private flushText(): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    while (this.pendingText.length > 0) {
      const text = this.pendingText.shift();
      if (text) this.socket.send(JSON.stringify({ type: "text", text }));
    }
  }

  private flushFinish(): void {
    if (!this.finishRequested || this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: "finish" }));
    this.finishRequested = false;
  }

  private handleControlMessage(raw: string): void {
    try {
      const message = JSON.parse(raw) as { type?: string; sampleRate?: number; message?: string };
      if (message.type === "ready" && message.sampleRate) {
        this.sampleRate = message.sampleRate;
      }
      if (message.type === "error") {
        console.warn(`[tts] ${message.message ?? "语音合成失败"}`);
      }
      if (message.type === "done" || message.type === "closed") {
        this.resolveDone?.();
      }
    } catch {
      // Ignore non-JSON control frames.
    }
  }

  private async waitForPlaybackIdle(timeoutMs: number): Promise<boolean> {
    const startedAt = performance.now();
    while (performance.now() - startedAt < timeoutMs) {
      const queuedMs = this.context ? Math.max(0, (this.nextStartTime - this.context.currentTime) * 1000) : 0;
      if (this.sources.size === 0 && queuedMs <= 30) return true;
      await sleep(80);
    }
    return false;
  }

  private playPcm(data: ArrayBuffer): void {
    if (!this.context || data.byteLength < 2) return;
    const bytes = data.byteLength % 2 === 0 ? data : data.slice(0, data.byteLength - 1);
    const pcm = new Int16Array(bytes);
    if (pcm.length === 0) return;

    const audioBuffer = this.context.createBuffer(1, pcm.length, this.sampleRate);
    const channel = audioBuffer.getChannelData(0);
    for (let index = 0; index < pcm.length; index += 1) {
      channel[index] = Math.max(-1, Math.min(1, pcm[index] / 32768));
    }

    const source = this.context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.context.destination);
    this.sources.add(source);
    source.addEventListener("ended", () => {
      this.sources.delete(source);
    });
    const startAt = Math.max(this.context.currentTime + 0.02, this.nextStartTime);
    source.start(startAt);
    this.nextStartTime = startAt + audioBuffer.duration;
  }
}

const speechPlayer = new PcmSpeechPlayer();

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
  sceneTitle.textContent = currentScene().title;
  sessionState.textContent = sessionEnded ? "已总结" : isRunning ? "讨论中" : activeTopic ? "可追问" : "未开始";
  startButton.textContent = activeTopic ? "提交追问" : "开始讨论";
  startButton.disabled = isRunning || sessionEnded;
  endButton.disabled = !activeTopic || isRunning || sessionEnded;
  sceneSelect.disabled = isRunning;
  voiceButton.textContent = voiceEnabled ? "语音开启" : "语音关闭";
  voiceButton.classList.toggle("is-on", voiceEnabled);
}

function renderScene(): void {
  sceneSelect.value = currentSceneId;
  sceneImage.src = currentScene().art;
  sceneImage.alt = currentScene().alt;
  sceneTitle.textContent = currentScene().title;
  renderSettings();
  renderSeats();
  updateStatus();
}

function renderSettings(): void {
  peopleSettings.innerHTML = people
    .map(
      (person) => `
        <article class="person-editor" data-person-id="${person.id}">
          <div class="person-editor-head">
            <span class="color-dot" style="--person-color: ${person.color}"></span>
            <input class="name-input" data-field="name" value="${escapeHtml(person.name)}" aria-label="姓名" />
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
  const positions = currentScene().seats;
  seatLayer.innerHTML = people
    .map((person, index) => {
      const isActive = activeSpeakerId === person.id;
      const position = positions[index] ?? positions[0];
      const bubbleText = getBubbleText(activeText);

      return `
        <article
          class="seat ${isActive ? "is-active" : ""}"
          style="--bubble-x:${position.bubbleX}%; --bubble-y:${position.bubbleY}%; --label-x:${position.labelX}%; --label-y:${position.labelY}%; --person-color:${person.color}"
        >
          ${
            isActive
              ? `<div class="pixel-bubble" aria-live="polite"><div class="pixel-bubble-text">${escapeHtml(bubbleText || "思考中...")}<span class="type-cursor"></span></div></div>`
              : ""
          }
          <div class="seat-label">
            <strong>${escapeHtml(person.name)}</strong>
            <span>${person.speechStyle}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function getBubbleText(text: string): string {
  return text;
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
            <span>${escapeHtml(entry.speakerName ?? entry.type)}</span>
            <span>${entry.phase ? phaseText(entry.phase) : `第 ${entry.round} 轮`}</span>
          </div>
          <p>${escapeHtml(entry.text)}</p>
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

function resetSessionForScene(nextSceneId: SceneId): void {
  speechPlayer.stop();
  terminateWorkers();
  currentSceneId = nextSceneId;
  people = clonePeople(currentScene().people);
  transcript = [];
  activeTopic = "";
  activeQuestion = "";
  activeSpeakerId = undefined;
  activeText = "";
  round = 0;
  isRunning = false;
  sessionEnded = false;
  lastConclusion = "";
  typewriterSequence = Promise.resolve(false);
  questionInput.value = "";
  activeSpeaker.textContent = "暂无发言";
  activeSpeech.textContent = "输入议题后，成员会开始讨论。";
  renderScene();
  renderTranscript();
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

function renderActiveSpeech(speaker: PersonConfig, text: string): void {
  activeSpeech.innerHTML = `<strong style="color:${speaker.color}">${escapeHtml(speaker.name)}</strong><p>${escapeHtml(text)}</p>`;
  renderSeats();
  scrollActiveBubbleToBottom();
}

function scrollActiveBubbleToBottom(): void {
  window.requestAnimationFrame(() => {
    const bubbleText = seatLayer.querySelector<HTMLDivElement>(".pixel-bubble-text");
    if (bubbleText) {
      bubbleText.scrollTop = bubbleText.scrollHeight;
    }
  });
}

async function revealSpeechText(
  speaker: PersonConfig,
  nextText: string,
  onTick: (visibleText: string) => Promise<boolean> | boolean
): Promise<boolean> {
  const startIndex = activeText.length;
  if (nextText.length <= startIndex) return onTick(activeText);

  for (let index = startIndex + 1; index <= nextText.length; index += 1) {
    activeText = nextText.slice(0, index);
    renderActiveSpeech(speaker, activeText);

    const interrupted = await onTick(activeText);
    if (interrupted) return true;

    const currentChar = activeText[index - 1];
    const delay = voiceEnabled
      ? { comma: 220, sentence: 420, normal: 150 }
      : { comma: 100, sentence: 180, normal: 46 };
    if (/[，、,]/.test(currentChar)) {
      await sleep(delay.comma);
    } else if (/[。！？；.!?;]/.test(currentChar)) {
      await sleep(delay.sentence);
    } else {
      await sleep(delay.normal);
    }
  }

  return false;
}

function triggerInterruptEffect(name: string): void {
  interruptEffect.textContent = `${name} 打断!`;
  interruptEffect.classList.remove("is-bursting");
  void interruptEffect.offsetWidth;
  interruptEffect.classList.add("is-bursting");
  window.setTimeout(() => {
    interruptEffect.classList.remove("is-bursting");
  }, 1000);
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

async function generateSpeech(
  speaker: PersonConfig,
  turnType: "speech" | "interrupt" | "conclusion",
  intent: SpeakerIntent,
  onText: (text: string) => Promise<boolean> | boolean,
  interruption?: { speakerName: string; partialText: string; reason: string }
): Promise<{ text: string; interrupted: boolean }> {
  const controller = new AbortController();
  const response = await fetch("/api/ai/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify({
      person: speaker,
      people,
      snapshot: getSnapshot(),
      turnType,
      intent,
      interruption,
      partialText: interruption?.partialText
    })
  });

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || "模型调用失败。");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let interrupted = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    text += decoder.decode(value, { stream: true });
    interrupted = await onText(text);
    if (interrupted) {
      controller.abort();
      break;
    }
  }

  text += decoder.decode();
  return { text: text.trim(), interrupted };
}

async function speak(
  intent: SpeakerIntent,
  type: TranscriptEntry["type"] = "speech",
  interruption?: { speakerName: string; partialText: string; reason: string },
  allowConclusion = true
): Promise<{ concluded: boolean; speakerId?: number }> {
  const speaker = people.find((person) => person.id === intent.personId);
  if (!speaker) return { concluded: false };
  const effectiveIntent = allowConclusion ? intent : { ...intent, shouldConclude: false };
  const effectiveType = allowConclusion ? type : "speech";

  activeSpeakerId = speaker.id;
  activeText = "";
  activeSpeaker.textContent = `${speaker.name} 发言中`;
  renderSeats();
  await speechPlayer.start(speaker).catch((error) => {
    console.warn("[tts] start failed", error);
  });

  let checkedInterrupt = false;
  let chosenInterruption: SpeakerIntent | undefined;
  let audioTextLength = 0;

  try {
    const result = await generateSpeech(
      speaker,
      effectiveType === "conclusion" || effectiveIntent.shouldConclude ? "conclusion" : interruption ? "interrupt" : "speech",
      effectiveIntent,
      async (text) => {
        const audioDelta = text.slice(audioTextLength);
        if (audioDelta) {
          audioTextLength = text.length;
          speechPlayer.send(audioDelta);
        }
        typewriterSequence = typewriterSequence.then(() =>
          revealSpeechText(speaker, text, async (visibleText) => {
            if (effectiveIntent.shouldConclude || effectiveType === "conclusion" || checkedInterrupt || visibleText.length < 38) return false;

            const spokenRatio = Math.min(0.9, Math.max(0.32, visibleText.length / 180));
            checkedInterrupt = true;
            await sleep(160);
            chosenInterruption = await maybeInterrupt(speaker, spokenRatio);
            return Boolean(chosenInterruption);
          })
        );
        return typewriterSequence;
      },
      interruption
    );

    activeText = result.text;
  } catch (error) {
    speechPlayer.stop();
    activeText = error instanceof Error ? `模型调用失败：${error.message}` : "模型调用失败。";
    renderActiveSpeech(speaker, activeText);
    addEntry({
      type: "system",
      speakerName: "系统",
      text: activeText,
      phase: getPhase()
    });
    activeSpeakerId = undefined;
    activeSpeaker.textContent = "模型调用失败";
    renderSeats();
    return { concluded: false, speakerId: speaker.id };
  }

  if (chosenInterruption) {
    speechPlayer.stop();
    const interruptionIntent = allowConclusion ? chosenInterruption : { ...chosenInterruption, shouldConclude: false };
    addEntry({
      type: effectiveType,
      speakerId: speaker.id,
      speakerName: speaker.name,
      text: `${activeText}（被打断）`,
      phase: getPhase()
    });
    const interrupter = people.find((person) => person.id === interruptionIntent.personId);
    triggerInterruptEffect(interrupter?.name ?? "有人");
    addEntry({
      type: "interrupt",
      speakerId: interruptionIntent.personId,
      speakerName: interrupter?.name,
      text: `${interrupter?.name ?? "有人"}插入发言。触发原因：${interruptionIntent.reason}`,
      phase: getPhase()
    });
    const interruptResult = await speak(
      interruptionIntent,
      interruptionIntent.shouldConclude ? "conclusion" : "speech",
      {
        speakerName: speaker.name,
        partialText: activeText,
        reason: interruptionIntent.reason
      },
      allowConclusion
    );
    return { concluded: interruptResult.concluded || interruptionIntent.shouldConclude, speakerId: interruptionResultSpeakerId(interruptResult, interruptionIntent) };
  }

  const audioWaitMs = Math.min(60000, Math.max(18000, activeText.length * 360 + 8000));
  await speechPlayer.finishAndWait(audioWaitMs);

  addEntry({
    type: effectiveIntent.shouldConclude ? "conclusion" : effectiveType,
    speakerId: speaker.id,
    speakerName: speaker.name,
    text: activeText,
    phase: getPhase()
  });
  lastConclusion = effectiveIntent.shouldConclude ? `${speaker.name}代表小组宣读结论：${activeText}` : lastConclusion;
  activeSpeakerId = undefined;
  activeSpeaker.textContent = "等待下一轮";
  renderSeats();
  return { concluded: effectiveIntent.shouldConclude, speakerId: speaker.id };
}

function interruptionResultSpeakerId(
  result: { concluded: boolean; speakerId?: number },
  fallback: SpeakerIntent
): number {
  return result.speakerId ?? fallback.personId;
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
  const roundParticipants = new Set<number>();
  const minParticipantsBeforeConclusion = Math.min(3, people.length);
  const maxTurns = Math.max(people.length + 2, Math.min(10, people.length + 1 + Math.round(question.length / 24)));

  for (let turn = 0; turn < maxTurns && !concluded && !sessionEnded; turn += 1) {
    round += 1;
    updateStatus();
    const intents = await evaluateAll();
    const sortedIntents = intents.sort((a, b) => b.desire + b.confidence * 0.36 - (a.desire + a.confidence * 0.36));
    const selected = roundParticipants.size < minParticipantsBeforeConclusion
      ? sortedIntents.find((intent) => !roundParticipants.has(intent.personId)) ?? sortedIntents[0]
      : sortedIntents[0];
    if (!selected) break;
    const allowConclusion = roundParticipants.size >= minParticipantsBeforeConclusion;
    const beforeSpeakIndex = transcript.length;
    const result = await speak(selected, selected.shouldConclude ? "conclusion" : "speech", undefined, allowConclusion);
    transcript.slice(beforeSpeakIndex).forEach((entry) => {
      if (entry.speakerId && (entry.type === "speech" || entry.type === "conclusion")) {
        roundParticipants.add(entry.speakerId);
      }
    });
    if (result.speakerId) roundParticipants.add(result.speakerId);
    concluded = result.concluded && roundParticipants.size >= minParticipantsBeforeConclusion;
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
    `${people.length}位成员共发生 ${interruptions} 次打断仲裁，发言参与度为：${participation}。`,
    `主要结论：${conclusions.slice(-3).join("；") || "尚未形成明确结论"}。`,
    "建议后续把结论拆成负责人、截止时间和验证指标，避免共识停留在口头层面。"
  ].join("\n");
}

function endSession(): void {
  sessionEnded = true;
  speechPlayer.stop();
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

sceneSelect.addEventListener("change", () => {
  const nextSceneId = sceneSelect.value as SceneId;
  if (nextSceneId === currentSceneId || isRunning) return;
  resetSessionForScene(nextSceneId);
});

voiceButton.addEventListener("click", () => {
  voiceEnabled = !voiceEnabled;
  if (!voiceEnabled) {
    speechPlayer.stop();
  }
  updateStatus();
});

renderScene();
renderTranscript();
bindSettingsEvents();
updateStatus();
