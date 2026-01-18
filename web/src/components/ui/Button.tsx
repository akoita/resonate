type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost";
};

export function Button({ children, variant = "primary", ...props }: ButtonProps) {
  const className =
    variant === "primary"
      ? "ui-btn ui-btn-primary"
      : "ui-btn ui-btn-ghost";
  return (
    <button className={className} type="button" {...props}>
      {children}
    </button>
  );
}
