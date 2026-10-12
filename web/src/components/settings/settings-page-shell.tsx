import type { ReactNode } from "react";

interface SettingsPageShellProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export function SettingsPageShell({
  title,
  description,
  children,
}: SettingsPageShellProps) {
  return (
    <div className="space-y-6 px-4 py-6 sm:px-6">
      <div className="space-y-1">
        <h1 className="text-xl font-bold sm:text-2xl">{title}</h1>
        {description ? (
          <p className="text-sm text-muted-foreground sm:text-base">{description}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}
