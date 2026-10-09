import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "../ui/Modal";
import { IconButton } from "../ui/IconButton";
import { FeedbackTransport } from "../../lib/feedbackTransport";
import {
  MATERIAL_CSS_LIMIT,
  MATERIAL_IMAGE_LIMIT,
  type MaterialDocument,
  type MaterialGroup,
  type ReviewMaterial,
} from "../../lib/reviewMaterials";
import "./ReviewMaterialsPanel.css";

type Props = {
  open: boolean;
  onClose: () => void;
  slug: string;
  pages: { id: string; label: string }[];
  activePageId: string;
  serviceBaseUrl?: string;
};
type Draft = { kind: "png" | "css"; content: string; title: string };
export function ReviewMaterialsPanel({
  open,
  onClose,
  slug,
  pages,
  activePageId,
  serviceBaseUrl,
}: Props) {
  const transport = useMemo(
    () => new FeedbackTransport(serviceBaseUrl),
    [serviceBaseUrl],
  );
  const [doc, setDoc] = useState<MaterialDocument>();
  const [pageName, setPageName] = useState("");
  const [draft, setDraft] = useState<Draft>();
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{
    item: ReviewMaterial;
    content: string;
  }>();
  const previewSequence = useRef(0);
  const groupRequest = useRef<MaterialGroup | undefined>(undefined);
  const request = useRef<{ signature: string; id: string } | undefined>(
    undefined,
  );
  const groups = useMemo(() => {
    const byId = new Map<string, MaterialGroup>(
      pages.map((p) => [
        `page:${p.id}`,
        { id: `page:${p.id}`, label: p.label, pageId: p.id },
      ]),
    );
    doc?.groups.forEach((g) => byId.set(g.id, g));
    return [...byId.values()];
  }, [pages, doc]);
  useEffect(() => {
    if (!open) return;
    let stale = false;
    void (async () => {
      try {
        if (!(await transport.health()))
          throw new Error("本机资料服务不可达，请稍后重试。");
        if (!transport.supportsReviewMaterials)
          throw new Error("当前服务尚不支持设计资料，请更新本机 David 服务。");
        const next = await transport.loadMaterials(slug);
        if (!stale) {
          setDoc(next);
          setError("");
        }
      } catch (e) {
        if (!stale) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      stale = true;
    };
  }, [open, slug, transport]);
  const refresh = async () => {
    try {
      setDoc(await transport.loadMaterials(slug));
      setError("");
    } catch (e) {
      setError(String(e));
    }
  };
  const loadFile = async (file: File) => {
    if (busy) return;
    setError("");
    const kind =
      file.type === "image/png" || /\.png$/i.test(file.name)
        ? "png"
        : /\.css$/i.test(file.name) || file.type === "text/css"
          ? "css"
          : undefined;
    if (!kind) {
      setError("请选择 PNG 或 CSS 文件。");
      return;
    }
    if (
      file.size > (kind === "png" ? MATERIAL_IMAGE_LIMIT : MATERIAL_CSS_LIMIT)
    ) {
      setError(kind === "png" ? "PNG 不能超过 8MB。" : "CSS 不能超过 1MB。");
      return;
    }
    setBusy(true);
    try {
      const content =
        kind === "css"
          ? await file.text()
          : await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = () => reject(new Error("无法读取截图"));
              reader.readAsDataURL(new Blob([file], { type: "image/png" }));
            });
      if (kind === "png")
        await new Promise<void>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve();
          image.onerror = () => reject(new Error("PNG 无法显示"));
          image.src = content;
        });
      if (!content.trim()) throw new Error("文件内容为空。");
      setDraft({ kind, content, title: file.name.slice(0, 160) });
      setStatus(`${file.name} 已就绪。`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!doc || busy) return;
    const label = pageName.trim();
    if (!label || !draft?.content.trim()) {
      setError("请填写页面名称，并提供 PNG 或 CSS。");
      return;
    }
    if (
      draft.kind === "css" &&
      new TextEncoder().encode(draft.content).length > MATERIAL_CSS_LIMIT
    ) {
      setError("CSS 不能超过 1MB。");
      return;
    }
    const matching = groups.filter((g) => g.label === label);
    // Reuse only an unambiguous exact page name. A new name creates its group with the item.
    if (matching.length > 1) {
      setError("已有多个同名页面，请填写更明确的页面名称。");
      return;
    }
    if (groupRequest.current?.label !== label)
      groupRequest.current = { id: `group-${crypto.randomUUID()}`, label };
    const group = matching[0] ?? groupRequest.current;
    const data = {
      group,
      title: draft.title || `${label} · CSS`.slice(0, 160),
      kind: draft.kind,
      content: draft.content,
    };
    const signature = JSON.stringify(data);
    if (request.current?.signature !== signature)
      request.current = { signature, id: `material-${crypto.randomUUID()}` };
    setBusy(true);
    setError("");
    try {
      setDoc(
        await transport.addMaterial(
          slug,
          { id: request.current.id, ...data },
          doc.version,
        ),
      );
      setDraft(undefined);
      request.current = undefined;
      groupRequest.current = undefined;
      setStatus(`资料已保存到本机，归入「${label}」。`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      try {
        setDoc(await transport.loadMaterials(slug));
      } catch {
        /* Keep the draft while offline. */
      }
    } finally {
      setBusy(false);
    }
  };
  const show = async (item: ReviewMaterial) => {
    const sequence = ++previewSequence.current;
    setError("");
    setPreview(undefined);
    try {
      const content = await transport.materialContent(slug, item.id);
      if (sequence === previewSequence.current) setPreview(content);
    } catch (e) {
      if (sequence === previewSequence.current) setError(String(e));
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="review-materials-title"
      wide
      nonModal
    >
      <div
        className="review-materials"
        data-testid="review-materials-panel"
        onPaste={(event) => {
          const file = [...event.clipboardData.items]
            .find((item) => item.type === "image/png")
            ?.getAsFile();
          if (file) {
            event.preventDefault();
            void loadFile(file);
          }
        }}
      >
        <header>
          <div>
            <h2 id="review-materials-title">设计资料</h2>
            <p>给页面起个名字，上传设计文件，后续评审可直接引用。</p>
          </div>
          <IconButton label="关闭设计资料" onClick={onClose}>
            ×
          </IconButton>
        </header>
        {error && (
          <p className="review-materials-error" role="alert">
            {error}{" "}
            <button
              type="button"
              disabled={busy}
              onClick={() => void refresh()}
            >
              刷新资料
            </button>
          </p>
        )}
        <div className="review-materials-columns">
          <section>
            <h3>添加设计</h3>
            <label>
              页面名称
              <input
                disabled={busy}
                aria-label="页面名称"
                value={pageName}
                maxLength={160}
                list="review-material-page-names"
                onChange={(e) => setPageName(e.target.value)}
                placeholder={
                  pages.find((p) => p.id === activePageId)?.label ||
                  "例如：店铺主页"
                }
              />
              <datalist id="review-material-page-names">
                {[...new Set(groups.map((g) => g.label))].map((label) => (
                  <option key={label} value={label} />
                ))}
              </datalist>
            </label>
            <label className="review-materials-upload">
              <strong>选择 PNG 或 CSS 文件</strong>
              <span>也可以直接粘贴 PNG 截图</span>
              <input
                disabled={busy}
                type="file"
                accept="image/png,.png,text/css,.css"
                aria-label="上传 PNG 或 CSS 文件"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void loadFile(file);
                  e.target.value = "";
                }}
              />
            </label>
            <small>PNG 最大 8MB，CSS 最大 1MB。</small>
            {draft && (
              <div className="review-materials-draft">
                <p>
                  {draft.title || "已粘贴 CSS"}{" "}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setDraft(undefined)}
                  >
                    移除
                  </button>
                </p>
                {draft.kind === "png" && (
                  <img src={draft.content} alt="待保存的设计截图" />
                )}
              </div>
            )}
            <details className="review-materials-paste">
              <summary>或粘贴 CSS 内容</summary>
              <label>
                <span className="review-materials-sr-only">CSS 内容</span>
                <textarea
                  disabled={busy}
                  aria-label="CSS 内容"
                  value={draft?.kind === "css" ? draft.content : ""}
                  onChange={(e) =>
                    setDraft({
                      kind: "css",
                      content: e.target.value,
                      title: "",
                    })
                  }
                  spellCheck={false}
                  placeholder="粘贴 Figma 导出的 CSS…"
                />
              </label>
            </details>
            <button
              className="review-materials-save"
              type="button"
              onClick={() => void save()}
              disabled={
                busy || !doc || !pageName.trim() || !draft?.content.trim()
              }
            >
              {busy ? "正在处理…" : "保存资料"}
            </button>
          </section>
          <section className="review-materials-library">
            <h3>已保存资料（{doc?.items.length ?? 0}）</h3>
            {!doc?.items.length && (
              <p className="review-materials-empty">
                还没有设计资料。保存后会按页面名称整理在这里。
              </p>
            )}
            {groups.map((group) => {
              const items = (doc?.items ?? []).filter(
                (item) => item.groupId === group.id,
              );
              if (!items.length) return null;
              return (
                <section
                  className="review-materials-saved-group"
                  key={group.id}
                  data-material-group={group.id}
                >
                  <h4>{group.label}</h4>
                  <ul className="review-materials-list">
                    {items.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          aria-pressed={preview?.item.id === item.id}
                          onClick={() => void show(item)}
                        >
                          {item.title}
                          <small>
                            {item.kind.toUpperCase()} ·{" "}
                            {Math.ceil(item.bytes / 1024)}KB
                          </small>
                        </button>
                        <button
                          type="button"
                          aria-label={`复制资料引用 ${item.title}`}
                          onClick={() =>
                            void navigator.clipboard
                              .writeText(
                                `David 设计资料：${slug} / ${group.label} / ${item.title}（${item.id}）`,
                              )
                              .then(() => setStatus("资料引用已复制。"))
                              .catch(() =>
                                setError("无法复制，请按资料名称引用。"),
                              )
                          }
                        >
                          复制引用
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
            {preview && (
              <article className="review-materials-preview">
                <h4>{preview.item.title}</h4>
                {preview.item.sourceRef && <p>{preview.item.sourceRef}</p>}
                {preview.item.kind === "png" ? (
                  <img src={preview.content} alt={preview.item.title} />
                ) : (
                  <pre>{preview.content}</pre>
                )}
              </article>
            )}
          </section>
        </div>
        <p role="status" className="review-materials-status">
          {status || "资料只保存在本机。关闭面板会保留尚未提交的输入。"}
        </p>
      </div>
    </Modal>
  );
}
