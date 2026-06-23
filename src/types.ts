export type Gender = "女" | "男" | "其他";

export type Trait =
  | "分析型"
  | "推进型"
  | "协调型"
  | "质疑型"
  | "总结型"
  | "倾听型";

export type SpeechStyle = "稳健陈述" | "主动打断" | "强势推进" | "温和接续" | "结构化总结";

export type DiscussionPhase = "opening" | "exploring" | "debating" | "concluding";

export interface PersonConfig {
  id: number;
  name: string;
  gender: Gender;
  traits: Trait[];
  speechStyle: SpeechStyle;
  interruptiveness: number;
  persistence: number;
  verbosity: number;
  color: string;
}

export interface TranscriptEntry {
  id: string;
  type: "user" | "speech" | "interrupt" | "conclusion" | "system" | "summary";
  speakerId?: number;
  speakerName?: string;
  text: string;
  phase?: DiscussionPhase;
  round: number;
  timestamp: number;
}

export interface DiscussionSnapshot {
  topic: string;
  question: string;
  phase: DiscussionPhase;
  round: number;
  transcript: TranscriptEntry[];
  currentSpeakerId?: number;
  activeText?: string;
}

export interface SpeakerIntent {
  personId: number;
  desire: number;
  interruptStrength: number;
  acceptsInterruption: number;
  utterance: string;
  reason: string;
  shouldConclude: boolean;
  confidence: number;
}

export type WorkerRequest =
  | {
      requestId: string;
      type: "evaluate";
      person: PersonConfig;
      snapshot: DiscussionSnapshot;
    }
  | {
      requestId: string;
      type: "yield";
      person: PersonConfig;
      snapshot: DiscussionSnapshot;
      challenger: SpeakerIntent;
      spokenRatio: number;
    };

export type WorkerResponse =
  | {
      requestId: string;
      type: "intent";
      intent: SpeakerIntent;
    }
  | {
      requestId: string;
      type: "yieldDecision";
      willYield: boolean;
      reason: string;
    };
