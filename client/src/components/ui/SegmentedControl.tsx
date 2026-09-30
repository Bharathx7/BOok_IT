import { useRef } from "react";
import type { KeyboardEvent } from "react";
import type { LucideIcon } from "lucide-react";

// Adapted from 21st.dev "Segmented Control" (ddoemonn): a radio group with a
// sliding thumb and arrow-key navigation. The spring animation is a CSS
// transition here, so it needs no animation library and follows the global
// reduced-motion rule.

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  icon?: LucideIcon;
};

type Props<T extends string> = {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the group. */
  label: string;
  className?: string;
};

export default function SegmentedControl<T extends string>({ options, value, onChange, label, className = "" }: Props<T>) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const count = Math.max(1, options.length);
  const found = options.findIndex((option) => option.value === value);
  const index = found < 0 ? 0 : found;

  function go(next: number) {
    const i = (next + count) % count;
    buttons.current[i]?.focus();
    onChange(options[i]!.value);
  }

  function onKeyDown(event: KeyboardEvent, i: number) {
    const moves: Record<string, number> = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: count - 1 };
    if (event.key in moves) {
      event.preventDefault();
      go(moves[event.key]!);
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`relative inline-grid rounded-lg border border-slate-200 bg-slate-100 p-1 shadow-[inset_0_1px_2px_rgb(15_23_42/0.06)] ${className}`}
      style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-1 left-1 rounded-md bg-white shadow-card ring-1 ring-slate-200/70 transition-transform duration-300 ease-[cubic-bezier(0.34,1.4,0.64,1)]"
        style={{ width: `calc((100% - 0.5rem) / ${count})`, transform: `translateX(${index * 100}%)` }}
      />
      {options.map((option, i) => {
        const selected = i === index;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            ref={(node) => {
              buttons.current[i] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, i)}
            className={`relative z-10 inline-flex min-h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors ${
              selected ? "text-brand-700" : "text-slate-500 hover:text-slate-800"
            }`}
          >
            {Icon ? <Icon aria-hidden="true" className="h-4 w-4" /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
