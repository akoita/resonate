type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost";
};

export function Button({ children, variant = "primary", className: extraClassName, ...props }: ButtonProps) {
  const baseClassName =
    variant === "primary"
      ? "ui-btn ui-btn-primary"
      : "ui-btn ui-btn-ghost";

  const className = extraClassName
    ? `${baseClassName} ${extraClassName}`
    : baseClassName;

  return (
    <button className={className} type="button" {...props}>
      {children}
    </button>
  );
}
