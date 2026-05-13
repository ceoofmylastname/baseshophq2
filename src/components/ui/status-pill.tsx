import { cn } from "@/lib/utils";
import type { PolicyStatus } from "@/lib/policy-bucket";
import { statusStyle } from "@/lib/status-style";

type Props = {
  status: PolicyStatus;
  /** Optional trailing content (e.g. a chevron when used inside a dropdown trigger). */
  trailing?: React.ReactNode;
  className?: string;
};

/**
 * Brand-locked status pill. One component, used everywhere a PolicyStatus
 * renders, so the color treatment is consistent across Book of Business,
 * Production, Policy Detail, Activity Feed, and filter dropdowns.
 */
export function StatusPill({ status, trailing, className }: Props) {
  const s = statusStyle(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        s.pillClasses,
        className,
      )}
    >
      {status}
      {trailing}
    </span>
  );
}
