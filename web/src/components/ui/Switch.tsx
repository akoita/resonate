"use client";

type SwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Accessible label for screen readers. */
  label: string;
  id?: string;
  className?: string;
};

/**
 * Accessible on/off toggle. Renders a real button with role="switch" so it is
 * keyboard- and screen-reader-friendly. Styling lives in `.ui-switch*` classes.
 */
export function Switch({ checked, onChange, disabled = false, label, id, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`ui-switch${checked ? " is-on" : ""}${className ? ` ${className}` : ""}`}
    >
      <span className="ui-switch-track" aria-hidden="true">
        <span className="ui-switch-thumb" />
      </span>
    </button>
  );
}
