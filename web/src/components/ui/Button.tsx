type ButtonProps = {
  children: React.ReactNode;
  variant?: "primary" | "ghost";
};

export function Button({ children, variant = "primary" }: ButtonProps) {
  const className =
    variant === "primary"
      ? "ui-btn ui-btn-primary"
      : "ui-btn ui-btn-ghost";
  return <button className={className}>{children}</button>;
}
