// Quaver — 轻量异步提示（非阻塞 toast）
// 全局单例：bootShell() 调一次 mountNotices()，之后任何地方 notice(...) 即可。
// 定位顶部居中、z-index 80 —— 高于 .np(50) / .player(60) / 浮窗(70)，低于窗口按钮(90)，
// 所以正在播放页展开、播放条与队列浮窗都在时也看得见。
// 容器 pointer-events:none：否则会吞掉 .player 整条拖拽 seek（见 components/PlayerBar.ts）。

export type NoticeKind = "info" | "warn" | "error";

const DEDUPE_MS = 3000; // 同文案去重窗口：轮询/重试失败不刷屏
const MAX_VISIBLE = 4;
const TTL: Record<NoticeKind, number> = { info: 2600, warn: 4200, error: 6500 };

let layer: HTMLElement | null = null;
const lastShown = new Map<string, number>();

/** 任意值 → 可读文案（unhandledrejection 的 reason 不保证是 Error）*/
export function errText(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e) ?? String(e);
  } catch {
    return String(e);
  }
}

function ensureLayer(): HTMLElement {
  if (layer) return layer;
  layer = document.createElement("div");
  layer.className = "notice-layer";
  layer.id = "notice-layer";
  layer.setAttribute("role", "status");
  layer.setAttribute("aria-live", "polite"); // 读屏播报，但不抢焦点
  document.body.append(layer);
  return layer;
}

function dismiss(el: HTMLElement, immediate = false): void {
  if (!el.isConnected) return;
  if (immediate) {
    el.remove();
    return;
  }
  el.classList.add("out");
  window.setTimeout(() => el.remove(), 200); // 与 .notice.out 过渡时长一致
}

export function notice(msg: string, kind: NoticeKind = "info"): void {
  const text = String(msg ?? "").trim();
  if (!text) return;

  const now = Date.now();
  if (now - (lastShown.get(text) ?? 0) < DEDUPE_MS) return;
  lastShown.set(text, now);
  // 去重表只用于短期判重，顺手清掉过期项，避免长会话里无限增长
  if (lastShown.size > 64) for (const [k, t] of lastShown) if (now - t > DEDUPE_MS) lastShown.delete(k);

  const box = ensureLayer();
  const el = document.createElement("div");
  el.className = `notice ${kind}`;
  el.textContent = text; // textContent 而非 innerHTML：错误文案含后端字符串，别当 HTML 解析
  el.title = "点击关闭";
  el.onclick = () => dismiss(el);
  box.append(el);

  let timer = window.setTimeout(() => dismiss(el), TTL[kind]);
  el.addEventListener("pointerenter", () => window.clearTimeout(timer)); // 悬停续命，方便读长文案
  el.addEventListener("pointerleave", () => {
    timer = window.setTimeout(() => dismiss(el), 1200);
  });

  // 超上限先收掉最旧的（immediate 同步移除，故每次取 children[0] 都对）
  for (let i = box.children.length - MAX_VISIBLE; i > 0; i--) dismiss(box.children[0] as HTMLElement, true);
}

/** 只调一次（bootShell）：装全局兜底，任何没被 catch 的错误都变成一条提示。*/
export function mountNotices(): void {
  ensureLayer();
  window.addEventListener("unhandledrejection", (e) => {
    console.error("[unhandledrejection]", e.reason);
    notice(errText(e.reason), "error");
  });
  // 资源加载失败（img/script）不冒泡，故非 capture 监听只会收到脚本运行时错误；
  // 但跨源脚本错误会以脱敏后的 "Script error." 到达，无任何可用信息，直接丢弃
  window.addEventListener("error", (e) => {
    if (!e.error && /^Script error\.?$/i.test(e.message)) return;
    console.error("[window.error]", e.error ?? e.message);
    notice(errText(e.error ?? e.message), "error");
  });
}
