"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { deleteMyClientAccount } from "@/actions/client-account";

/**
 * Danger-zone section letting a booking client permanently delete their
 * account from inside the app (Apple App Store requirement). Requires typing
 * DELETE to confirm; cancels billing, removes payment data, and anonymizes the
 * record server-side, then signs out.
 */
export function DeleteAccountSection() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    setLoading(true);
    try {
      const result = await deleteMyClientAccount();
      if (result.success) {
        toast.success("Your account has been deleted.");
        // Session is already cleared server-side; leave the account area.
        router.replace("/");
        router.refresh();
      } else {
        toast.error(result.error);
        setLoading(false);
      }
    } catch {
      toast.error("Failed to delete account. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-destructive/30 p-4">
      <h2 className="text-base font-medium text-destructive">Delete account</h2>
      <p className="mt-1 text-sm text-[var(--ink-soft)]">
        Permanently delete your account. This cancels any active membership,
        removes your saved payment method, and erases your personal details.
        This cannot be undone.
      </p>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); setConfirm(""); }}>
        <DialogTrigger asChild>
          <Button variant="destructive" className="mt-3">
            Delete my account
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              This permanently deletes your account and cancels any active
              membership. Type <span className="font-semibold">DELETE</span> to
              confirm.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="DELETE"
            autoComplete="off"
            aria-label="Type DELETE to confirm"
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={loading || confirm !== "DELETE"}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                "Delete account"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
