import type { Preparation } from "../lib/preparationModel";
export type ApiField = {
  name: string;
  type?: string;
  meaning?: string;
  target?: string;
};

/**
 * 轻量 brief / chips 元信息
 */
export type ReviewBrief = {
  visibleChange?: string; // ≤40 字：用户可感知界面或交互变化
  trigger?: string; // ≤40 字：生效条件/触发时机
  d2c?: string; // D2C 状态（如“是（卡片基础样式走 D2C）”）
  status?: string; // 状态标记（如“新增”、“改造”、“暂缓”、“已对齐”）
  changeType?: string; // 改动性质短标签（新增/修复/重构/验证），与 status（已验证/待人审）分离
};

/**
 * 文档式产品小节（位置/展示/交互/来源/兜底等）
 */
export type ProductSection = {
  title?: string;
  moduleId?: string;
  items?: Array<{ label?: string; text: string }>;
};

/**
 * 技术模块元信息
 */
export type TechModule = {
  id: string; // 如 'M1', 'M2'
  name: string;
  change?: "new" | "modify" | "variant" | "reuse" | string;
  color?: string; // 自定义色条，默认按 change 自动映射
  desc?: string;
};

export type TechBullet = string | { text: string; sub?: string[] };

/**
 * 技术要点代码块的语义行范围注释（1-based，含 endLine）。
 * 悬停 / 键盘聚焦对应行范围时，仅高亮该范围并弹出说明卡片。
 */
export type CodeAnnotation = {
  startLine: number;
  endLine: number;
  title: string;
  bullets: string[];
};

/**
 * 技术要点小节
 */
export type LogicGraph = {
  groups?: Array<{ id: string; label: string; nodeIds: string[] }>;
  nodes: Array<{
    id: string;
    label: string;
    description?: string[];
    status?: "context" | "changed" | "result";
    column?: number;
    row?: number;
  }>;
  edges: Array<{
    from: string;
    to: string;
    label?: string;
    kind?: "data" | "control" | "dependency";
  }>;
};

export type TechPoint = {
  /** Stable target for an authored codeFlow node. */
  id?: string;
  graph?: LogicGraph;
  /** Selecting this technical point temporarily previews an authored overlay. */
  preview?: { overlayId: string };
  title?: string; // 动作/问句式总结
  moduleId?: string; // 模块归属
  moduleName?: string; // 内联模块名
  moduleChange?: "new" | "modify" | "variant" | "reuse" | string;
  bullets?: TechBullet[]; // 圆圈子弹，支持嵌套
  pseudoCode?: string; // 伪代码块
  codeLabel?: string; // 伪代码/实现标签，如 "TypeScript" / "伪代码"
  codeAnnotations?: CodeAnnotation[]; // 代码块语义行范围注释（可选，严格校验）
  /** 技术要点上挂的方案改动块（可选，规则同 MappingRow.changeBlock）。 */
  changeBlock?: ChangeBlock;
};

/**
 * API 改动条目（支持结构化契约代码块与变更行高亮）
 */
export type ApiChangeItem = {
  title?: string;
  beId?: string; // 如 BE-F3-001
  codeLabel?: string; // 如 "Thrift" / "字段摘录" / "客户端契约" / "TypeScript"
  code?: string; // 完整上下文契约代码，行首 '+ ' 标改动行
  codeAnnotations?: CodeAnnotation[]; // 契约代码块语义行范围注释（可选，严格校验）
  bullets?: string[];
  fields?: ApiField[]; // 条目下挂的字段，支持点击高亮
};

/**
 * 跨模块/折叠补充信息 (cross)
 */
export type CrossSection = {
  note?: string; // 关键口径
  flow?: string[]; // 时序/步骤流
  state?: string[]; // 状态管理
  dataflow?: string[]; // 数据流
  edge?: string[]; // 异常态 & 兜底
  files?: string[]; // 涉及文件 / 组件
  seq?: {
    actors: Array<{ id: string; name: string }>;
    messages: Array<{
      from: string;
      to: string;
      label: string;
      kind?: "call" | "return" | "self";
    }>;
  };
};

/**
 * Richer copy for the inspector's three-column TRD table.
 * Existing requirement/change/api fields remain the compatibility fallback.
 */
