/**
 * 实现已拆入 ./feedback/；本文件保留为薄 re-export，
 * 现有导入路径（../components/GlobalRegionSelection）与导出签名不变。
 */
export { GlobalRegionSelection } from "./feedback/GlobalRegionSelection";
export type {
  GlobalRegionSelectionProps,
  AppearanceSelection,
} from "./feedback/GlobalRegionSelection";
