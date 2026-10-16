import React from "react";
import { registerNativeChannel } from "./native-channel";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { PortalContext } from "./portal";
import "@david/styles/index.css";
declare const ICARUS_CSS: string;
export type StorageChannel = {
  read: () => Promise<{ version: number; value: any }>;
  write: (value: any, version: number) => Promise<any>;
  update: (fn: (value: any) => any) => Promise<any>;
};
export type ModContext = {
  root: HTMLElement;
  signal: AbortSignal;
  onCleanup: (fn: () => unknown) => void;
  getDocument: () => { source: { path: string } };
  storage: StorageChannel;
  documentId: string;
  david?: {
    baseUrl: string;
    request: (
      path: string,
      init?: any,
    ) => Promise<{ body: string; status: number }>;
    present: () => () => void;
  };
  selection?: {
    register: (
      id: string,
      host: HTMLElement,
      adapter: {
        capture: (element: Element) => Record<string, string>;
        restore: (state: Record<string, string>) => Promise<Element | null>;
        matches: (state: Record<string, string>) => boolean;
      },
    ) => () => void;
  };
};
export type ViewProps = { data: any; context: ModContext; host: HTMLElement };
export function reactMod(
  id: string,
  View: React.ComponentType<ViewProps>,
  validate?: (data: any) => any,
  settings: { requires?: string[]; optionalSlots?: boolean } = {},
) {
  return {
    id,
    apiVersion: 1,
    requires: settings.requires ?? ["react-runtime"],
    mount(context: ModContext, options: any = {}) {
      context.onCleanup(registerNativeChannel(context.david));
      const slots = [
        ...context.root.querySelectorAll<HTMLElement>(
          options.selector ?? `[data-icarus-${id}]`,
        ),
      ];
      if (!slots.length && settings.optionalSlots) return;
      if (!slots.length) throw new Error(`Missing [data-icarus-${id}] slot`);
      const input = slots.map((slot) => {
        const config = slot.querySelector<HTMLScriptElement>(
          ':scope > script[type="application/json"][data-icarus-props]',
        );
        const raw =
          options.props ??
          (config ? JSON.parse(config.textContent ?? "{}") : {});
        return { slot, data: validate ? validate(raw) : raw };
      });
      const style = document.createElement("style");
      style.dataset.icarusModStyle = id;
      style.textContent = ICARUS_CSS;
      document.head.append(style);
      context.onCleanup(() => style.remove());
      for (const { slot, data } of input) {
        const host = document.createElement("div");
        host.dataset.icarusDavidRoot = id;
        host.style.minWidth = "0";
        slot.append(host);
        context.onCleanup(() => host.remove());
        let failure: unknown;
        const root = createRoot(host, {
          onUncaughtError: (e) => {
            failure = e;
          },
        });
        context.onCleanup(() => root.unmount());
        flushSync(() =>
          root.render(
            <PortalContext value={host}>
              <View data={data} context={context} host={host} />
            </PortalContext>,
          ),
        );
        if (failure) throw failure;
      }
    },
  };
}
