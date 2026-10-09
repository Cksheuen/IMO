import { showToast } from "../lib/toast";

/**
 * 紧凑引用：文件路径 / 长标识省略显示，hover（title）或 keyboard focus
 * 可读完整文本，点击 / Enter / Space 复制完整值并给出反馈。
 * 仅用于引用类短标识；正文段落不得使用（引用可省略、原文可达，
 * 正文不得靠裁切隐藏）。
 *
 * 复制语义：只有剪贴板写入成功才提示“已复制”；失败时保留完整引用
 * （可读、可选择）并通过共享 toast 给出可理解提示，绝不谎报成功。
 */
export function CompactRef({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const copy = async () => {
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
        throw new Error("clipboard unavailable");
      }
      await navigator.clipboard.writeText(value);
      showToast("success", "已复制完整值");
    } catch {
      showToast("error", "复制失败，请手动选择复制");
    }
  };

  return (
    <code
      className={`compact-ref${className ? ` ${className}` : ""}`}
      title={value}
      tabIndex={0}
      role="button"
      aria-label={`复制完整引用：${value}`}
      onClick={(event) => {
        event.stopPropagation();
        void copy();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          void copy();
        }
      }}
    >
      {value}
    </code>
  );
}
