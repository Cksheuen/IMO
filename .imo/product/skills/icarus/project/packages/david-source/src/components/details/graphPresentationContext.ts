import { createContext } from "react";

/** A single live graph surface inside its owning rich detail. */
export const GraphPresentationContext = createContext<HTMLElement | null>(null);
