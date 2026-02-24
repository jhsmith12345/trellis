import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost";
  size?: "sm" | "md" | "lg";
  children: ReactNode;
}

const base =
  "inline-flex items-center justify-center font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none";

const variants: Record<string, string> = {
  primary: "bg-teal-600 text-white hover:bg-teal-700 active:bg-teal-800",
  secondary: "bg-sage-600 text-white hover:bg-sage-700 active:bg-sage-800",
  outline:
    "border-2 border-teal-600 text-teal-700 hover:bg-teal-50 active:bg-teal-100",
  ghost: "text-warm-600 hover:bg-warm-100 active:bg-warm-200",
};

const sizes: Record<string, string> = {
  sm: "text-sm px-3 py-1.5",
  md: "text-base px-5 py-2.5",
  lg: "text-lg px-7 py-3.5",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
