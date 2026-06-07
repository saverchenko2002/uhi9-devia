import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "live" | "hooked" | "plain" | "keeper" | "lp" | "swap";
}) {
  const tones = {
    neutral: "border-zinc-700/80 bg-zinc-800/60 text-zinc-300",
    live: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    hooked: "border-cyan-500/30 bg-cyan-500/10 text-cyan-200",
    plain: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    keeper: "border-violet-500/30 bg-violet-500/10 text-violet-200",
    lp: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    swap: "border-sky-500/30 bg-sky-500/10 text-sky-200",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-wide ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" }) {
  const variants = {
    primary:
      "bg-gradient-to-b from-cyan-400 to-cyan-600 text-zinc-950 shadow-lg shadow-cyan-950/40 hover:from-cyan-300 hover:to-cyan-500",
    secondary:
      "border border-zinc-700/80 bg-zinc-900/80 text-zinc-100 hover:border-zinc-600 hover:bg-zinc-800/80",
    ghost: "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100",
  };
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

export function Card({
  title,
  subtitle,
  badge,
  accent,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  accent?: "hooked" | "plain" | "keeper" | "swap" | "lp";
  children: ReactNode;
  className?: string;
}) {
  const accents = {
    hooked: "from-cyan-500/20",
    plain: "from-amber-500/20",
    keeper: "from-violet-500/20",
    swap: "from-sky-500/20",
    lp: "from-emerald-500/20",
  };
  const accentClass = accent ? accents[accent] : "from-zinc-500/10";

  return (
    <section
      className={`group relative overflow-hidden rounded-2xl border border-zinc-800/90 bg-zinc-900/50 shadow-xl shadow-black/20 backdrop-blur-sm ${className}`}
    >
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r ${accentClass} via-white/10 to-transparent`} />
      <div className="border-b border-zinc-800/80 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold tracking-tight text-zinc-50">{title}</h3>
            {subtitle && <p className="mt-1 text-sm leading-relaxed text-zinc-500">{subtitle}</p>}
          </div>
          {badge}
        </div>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800/70 bg-zinc-950/50 px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">{label}</div>
      <div className="mt-1 font-mono text-lg font-medium text-zinc-100">{value}</div>
      {hint && <div className="mt-1 text-xs text-zinc-600">{hint}</div>}
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

export function Input({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-lg border border-zinc-700/80 bg-zinc-950 px-3 py-2.5 font-mono text-sm text-zinc-100 outline-none ring-cyan-500/30 transition placeholder:text-zinc-600 focus:border-cyan-500/50 focus:ring-2 disabled:opacity-40 ${className}`}
      {...props}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className="w-full rounded-lg border border-zinc-700/80 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none ring-cyan-500/30 transition focus:border-cyan-500/50 focus:ring-2 disabled:opacity-40"
      {...props}
    />
  );
}

export function PlaceholderAction({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/30 px-4 py-6 text-center">
      <p className="text-sm text-zinc-500">{label}</p>
      <p className="mt-1 text-xs text-zinc-600">Controls wire up in the next iteration</p>
    </div>
  );
}
