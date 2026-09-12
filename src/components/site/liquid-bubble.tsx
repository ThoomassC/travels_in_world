import type { HTMLAttributes, ReactNode } from "react";
import styles from "./liquid-bubble.module.css";

export type LiquidBubbleProps = HTMLAttributes<HTMLSpanElement> & {
  readonly children?: ReactNode;
};

/** Shared liquid-glass surface used by interactive site controls. */
export function LiquidBubble({ children, className, ...props }: LiquidBubbleProps) {
  return (
    <span className={[styles.bubble, className].filter(Boolean).join(" ")} {...props}>
      {children}
    </span>
  );
}
