type Props = {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Needed when no <label htmlFor={id}> names the switch. */
  label?: string;
  disabled?: boolean;
};

/** An on/off toggle. A <label htmlFor={id}> elsewhere can name and click it. */
export default function Switch({ id, checked, onChange, label, disabled = false }: Props) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        checked ? "bg-brand-600" : "bg-slate-300"
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-5 w-5 rounded-full bg-white shadow-card transition-transform duration-200 ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}
