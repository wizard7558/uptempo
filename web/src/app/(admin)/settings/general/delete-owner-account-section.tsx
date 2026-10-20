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
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { deleteMyOwnerAccount } from "@/actions/owner-account";
import { authClient } from "@/lib/auth/client";
import { useT } from "@/lib/terms/client";

/**
 * Danger-zone section letting an owner/staff member permanently delete their
 * account from inside the app (Apple App Store requirement). Deletion is
 * blocked server-side if they are the sole owner of a business.
 */
export function DeleteOwnerAccountSection() {
  const t = useT("settings");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    setLoading(true);
    try {
      const result = await deleteMyOwnerAccount();
      if (result.success) {
        toast.success("Your account has been deleted.");
        // Clear the (now server-side-revoked) session cookie, then leave.
        await authClient.signOut().catch(() => {});
        router.replace("/login");
        router.refresh();
      } else {
        toast.error(result.error);
        setLoading(false);
        setOpen(false);
      }
    } catch {
      toast.error("Failed to delete account. Please try again.");
      setLoading(false);
    }
  }

  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle className="text-destructive">Delete account</CardTitle>
        <CardDescription>
          {t("deleteAccount.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Dialog
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            setConfirm("");
          }}
        >
          <DialogTrigger asChild>
            <Button variant="destructive">Delete my account</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete your account?</DialogTitle>
              <DialogDescription>
                This permanently deletes your account. Type{" "}
                <span className="font-semibold">DELETE</span> to confirm.
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
      </CardContent>
    </Card>
  );
}
