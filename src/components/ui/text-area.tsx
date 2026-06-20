import { cn } from "@/lib/utils";

// Plain multiline text field for the app's free-text inputs. onChange passes the
// string value (not the event), with value / placeholder / rows / maxLength /
// ariaLabel / fill props. 16px font-size so iOS doesn't zoom on focus; ink-soft
// placeholder stays readable on cream.
interface Props {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  fill?: boolean;
  maxLength?: number;
  ariaLabel?: string;
  className?: string;
}

export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 4,
  disabled,
  fill,
  maxLength,
  ariaLabel,
  className,
}: Props) {
  return (
    <div className={cn(fill && "flex h-full flex-col", className)}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        maxLength={maxLength}
        aria-label={ariaLabel}
        className={cn(
          "w-full resize-none rounded-card-sm border border-divider bg-surface px-3 py-2.5 text-[16px] leading-[1.45] text-ink placeholder:text-ink-soft focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50",
          fill && "h-full flex-1",
        )}
      />
      {maxLength != null && (
        <div className="mt-1 text-right font-mono text-[9px] uppercase tracking-[0.1em] text-ink-faint">
          {value.length}/{maxLength}
        </div>
      )}
    </div>
  );
}
