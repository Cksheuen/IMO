import React, { createContext, useContext } from "react";
import { createPortal as portal } from "react-dom";
export const PortalContext = createContext<HTMLElement | null>(null);
function LocalPortal({
  children,
  target,
}: {
  children: React.ReactNode;
  target?: Element | DocumentFragment;
}) {
  const owner = useContext(PortalContext);
  // Body overlays belong to this mod; nested graph portals retain their explicit host.
  return portal(
    children,
    target && target !== document.body ? target : (owner ?? document.body),
  );
}
export function createPortal(
  children: React.ReactNode,
  target?: Element | DocumentFragment,
) {
  return <LocalPortal target={target}>{children}</LocalPortal>;
}
