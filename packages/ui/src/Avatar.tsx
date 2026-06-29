import { cn } from "./cn";

/** Avatar s iniciálami (navy default; volitelná barva). */
export function Avatar({
  initials,
  color,
  className,
}: {
  initials: string;
  color?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid h-6 w-6 place-items-center rounded-full font-display text-[10px] font-semibold text-white ring-2 ring-card",
        className,
      )}
      style={{ background: color ?? "var(--w-avatar)" }}
      title={initials}
    >
      {initials}
    </span>
  );
}

/** Skupina avatarů s překryvem a „+N" přetečením. */
export function AvatarGroup({ people, max = 4 }: { people: string[]; max?: number }) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className="flex items-center">
      {shown.map((p, i) => (
        <span key={`${p}-${i}`} className={i > 0 ? "-ml-1.5" : ""}>
          <Avatar initials={p} />
        </span>
      ))}
      {rest > 0 && (
        <span className="-ml-1.5 grid h-6 w-6 place-items-center rounded-full bg-panel-2 font-mono text-[10px] text-ink-2 ring-2 ring-card">
          +{rest}
        </span>
      )}
    </span>
  );
}
