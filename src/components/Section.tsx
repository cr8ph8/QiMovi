import { motion } from "framer-motion";
import { ReactNode, forwardRef } from "react";

interface SectionProps {
  children: ReactNode;
  className?: string;
  id?: string;
}

export function Section({ children, className = "", id }: SectionProps) {
  return (
    <motion.section
      id={id}
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className={`py-20 md:py-28 ${className}`}
    >
      <div className="container">{children}</div>
    </motion.section>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block text-xs font-mono font-medium tracking-[0.2em] uppercase text-primary mb-4">
      {children}
    </span>
  );
}

export const SectionTitle = forwardRef<HTMLHeadingElement, { children: ReactNode; className?: string }>(
  ({ children, className = "" }, ref) => (
    <h2 ref={ref} className={`font-display text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight mb-4 ${className}`}>
      {children}
    </h2>
  )
);
SectionTitle.displayName = "SectionTitle";

export function SectionDescription({ children }: { children: ReactNode }) {
  return (
    <p className="text-muted-foreground text-lg md:text-xl max-w-2xl leading-relaxed">
      {children}
    </p>
  );
}
