import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import sampleSpec from "./samples/video-conversion-shooting-guide.review.json";
import { parseReviewSpec } from "./lib/reviewSpec";
import "./styles/index.css";
import "./styles/track-mark.css";

const root = document.getElementById("review-root");
const dataNode = document.getElementById("review-data");
if (!root || !dataNode) throw new Error("david 缺少启动节点");
const embeddedData = JSON.parse(dataNode.textContent || "{}");
const initial =
  import.meta.env.DEV &&
  root.dataset.devSample === "video-conversion-shooting-guide"
    ? parseReviewSpec(sampleSpec)
    : parseReviewSpec(embeddedData);
createRoot(root).render(<App {...initial} />);