export type TrdColumnContent = {
  /** Legacy column heading; new specs use MappingRow.title and detail subsection titles. */
  heading?: string;
  /** Legacy summary override; new specs use MappingRow.requirement/change. */
  summary?: string;
  points?: Array<{ label?: string; text: string }>;
  bullets?: TechBullet[];
  pseudoCode?: string;
  codeLabel?: string;
  // 扩展字段
  positioning?: string; // 斜体定位句
  sections?: ProductSection[]; // 文档式产品大纲
  modules?: TechModule[]; // 技术模块列表
  techPoints?: TechPoint[]; // 技术要点小节列表
  /** Each node id names one code-bearing techPoint; edges explain actual relationships. */
  codeFlow?: LogicGraph;
  head?: string; // 接口概览
  endpoint?: string;
  beId?: string;
  status?: string;
  items?: ApiChangeItem[]; // 契约代码条目
  fields?: ApiField[]; // 字段列表
};

/**
 * 方案表达改动块（change block）：
 * 用统一结构表达「完全新增」「前后改动」「删除」三类方案变化——
 * add 说明新增原因与作用，modify/remove 给出改动前对照，migrate 对照迁移来源与本地实现。
 * 类型唯一真源在本文件；运行时校验见 src/lib/changeModel.ts，
 * 渲染组件见 src/components/change-block/ 下的 DiffCodeBlock 与 ChangeRationale。
 */
export type ChangeKind = "add" | "modify" | "migrate" | "remove";

export interface ChangeSide {
  codeAnnotations?: CodeAnnotation[];
  /** 代码语言标记（如 "TypeScript" / "Thrift"）；存在时按代码渲染，缺省按文本渲染。 */
  lang?: string;
  /** 代码内容（与 text 二选一）。 */
  code?: string;
  /** 纯文本内容（与 code 二选一）。 */
  text?: string;
}

export interface ChangeBlock {
  kind: ChangeKind;
  /** 为什么改：新增原因与作用 / 改动原因，面向技术读者；必填，<= 800 字符。 */
  rationale: string;
  /** modify/migrate/remove：改动前或迁移来源内容；add 禁止提供。 */
  before?: ChangeSide;
  /** add/modify/migrate：改动后内容；remove 禁止提供。 */
  after?: ChangeSide;
  /** 改动影响面（可选），渲染为折叠区。 */
  impact?: string;
}

export type MappingRow = {
  preparation?: Preparation;
  id: string;
  title?: string; // 可选功能点标题
  codePaths?: string[]; // 等宽代码路径引用条
  reviewBrief?: ReviewBrief; // 轻量 chips（变化、生效、D2C 等）
  d2c?: string; // 便捷字段：D2C chip
  /** 方案改动块（可选）：新增原因 / 前后对比，校验规则见 changeModel.ts。 */
  changeBlock?: ChangeBlock;
  requirement: string;
  change: string;
  api: {
    summary?: string;
    fields?: ApiField[];
    /** 显式 false = 本功能点无接口改动：隐藏 API 列内容与“查看接口”入口；
     *  缺省/true 保持兼容（照常展示）。判断逻辑统一走 rowApiChanged。 */
    changed?: boolean;
    /** 引用顶层 apiContracts 的 id 列表（可选）：每个 id 必须命中
     *  apiContracts[].id，不允许重复；跨引用与去重由 reviewSpec 严格校验。 */
    contractIds?: string[];
  };
  overviewSummary?: {
    /** Legacy short-copy override; new specs use the row requirement. */
    requirement?: string;
    /** Legacy short-copy override; new specs use the row change. */
    change?: string;
    api?: string;
  };
  trd?: {
    productDesign?: TrdColumnContent;
    technical?: TrdColumnContent;
    apiChange?: TrdColumnContent;
  };
  cross?: CrossSection; // 可选折叠补充信息
};

/**
 * David schema：节点交互形态
 * - highlight：点击仅高亮锚点
 * - drilldown：点击下钻到 children
 * - auto：有 children 视为 drilldown，否则 highlight（由 resolveInteraction 解析）
 */
export type ReviewInteraction = "highlight" | "drilldown" | "auto";

/**
 * David schema：下钻补充信息（全部为可选字符串数组）
 */
export type DeepDive = {
  summary?: string[];
  codePaths?: string[];
  logic?: string[];
  state?: string[];
  edgeCases?: string[];
  tests?: string[];
};

/**
 * David schema：递归评审节点。node id 全局唯一；
 * 每个节点（无论有无 children）都必须在 pageHtml 中存在
 * data-review-node-id 等于 target 或 id 的锚点；
 * interaction 缺省视为 auto（见 resolveInteraction）。
 */
export type ReviewNode = {
  id: string;
  label: string;
  interaction?: ReviewInteraction;
  target?: string;
  mappingIds?: string[];
  mapping?: MappingRow[];
  deepDive?: DeepDive;
  /** 复杂节点进入深层画板（HARD-GATE 29）：点击进入等比放大/平移的画板视图。 */
  canvas?: boolean;
  children?: ReviewNode[];
};

