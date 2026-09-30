import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

export interface StepDef {
  key: string;
  label: string;
  icon: React.ReactNode;
}

interface SubmissionStepperProps {
  steps: StepDef[];
  currentStep: number;
  onStepClick?: (index: number) => void;
}

export default function SubmissionStepper({ steps, currentStep, onStepClick }: SubmissionStepperProps) {
  return (
    <div className="flex items-center justify-center gap-0 w-full max-w-lg mx-auto mb-8">
      {steps.map((step, i) => {
        const done = i < currentStep;
        const active = i === currentStep;
        const clickable = done && onStepClick;
        return (
          <div key={step.key} className="flex items-center flex-1 last:flex-none">
            {/* Step circle */}
            <div
              className={cn("flex flex-col items-center gap-1.5", clickable && "cursor-pointer group")}
              onClick={() => clickable && onStepClick(i)}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
            >
              <motion.div
                layout
                className={cn(
                  "flex items-center justify-center h-9 w-9 rounded-full border-2 transition-all duration-300",
                  done && "bg-primary border-primary text-primary-foreground",
                  active && "border-primary bg-primary/10 text-primary shadow-[0_0_12px_hsl(var(--primary)/0.3)]",
                  !done && !active && "border-border/50 bg-muted/30 text-muted-foreground",
                  clickable && "group-hover:scale-110 group-hover:shadow-[0_0_16px_hsl(var(--primary)/0.4)]",
                )}
              >
                {done ? (
                  <motion.div
                    initial={{ scale: 0, rotate: -90 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                  >
                    <Check className="h-4 w-4" />
                  </motion.div>
                ) : active ? (
                  <motion.div
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.3 }}
                  >
                    {step.icon}
                  </motion.div>
                ) : (
                  step.icon
                )}
              </motion.div>
              <span
                className={cn(
                  "text-[10px] font-mono tracking-wider whitespace-nowrap transition-colors",
                  active ? "text-primary font-semibold" : done ? "text-primary/70" : "text-muted-foreground",
                  clickable && "group-hover:text-primary",
                )}
              >
                {step.label}
              </span>
            </div>
            {/* Connector line */}
            {i < steps.length - 1 && (
              <div className="flex-1 mx-2 mt-[-18px]">
                <div className="relative h-0.5 rounded-full bg-border/40 overflow-hidden">
                  <motion.div
                    className="absolute inset-y-0 left-0 bg-primary rounded-full"
                    initial={{ width: "0%" }}
                    animate={{ width: i < currentStep ? "100%" : "0%" }}
                    transition={{ duration: 0.4, ease: "easeInOut" }}
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
