"use client";

import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

const OPTIONS = ["light", "dark", "system"] as const;

export function ThemeToggle() {
  const t = useTranslations("theme");
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const selected = mounted ? theme : "system";

  return (
    <fieldset className="min-w-0 space-y-1">
      <legend className="px-1 text-xs text-muted-foreground">{t("label")}</legend>
      <div className="flex flex-col" role="radiogroup" aria-label={t("label")}>
        {OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected === option}
            className="min-h-11 min-w-11 rounded-md px-3 text-left text-sm aria-checked:bg-accent aria-checked:text-accent-foreground"
            onClick={() => setTheme(option)}
          >
            {t(option)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