/**
 * 高保真复刻的由来契约（HARD-GATE 28 组件复用）。
 * 声明该 component root 的 pageHtml 是怎么来的、依据什么、能声称多少保真：
 * - component：复用/真渲染项目真实组件（path B，高保真复刻的首选路径）
 * - css-art：复用探测失败后手工 CSS 还原（path A，沿用第 23 条的限制）
 * - mockup：概念模式示意，不链接真实组件
 * codePaths 必须给出支撑证据文件；probe 记录复用探测方式（如 grep 组件名 / 读取渲染分支），
 * fidelity 只允许在 kind=component 且确实对照真实渲染产物时声明 pixel-vs-real，
 * 无真实组件证据不得声称 1:1。
 */
export type RenderSourceKind = "component" | "css-art" | "mockup";
export type RenderFidelity = "pixel-vs-real" | "structure" | "approx";

export type RenderSource = {
  kind: RenderSourceKind;
  codePaths?: string[];
  probe?: string;
  renderEvidence?: {
    recipe?: string;
    viewport?: string;
    screenshot?: string;
    capturedAt?: string;
  };
  /** 可选业务项目启动/采集配方；由 capture-component-evidence.mjs 执行。 */
  renderRecipe?: {
    projectRoot: string;
    startCommand: string;
    url: string;
    selector?: string;
    viewport?: string;
    readyTimeoutMs?: number;
  };
  fidelity?: RenderFidelity;
};

export type ReviewComponent = {
  id: string;
  label: string;
  kind?: string;
  kindLabel?: string;
  mapping: MappingRow[];
  evidence?: string[];
  /** 高保真复刻由来契约（HARD-GATE 28）；缺省表示未声明，不自动推断 1:1。 */
  source?: RenderSource;
  // David schema 扩展（全部可选，旧 components 不受影响）
  interaction?: ReviewInteraction;
  target?: string;
  children?: ReviewNode[];
  deepDive?: DeepDive;
};

/** 页面形态：常规屏幕 vs 逻辑图画板（canvas，节点可进入深层画板）。 */
export type PageKind = "screen" | "canvas";

/** 页面、节点与 overlay 之间的可验证交互关系。旧 spec 缺省为空，保持兼容。 */
export type ReviewPageInteraction = {
  source: string;
  trigger?: "click" | "hover" | "keyboard";
  action:
    "navigate" | "detail" | "highlight" | "show" | "hide" | "toggle" | "close";
  targetPageId?: string;
  targetNodeId?: string;
  /** show/hide/toggle/close 对应的 HTML 元素 ID。 */
  targetElementId?: string;
  label?: string;
};

/** 画板与真实业务组件的结构化对应关系。pageHtml 仍是视觉兜底，scene 用于联动。 */
export type ReviewSceneComponent = {
  id: string;
  /** 对应 review.components 的根组件 ID；用于总览/画板双向联动。 */
  componentId?: string;
  role: "screen" | "list" | "card" | "button" | "form" | "modal" | string;
  mappingIds?: string[];
  nodeId?: string;
  source?: {
    projectRoot?: string;
    file?: string;
    exportName?: string;
    selector?: string;
  };
  props?: Record<string, unknown>;
  state?: Record<string, unknown>;
};

export type ReviewScene = {
  components: ReviewSceneComponent[];
  state?: Record<string, unknown>;
};

export type PageSpec = {
  id: string;
  label: string;
  pageHtml: string;
  /** 当前页的简短工程落点；正文仍来自该页关联的组件。 */
  overview?: Pick<ReviewOverview, "title" | "summary">;
  /** 缺省视为 screen（旧 spec 兼容）；canvas 页用于逻辑图画板。 */
  kind?: PageKind;
  interactions?: ReviewPageInteraction[];
  /** 结构化画板语义层；与 pageHtml 并存，逐步替代不透明 DOM 约定。 */
  scene?: ReviewScene;
  graph?: {
    nodes: Array<{
      id: string;
      label: string;
      status?: "context" | "changed" | "result";
    }>;
    edges: Array<{
      from: string;
      to: string;
      kind?: "data" | "control" | "dependency";
      label?: string;
    }>;
  };
};

/**
 * 多 agent 协作同一 review HTML 的清单（HARD-GATE 30）。
 * 声明 page/node ownership、patch-only 约束与租约持有者，
 * 让只带相关上下文的 agent 知道哪些能改、哪些不能。
 * patchOnly 缺省 true：非 owner 不得改写；owner 也只做 patch-only 变更。
 */
export type CollaborationManifest = {
  schemaVersion: 1;
  patchOnly?: boolean;
  pages?: Array<{ pageId: string; owner: string; session?: string }>;
  nodes?: Array<{ ref: string; owner: string; session?: string }>;
  lease?: { holder: string; heartbeatAt?: string };
};

