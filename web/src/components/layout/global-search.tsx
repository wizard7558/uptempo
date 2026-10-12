"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Calendar,
  Users,
  Scissors,
  BarChart3,
  TrendingUp,
  Settings,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { searchClients } from "@/actions/clients";
import type { ClientSearchResult } from "@/lib/clients/search-result";

export interface GlobalSearchNavItem {
  label: string;
  href: string;
}

interface GlobalSearchProps {
  /** When false, the "Clients" group is hidden and no lookups are issued. */
  canSearchClients: boolean;
  /** Quick-nav destinations already filtered to the current user's role. */
  quickNav: GlobalSearchNavItem[];
}

/** Icon per quick-nav destination; falls back to a generic arrow. */
const NAV_ICONS: Record<string, LucideIcon> = {
  "/schedule": Calendar,
  "/clients": Users,
  "/services": Scissors,
  "/analytics": TrendingUp,
  "/analytics/revenue": BarChart3,
  "/analytics/services": TrendingUp,
  "/settings": Settings,
};

export function GlobalSearch({ canSearchClients, quickNav }: GlobalSearchProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClientSearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  // Cmd+K / Ctrl+K toggles the palette from anywhere in the admin app.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Debounced, tenant-scoped client lookup (server-filtered; cmdk filtering off).
  useEffect(() => {
    if (!open || !canSearchClients) return;
    const q = query.trim();
    if (q.length === 0) {
      setResults([]);
      setLoading(false);
      return;
    }
    let ignore = false;
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const found = await searchClients(q);
        if (!ignore) setResults(found);
      } catch {
        if (!ignore) setResults([]);
      } finally {
        if (!ignore) setLoading(false);
      }
    }, 250);
    return () => {
      ignore = true;
      clearTimeout(handle);
    };
  }, [query, open, canSearchClients]);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) {
      setQuery("");
      setResults([]);
      setLoading(false);
    }
  }, []);

  const go = useCallback(
    (href: string) => {
      handleOpenChange(false);
      router.push(href);
    },
    [handleOpenChange, router],
  );

  const trimmed = query.trim().toLowerCase();
  const navMatches =
    trimmed.length === 0
      ? quickNav
      : quickNav.filter((item) => item.label.toLowerCase().includes(trimmed));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search"
        className="group inline-flex min-h-11 items-center gap-2 rounded-full border border-input bg-card px-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <Search className="size-4 shrink-0" />
        <span className="text-sm">Search</span>
        <kbd className="hidden items-center gap-0.5 rounded border border-border bg-background px-1.5 font-sans text-sm font-medium text-muted-foreground sm:inline-flex">
          <span className="text-sm">⌘</span>K
        </kbd>
      </button>

      <CommandDialog
        open={open}
        onOpenChange={handleOpenChange}
        title="Search"
        description="Search clients and jump to a page."
        commandProps={{ shouldFilter: false }}
      >
        <CommandInput
          placeholder="Search clients, appointments..."
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>{loading ? "Searching..." : "No results."}</CommandEmpty>

          {canSearchClients && results.length > 0 && (
            <CommandGroup heading="Clients">
              {results.map((client) => (
                <CommandItem
                  key={client.id}
                  value={`client-${client.id}`}
                  onSelect={() => go(`/clients/${client.id}`)}
                >
                  <Users className="text-muted-foreground" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{client.name}</span>
                    {client.subtitle && (
                      <span className="truncate text-xs text-muted-foreground">
                        {client.subtitle}
                      </span>
                    )}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {navMatches.length > 0 && (
            <CommandGroup heading="Go to">
              {navMatches.map((item) => {
                const Icon = NAV_ICONS[item.href] ?? ArrowRight;
                return (
                  <CommandItem
                    key={item.href}
                    value={`nav-${item.href}`}
                    onSelect={() => go(item.href)}
                  >
                    <Icon className="text-muted-foreground" />
                    <span>{item.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
