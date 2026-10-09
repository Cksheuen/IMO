import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";
import "./ui.css";

/** Measure a hidden mirror so resizing never resets the focused editor's height or caret. */
export function AutoGrowingTextarea(
  props: TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const editor = ref.current;
    if (!editor) return;
    let lastWidth = 0;
    const measure = () => {
      if (!editor.getBoundingClientRect().width) return;
      const style = getComputedStyle(editor);
      const mirror = document.createElement("textarea");
      mirror.setAttribute("aria-hidden", "true");
      mirror.tabIndex = -1;
      for (const name of [
        "font",
        "line-height",
        "letter-spacing",
        "padding",
        "border",
        "box-sizing",
        "width",
        "word-spacing",
        "white-space",
        "overflow-wrap",
      ])
        mirror.style.setProperty(name, style.getPropertyValue(name));
      Object.assign(mirror.style, {
        position: "fixed",
        left: "-10000px",
        visibility: "hidden",
        height: "0",
        minHeight: "0",
        maxHeight: "none",
        overflow: "hidden",
      });
      mirror.value = editor.value;
      document.body.append(mirror);
      const border =
        parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      const line =
        parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4;
      // Fill the remaining panel space while keeping submit/status controls visible.
      const dialog = editor.closest('[role="dialog"]');
      let reserve = 16;
      let child: Element = editor;
      for (
        let parent = child.parentElement;
        parent && child !== dialog;
        parent = child.parentElement
      ) {
        const parentStyle = getComputedStyle(parent);
        const following = [...parent.children].slice(
          [...parent.children].indexOf(child) + 1,
        );
        reserve += parseFloat(parentStyle.paddingBottom) || 0;
        for (const sibling of following) {
          const siblingStyle = getComputedStyle(sibling);
          if (siblingStyle.display === "none") continue;
          reserve +=
            sibling.getBoundingClientRect().height +
            (parseFloat(siblingStyle.marginTop) || 0) +
            (parseFloat(siblingStyle.marginBottom) || 0) +
            (parseFloat(parentStyle.rowGap) || 0);
        }
        child = parent;
        if (!dialog && parent === document.body) break;
      }
      const minimum = parseFloat(style.minHeight) || 72;
      const bottom = Math.min(
        window.innerHeight,
        dialog?.getBoundingClientRect().bottom ?? window.innerHeight,
      );
      const available = Math.max(
        minimum,
        bottom - editor.getBoundingClientRect().top - reserve,
      );
      const height = Math.min(
        available,
        Math.max(minimum, mirror.scrollHeight + border + line),
      );
      mirror.remove();
      editor.style.height = `${Math.ceil(height)}px`;
    };
    measure();
    const observer = new ResizeObserver((entries) => {
      if (
        entries.some(
          (entry) =>
            entry.target !== editor || entry.contentRect.width !== lastWidth,
        )
      ) {
        lastWidth = editor.getBoundingClientRect().width;
        measure();
      }
    });
    observer.observe(editor);
    if (editor.parentElement) observer.observe(editor.parentElement);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [props.value]);
  return (
    <textarea
      {...props}
      ref={ref}
      className={`dv-ui-auto-textarea ${props.className ?? ""}`}
    />
  );
}
