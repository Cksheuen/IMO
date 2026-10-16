import {
  parseMaterialDocument,
  type MaterialInput,
  type MaterialGroup,
  type ReviewMaterial,
} from "./reviewMaterials";
import type { AppearanceSelection } from "./globalSelection";
/**
 * 评论服务传输层 —— 页面访问本机 loopback 的唯一出口（HARD-GATE 25 定向豁免）。
 *
 * 为什么需要它：评审页在 file:// 或任意静态端口下打开，localStorage 按 origin
 * 隔离，agent 读不到、也写不进。把评论收敛到 127.0.0.1 服务后，页面与 agent
 * 共用同一份数据，agent 不再依赖 computer-use 点浏览器 UI。
 *
 * 边界（eslint 在此文件只放行 fetch，XHR/WebSocket/EventSource 仍禁用）：
 * - 只连 127.0.0.1，绝不连任何远端；不携带凭据（评审页是要分享的产物）。
 * - 不做 schema 校验：服务端已用 davidFeedback.ts 的纯函数校验，
 *   这里只负责搬运与错误分类，避免两套校验产生裂缝。
 */
import type { DavidFeedbackDocument } from "./davidFeedback";

/** 默认端口与 serve-feedback.mjs 保持一致。 */
export const DEFAULT_FEEDBACK_PORT = 5180;

export const defaultFeedbackBaseUrl = (): string =>
  `http://127.0.0.1:${DEFAULT_FEEDBACK_PORT}`;

/**
 * 允许的评论服务主机：loopback 或私网/CGNAT 字面量 IPv4。与 reviewSpec.ts 的
 * validateFeedbackService 保持同一口径，构成 HARD-GATE 25 的传输层兜底——
 * 即使数据层校验被绕过（例如 dev 态覆盖钩子），fetch 出口仍然不放行公网主机。
 * 放宽到私网是为了支持内网访问；公网仍一律拒绝。
 */
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const PRIVATE_V4 = [
  /^10\./, // RFC1918
  /^192\.168\./, // RFC1918
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC1918
  /^169\.254\./, // link-local
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT 100.64/10
  /^127\./, // loopback
];
export const isAllowedFeedbackHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase();
  return (
    LOOPBACK_HOSTNAMES.has(host) ||
    PRIVATE_V4.some((pattern) => pattern.test(host))
  );
};

/**
 * 归一化并强制校验评论服务地址。任何非 http(s)、非 loopback/私网的地址都直接抛错，
 * 绝不产生一次出网请求。
 */
