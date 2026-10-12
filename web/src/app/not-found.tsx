import Link from "next/link";

/** App Router global not-found UI (wrapped by root layout). */
export default function NotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground text-center text-sm">
        That URL does not exist or was moved.
      </p>
      <Link
        href="/"
        className="text-primary text-sm font-medium underline underline-offset-4"
      >
        Go home
      </Link>
    </div>
  );
}
