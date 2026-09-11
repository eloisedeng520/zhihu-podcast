export type Stage = "fetching" | "analyzing" | "writing" | "reviewing" | "synthesizing" | "ready";
export type Paragraph = { id: string; text: string };
export type Answer = { id: string; title: string; author: string; url: string; paragraphs: Paragraph[]; fetchedAt: string; incomplete?: boolean };
export type KnowledgeCategory = "hot" | "columns" | "rings";
export type KnowledgeItem = { id: string; title: string; description: string; labels: string[]; category?: KnowledgeCategory; author?: string; sourceName?: string; metric?: number };
export type Outline = { thesis: string; themes: { title: string; summary: string; sourceIds: string[] }[]; limitations: string[] };
export type Segment = { id: string; speaker: "host" | "guest"; chapter: string; text: string; kind: "paraphrase" | "quote" | "transition"; sourceIds: string[]; duration?: number; audioKey?: string };
export type Episode = {
  id: string; answerId: string; minutes: 3 | 8; stage: Stage; status: "pending" | "working" | "failed" | "ready";
  title: string; createdAt: string; updatedAt: string; source?: Answer; outline?: Outline; segments: Segment[];
  error?: string; review?: { passed: boolean; issues: string[] }; completedAudio: number;
};
export type ServiceStatus = { name: string; configured: boolean; detail: string };
export type ConnectionStatus = { ready: boolean; textReady: boolean; audioReady: boolean; services: ServiceStatus[] };
export function filterKnowledgeItems(items: KnowledgeItem[], query: string): KnowledgeItem[] {
  const keyword = query.trim().toLocaleLowerCase("zh-CN");
  if (!keyword) return items;
  return items.filter(item =>
    [item.title, item.description, ...item.labels]
      .join(" ")
      .toLocaleLowerCase("zh-CN")
      .includes(keyword)
  );
}
export function filterKnowledgeCategory(items:KnowledgeItem[],category:KnowledgeCategory):KnowledgeItem[]{
  return items.filter(item=>(item.category||"hot")===category);
}
export type PlaybackRate = 0.75 | 1 | 1.25 | 1.5 | 2;
export const playbackRates: PlaybackRate[] = [0.75, 1, 1.25, 1.5, 2];
export function choosePlaybackRate(audio: { playbackRate: number } | null, selected: PlaybackRate): PlaybackRate {
  if (audio) audio.playbackRate = selected;
  return selected;
}
export const stages: { id: Stage; label: string; detail: string }[] = [
  { id: "fetching", label: "读取回答", detail: "获取知乎原文与作者信息" },
  { id: "analyzing", label: "理解观点", detail: "梳理论点、故事与适用边界" },
  { id: "writing", label: "编排对谈", detail: "将书面表达改编成自然访谈" },
  { id: "reviewing", label: "核对原文", detail: "逐段检查改编是否忠实" },
  { id: "synthesizing", label: "录制声音", detail: "逐段合成两位 AI 主播的声音" },
  { id: "ready", label: "节目就绪", detail: "戴上耳机，听见一个好回答" },
];