export const assertLoopbackFeedbackBaseUrl = (raw: string): string => {
  const baseUrl = raw.replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`非法评论服务地址：${baseUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `评论服务只允许 http(s) loopback/私网，拒绝协议 ${url.protocol}（${baseUrl}）`,
    );
  }
  if (!isAllowedFeedbackHost(url.hostname)) {
    throw new Error(
      `评论服务只允许 loopback/私网主机（127.0.0.1/localhost/私网 IP），拒绝 ${url.hostname}（HARD-GATE 25）`,
    );
  }
  return baseUrl;
};

/**
 * Dev/test 态的服务地址覆盖。
 *
 * 静态评审产物始终经内嵌 #review-data 的 service.baseUrl 得到地址（见
 * render-review.mjs 的 DAVID_FEEDBACK_BASE_URL/DAVID_FEEDBACK_PORT）；本钩子只
 * 服务 vite dev sample 页（src/main.tsx 的 data-dev-sample 分支刻意不读
 * #review-data）。browser 测试启动 vite 时注入
 * VITE_DAVID_FEEDBACK_BASE_URL=http://127.0.0.1:<本测试独占且无监听的端口>，
 * 让离线态确定性地指向「已验证连接拒绝」的端口，而不是假设开发机的 5180 恰好
 * 空闲。生产构建中该变量不存在，vite 将其静态替换为 undefined；覆盖值同样要过
 * assertLoopbackFeedbackBaseUrl，非 loopback 一律拒绝。
 */
const devOverrideFeedbackBaseUrl = (): string | undefined => {
  if (!import.meta.env?.DEV) return undefined;
  const value = import.meta.env?.VITE_DAVID_FEEDBACK_BASE_URL;
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

export type FeedbackSnapshot = {
  doc: DavidFeedbackDocument;
  version: number;
};

/** 服务端拒绝覆盖（版本不符或 base 字段冲突）。调用方应重读后重放。 */
export class FeedbackConflictError extends Error {
  readonly currentDoc: DavidFeedbackDocument | null;
  readonly currentVersion: number;
  constructor(
    message: string,
    currentDoc: DavidFeedbackDocument | null,
    currentVersion: number,
  ) {
    super(message);
    this.name = "FeedbackConflictError";
    this.currentDoc = currentDoc;
    this.currentVersion = currentVersion;
  }
}

/** 服务未启动 / 不可达。页面据此进入离线态，引导用户让 agent 拉起服务。 */
export class FeedbackOfflineError extends Error {
  constructor(baseUrl: string) {
    super(`评论服务未启动或不可达（${baseUrl}）`);
    this.name = "FeedbackOfflineError";
  }
}

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const selectionHasRegionText = (selection: unknown): boolean =>
  isRecord(selection) &&
  isRecord(selection.context) &&
  selection.context.regionText !== undefined;

const entryHasRegionText = (entry: unknown): boolean => {
  if (!isRecord(entry) || !isRecord(entry.scope)) return false;
  return (
    selectionHasRegionText(entry.scope.selection) ||
    (Array.isArray(entry.scope.selections) &&
      entry.scope.selections.some(selectionHasRegionText))
  );
};

const requiresRegionText = (body?: Json): boolean =>
  Boolean(
    body &&
    (selectionHasRegionText(body.addSelection) ||
      entryHasRegionText(body.entry) ||
      (isRecord(body.doc) &&
        Array.isArray(body.doc.entries) &&
        body.doc.entries.some(entryHasRegionText))),
  );

export class FeedbackTransport {
  readonly baseUrl: string;
  supportsMultiSelection = false;
  supportsFeedbackDeletion = false;
  supportsFeedbackTasks = false;
  supportsFeedbackBatch = false;
  supportsReviewMaterials = false;
  supportsRegionText = false;

  constructor(baseUrl?: string) {
    this.baseUrl = assertLoopbackFeedbackBaseUrl(
      baseUrl ?? devOverrideFeedbackBaseUrl() ?? defaultFeedbackBaseUrl(),
    );
  }

  /** 探活。不抛错——调用方用返回值决定在线/离线，不该为此进 catch。 */
  async health(timeoutMs = 800): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: controller.signal,
        redirect: "error",
        credentials: "omit",
      });
      const info = await res.json().catch(() => ({}));
      this.supportsMultiSelection =
        res.ok &&
        Array.isArray(info?.capabilities) &&
        info.capabilities.includes("multi-selection");
      this.supportsReviewMaterials =
        res.ok &&
        Array.isArray(info?.capabilities) &&
        info.capabilities.includes("design-materials");
      this.supportsFeedbackTasks =
        res.ok &&
        Array.isArray(info?.capabilities) &&
        info.capabilities.includes("feedback-tasks-v1");
      this.supportsFeedbackBatch =
        res.ok &&
        Array.isArray(info?.capabilities) &&
        info.capabilities.includes("feedback-batch-v1");
      this.supportsFeedbackDeletion =
        res.ok &&
        Array.isArray(info?.capabilities) &&
        info.capabilities.includes("feedback-delete");
      this.supportsRegionText =
        res.ok &&
        Array.isArray(info?.capabilities) &&
        info.capabilities.includes("region-text");
      return res.ok;
    } catch {
      this.supportsRegionText = false;
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  private async call(
    method: string,
    urlPath: string,
    body?: Json,
  ): Promise<Json> {
    if (requiresRegionText(body)) {
      // Recheck on each write so retry after a service upgrade works without
      // reloading the page or losing the pending selection.
      if (!(await this.health())) throw new FeedbackOfflineError(this.baseUrl);
      if (!this.supportsRegionText) {
        throw new Error(
          "评论服务版本过旧，尚不支持完整选区文字。请重启本机评论服务后重试；当前选区已保留。",
        );
      }
    }
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${urlPath}`, {
        method,
        redirect: "error",
        credentials: "omit",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new FeedbackOfflineError(this.baseUrl);
    }
    const text = await res.text();
    let payload: unknown = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error(`评论服务返回非 JSON（${res.status}）`);
      }
    }
    const record = isRecord(payload) ? payload : {};
    if (res.status === 409) {
      throw new FeedbackConflictError(
        String(record.error ?? "评论服务拒绝覆盖（冲突）"),
        (record.currentDoc as DavidFeedbackDocument | null) ?? null,
        typeof record.currentVersion === "number" ? record.currentVersion : 0,
      );
    }
    if (!res.ok) {
      throw new Error(
        String(record.error ?? `${method} ${urlPath} 失败（${res.status}）`),
      );
    }
    return record;
  }

  async loadMaterials(slug: string) {
    return parseMaterialDocument(
      await this.call("GET", `/materials/${encodeURIComponent(slug)}`),
    );
  }
  async addMaterialGroup(
    slug: string,
    group: MaterialGroup,
    expectedVersion: number,
  ) {
    return parseMaterialDocument(
      await this.call("POST", `/materials/${encodeURIComponent(slug)}/groups`, {
        group,
        expectedVersion,
      }),
    );
  }
  async addMaterial(
    slug: string,
    material: MaterialInput,
    expectedVersion: number,
  ) {
    return parseMaterialDocument(
      await this.call("POST", `/materials/${encodeURIComponent(slug)}/items`, {
        material,
        expectedVersion,
      }),
    );
  }
  async materialContent(slug: string, id: string) {
    return (await this.call(
      "GET",
      `/materials/${encodeURIComponent(slug)}/${encodeURIComponent(id)}/content`,
    )) as { item: ReviewMaterial; content: string; localPath: string };
  }

  private static toSnapshot(payload: Json): FeedbackSnapshot {
    return {
      doc: payload.doc as DavidFeedbackDocument,
      version: typeof payload.version === "number" ? payload.version : 0,
    };
  }

  /** 读取；服务上还没有该 slug 时返回 undefined（不是错误）。 */
  async load(slug: string): Promise<FeedbackSnapshot | undefined> {
    try {
      return FeedbackTransport.toSnapshot(
        await this.call("GET", `/feedback/${encodeURIComponent(slug)}`),
      );
    } catch (error) {
      if (
        error instanceof Error &&
        /（404）|slug 无评论数据/.test(error.message)
      ) {
        return undefined;
      }
      throw error;
    }
  }

  /** 整稿合并导入（服务端走 mergeFeedbackDocuments）。 */
  async put(
    slug: string,
    doc: DavidFeedbackDocument,
    expectedVersion?: number,
  ): Promise<FeedbackSnapshot> {
    return FeedbackTransport.toSnapshot(
      await this.call("PUT", `/feedback/${encodeURIComponent(slug)}`, {
        doc,
        ...(expectedVersion === undefined ? {} : { expectedVersion }),
      }),
    );
  }

  async loadFeedbackTasks(slug: string): Promise<FeedbackTaskSnapshot> {
    return (await this.call(
      "GET",
      `/feedback/${encodeURIComponent(slug)}/tasks`,
    )) as FeedbackTaskSnapshot;
  }
  async requestFeedbackBatch(slug: string): Promise<FeedbackTaskSnapshot> {
    return (await this.call(
      "POST",
      `/feedback/${encodeURIComponent(slug)}/tasks`,
      { action: "queue-all" },
    )) as FeedbackTaskSnapshot;
  }
  async requestFeedbackTask(
    slug: string,
    entryId: string,
    action: "queue" | "cancel",
    inputRevision?: string,
    jobId?: string,
  ): Promise<FeedbackTaskSnapshot> {
    return (await this.call(
      "POST",
      `/feedback/${encodeURIComponent(slug)}/tasks`,
      {
        action,
        entryId,
        ...(action === "queue" ? { inputRevision } : { jobId }),
      },
    )) as FeedbackTaskSnapshot;
  }
  async deleteEntry(
    slug: string,
    entryId: string,
    expectedVersion: number,
  ): Promise<FeedbackSnapshot> {
    return FeedbackTransport.toSnapshot(
      await this.call(
        "DELETE",
        `/feedback/${encodeURIComponent(slug)}/entries/${encodeURIComponent(entryId)}`,
        { expectedVersion },
      ),
    );
  }
  async addEntry(
    slug: string,
    entry: unknown,
    expectedVersion?: number,
  ): Promise<FeedbackSnapshot> {
    return FeedbackTransport.toSnapshot(
      await this.call("POST", `/feedback/${encodeURIComponent(slug)}/entries`, {
        entry,
        ...(expectedVersion === undefined ? {} : { expectedVersion }),
      }),
    );
  }

  async addReply(
    slug: string,
    entryId: string,
    reply: unknown,
    expectedVersion?: number,
  ): Promise<FeedbackSnapshot> {
    return FeedbackTransport.toSnapshot(
      await this.call(
        "PATCH",
        `/feedback/${encodeURIComponent(slug)}/entries/${encodeURIComponent(entryId)}/replies`,
        {
          reply,
          ...(expectedVersion === undefined ? {} : { expectedVersion }),
        },
      ),
    );
  }

  async patchEntry(
    slug: string,
    entryId: string,
    patch: {
      status?: string;
      decision?: string;
      suggestion?: string;
      addSelection?: AppearanceSelection;
      removeSelection?: AppearanceSelection;
    },
    expectedVersion?: number,
  ): Promise<FeedbackSnapshot> {
    return FeedbackTransport.toSnapshot(
      await this.call(
        "PATCH",
        `/feedback/${encodeURIComponent(slug)}/entries/${encodeURIComponent(entryId)}`,
        {
          ...patch,
          ...(expectedVersion === undefined ? {} : { expectedVersion }),
        },
      ),
    );
  }
}

/** 供离线横幅「复制启动指令」用：一句能直接粘给 agent 的话。 */
export const feedbackServeHint = (slug: string): string =>
  [
    "David 评论服务未启动，请帮我拉起它（在 david canonical 的 project 目录下）：",
    "  npm run david:feedback -- serve",
    `然后读取本页评论：npm run david:feedback -- get ${slug}`,
  ].join("\n");

export type FeedbackTask = {
  id: string;
  entryId: string;
  state: "queued" | "running" | "done" | "changed" | "failed" | "cancelled";
  hasNewInput: boolean;
  leaseUntil?: number;
  finishedAt?: string;
  message?: string;
};
export type FeedbackBatch = {
  id: string;
  state: "queued" | "running" | "done" | "failed";
  leaseUntil?: number;
};
export type FeedbackTaskSnapshot = {
  dispatch?: { available: boolean; reason?: string };
  batch?: FeedbackBatch;
  version: number;
  inputs: Record<string, string>;
  tasks: Record<string, FeedbackTask>;
};
