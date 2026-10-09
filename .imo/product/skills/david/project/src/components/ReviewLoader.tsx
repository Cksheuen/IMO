import { useRef, useState } from "react";
import { parseReviewSpec } from "../lib/reviewSpec";
import type { ReviewPayload } from "../types/review";

type Props = { onImport: (review: ReviewPayload) => void };

export function ReviewLoader({ onImport }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");

  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      onImport(parseReviewSpec(JSON.parse(await file.text())));
      setMessage(`已载入 ${file.name}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "JSON 导入失败");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="review-loader">
      <label className="import-control">
        导入 review JSON
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          onChange={(event) => void importFile(event.target.files?.[0])}
        />
      </label>
      <span className="loader-status" role="status">
        {message || "支持直接导入 pageHtml + components 数据"}
      </span>
    </div>
  );
}