/**
 * David schema：轻量总览。缺省时由 reviewTree.resolveOverview 纯函数聚合，
 * 不修改输入数据。
 */
export type ReviewOverview = {
  title?: string;
  summary?: string;
  mapping?: MappingRow[];
};

/**
 * 待澄清问题（openQuestions）：PRD 与 Figma/设计稿不一致、
 * 或任何作者不确定、需要用户 review 后拍板的内容。
 * id 全局唯一；运行时严格校验见 src/lib/openQuestionModel.ts。
 */
export type OpenQuestion = {
  /** 全局唯一 id，如 "oq-1"。 */
  id: string;
  /** 短标题，必填，<= 120 字符。 */
  topic: string;
  /** 缺省 "open"；resolved 表示已有结论。 */
  status?: "open" | "resolved";
  /** 相关 PRD 原文/摘录，帮助用户理解，<= 2000 字符。 */
  prd?: string;
  /** PRD 位置（章节名/链接/锚点），<= 400 字符。 */
  prdRef?: string;
  /** Figma/设计稿侧观察到的内容，<= 2000 字符。 */
  design?: string;
  /** 设计稿位置（frame/节点名），<= 400 字符。 */
  designRef?: string;
  /** 不一致点 / 不确定点的客观描述，<= 2000 字符。 */
  conflict?: string;
  /** 候选方案，每项非空 <= 400 字符，最多 8 项。 */
  options?: string[];
  /** agent 倾向建议，<= 1000 字符；渲染层须可识别为建议而非事实。 */
  recommendation?: string;
};

/**
 * 扁平 API 契约字段。name 与 ApiField.name 语义一致，渲染层用它和
 * pageHtml 的 data-api-field token 联动。
 */
export type ApiContractProvision = "backend-defined" | "existing" | "missing";

export type ApiContractField = {
  /** 字段提供情况；缺省继承所属契约，未提供的补充需求必须明确标记。 */
  provision?: ApiContractProvision;
  /** 字段名，必填，<= 120 字符；与 ApiField.name 同口径。 */
  name: string;
  /** 字段类型（如 string / i64 / list<Guide>），<= 120 字符。 */
  type?: string;
  required?: boolean;
  /** 字段含义，<= 400 字符。 */
  meaning?: string;
};

/**
 * 扁平 API 契约（apiContracts）：后端接口未提供时，先按需求扁平列出
 * 预期结构并在实现（mapping.api.contractIds）中引用；后续拿到真实接口
 * 只需更新 contract（status 转 confirmed、字段对齐），mapping 引用不变。
 * id 全局唯一；运行时严格校验见 src/lib/contractModel.ts。
 */
export type ApiContract = {
  /** backend-defined=本次后端定义；existing=已有协议；missing=后端未提供。 */
  provision?: ApiContractProvision;
  /** 全局唯一 id，如 "contract-shooting-guide"。 */
  id: string;
  /** proposed=后端未提供的预期结构，必须显式展示；confirmed=真实接口。 */
  status: "proposed" | "confirmed";
  /** 契约标题，<= 160 字符。 */
  title?: string;
  /** 接口路径，<= 400 字符。 */
  endpoint?: string;
  /** GET/POST/...；不强制枚举（可能出现 RPC 方法名），<= 40 字符。 */
  method?: string;
  request?: ApiContractField[];
  response?: ApiContractField[];
  /** 迁移备注：真实接口与预期差异 / 迁移方式，<= 2000 字符。 */
  notes?: string;
};

export type ReviewData = {
  slug: string;
  title: string;
  subtitle: string;
  components: ReviewComponent[];
  pages?: PageSpec[];
  overview?: ReviewOverview;
  /** 待澄清问题列表（可选，旧 JSON 零改动）。 */
  openQuestions?: OpenQuestion[];
  /** 扁平 API 契约列表（可选，旧 JSON 零改动）。 */
  apiContracts?: ApiContract[];
  sourcePath?: string;
  /** 多 agent 协作清单（HARD-GATE 30）；缺省不限制。 */
  collaboration?: CollaborationManifest;
  /**
   * 本机评论服务地址（由 render-review.mjs 注入）。缺省时页面用
   * feedbackTransport 的默认 127.0.0.1:5180。刻意不含任何 token——
   * 评审页是要分享的产物，凭据会随文件外泄。
   */
  service?: { baseUrl: string };
};

export type ReviewSpec = ReviewData & {
  pageHtml?: string;
};

export type ReviewPayload = {
  data: ReviewData;
  pages: PageSpec[];
};
