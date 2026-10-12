"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/actions/clients";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, UserPlus } from "lucide-react";

export function ClientCreateDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "" });

  function reset() {
    setForm({ name: "", email: "", phone: "" });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    const name = form.name.trim();
    const email = form.email.trim();
    const phone = form.phone.trim();

    if (!name) {
      toast.error("Name is required");
      return;
    }
    if (!email && !phone) {
      toast.error("Add at least an email or phone number");
      return;
    }

    setSubmitting(true);
    const result = await createClient({
      name,
      email: email || null,
      phone: phone || null,
    });
    setSubmitting(false);

    if (!result.success) {
      const message =
        result.error && "message" in result.error
          ? (result.error as { message?: string }).message
          : undefined;
      const existingId =
        "existingClientId" in result ? result.existingClientId : undefined;
      toast.error(message ?? "Could not create client", {
        action: existingId
          ? {
              label: "Open client",
              onClick: () => {
                setOpen(false);
                reset();
                router.push(`/clients/${existingId}`);
              },
            }
          : undefined,
      });
      return;
    }

    toast.success("Client added");
    setOpen(false);
    reset();
    router.push(`/clients/${result.id}`);
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!submitting) {
          setOpen(next);
          if (!next) reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button className="w-full sm:w-auto">
          <UserPlus className="mr-2 h-4 w-4" />
          Add Client
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Add a new client</DialogTitle>
            <DialogDescription>
              Provide a name and at least one way to reach them. You can add a
              card on file from their profile after they&apos;re saved.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="client-create-name">Name</Label>
            <Input
              id="client-create-name"
              value={form.name}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, name: e.target.value }))
              }
              autoFocus
              required
              autoComplete="name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="client-create-email">Email</Label>
            <Input
              id="client-create-email"
              type="email"
              value={form.email}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, email: e.target.value }))
              }
              autoComplete="email"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="client-create-phone">Phone</Label>
            <Input
              id="client-create-phone"
              type="tel"
              value={form.phone}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, phone: e.target.value }))
              }
              autoComplete="tel"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Add client"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
