"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT, useTerms } from "@/lib/terms/client";
import type { TeamRole } from "@/lib/auth/permissions";
import { sendInvitation, revokeInvitation, resendInvitation } from "@/actions/team";
import { toast } from "sonner";
import { Plus, Mail, XCircle, RefreshCw, User } from "lucide-react";

interface Invitation {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
}

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: Date;
}

interface TeamPageClientProps {
  initialInvitations: Invitation[];
  initialMembers: TeamMember[];
}

const STATUS_VARIANTS: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  pending: "default",
  accepted: "secondary",
  expired: "outline",
  revoked: "destructive",
};

const ROLE_VARIANTS: Record<
  string,
  "default" | "secondary" | "outline"
> = {
  owner: "default",
  admin: "secondary",
  provider: "outline",
  stylist: "outline",
  assistant: "outline",
};

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function TeamPageClient({
  initialInvitations,
  initialMembers,
}: TeamPageClientProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>(
    "provider",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const t = useT("team");
  const ts = useT("settings");
  const terms = useTerms();

  function roleLabel(value: string): string {
    if (value === "provider" || value === "stylist") return terms.staff.one;
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const result = await sendInvitation({ email, role });
      if (result.success) {
        toast.success(`Invitation sent to ${email}`);
        setEmail("");
        setRole("provider");
        setDialogOpen(false);
        startTransition(() => {
          router.refresh();
        });
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("Failed to send invitation");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResend(invitationId: string, inviteeEmail: string) {
    const result = await resendInvitation(invitationId);
    if (result.success) {
      toast.success(`New invitation sent to ${inviteeEmail}`);
      startTransition(() => {
        router.refresh();
      });
    } else {
      toast.error(result.error);
    }
  }

  async function handleRevoke(invitationId: string, inviteeEmail: string) {
    if (!confirm(`Revoke the invitation sent to ${inviteeEmail}?`)) return;

    const result = await revokeInvitation(invitationId);
    if (result.success) {
      toast.success("Invitation revoked");
      startTransition(() => {
        router.refresh();
      });
    } else {
      toast.error(result.error);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="w-full sm:w-auto">
              <Plus className="size-4" />
              Invite Team Member
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite Team Member</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleInvite} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="invite-email">Email address</Label>
                <Input
                  id="invite-email"
                  type="email"
                  placeholder={ts("team.invitePlaceholder")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="invite-role">Role</Label>
                <Select
                  value={role}
                  onValueChange={(v) =>
                    setRole(v as TeamRole)
                  }
                >
                  <SelectTrigger id="invite-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="provider">
                      {t("roles.provider")}
                    </SelectItem>
                    <SelectItem value="assistant">
                      Assistant — Schedule tasks
                    </SelectItem>
                    <SelectItem value="admin">
                      Admin — Full access except billing
                    </SelectItem>
                    <SelectItem value="owner">
                      Owner — Full access including billing
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? "Sending..." : "Send Invitation"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members">
            Members ({initialMembers.length})
          </TabsTrigger>
          <TabsTrigger value="invitations">
            Invitations ({initialInvitations.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="mt-4">
          {initialMembers.length === 0 ? (
            <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center">
              <User className="mx-auto mb-3 size-10 opacity-40" />
              <p>No team members yet.</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {initialMembers.map((member) => (
                <Card key={member.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-3">
                      <div className="bg-muted flex size-10 items-center justify-center rounded-full">
                        <User className="text-muted-foreground size-5" />
                      </div>
                      <div>
                        <CardTitle className="text-base">
                          {member.name}
                        </CardTitle>
                        <p className="text-muted-foreground text-xs">
                          {member.email}
                        </p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between">
                      <Badge
                        variant={ROLE_VARIANTS[member.role] ?? "outline"}
                        className="capitalize"
                      >
                        {roleLabel(member.role)}
                      </Badge>
                      <span className="text-muted-foreground text-xs">
                        Joined {formatDate(member.createdAt)}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="invitations" className="mt-4">
          {initialInvitations.length === 0 ? (
            <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center">
              <Mail className="mx-auto mb-3 size-10 opacity-40" />
              <p>
                No pending invitations. Invite your first team member to get
                started.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {initialInvitations.map((inv) => (
                <Card key={inv.id}>
                  <CardHeader className="flex flex-row items-start justify-between pb-2">
                    <div className="flex items-center gap-3">
                      <div className="bg-muted flex size-10 items-center justify-center rounded-full">
                        <Mail className="text-muted-foreground size-5" />
                      </div>
                      <div>
                        <CardTitle className="text-base">
                          {inv.email}
                        </CardTitle>
                        <p className="text-muted-foreground text-xs capitalize">
                          {roleLabel(inv.role)}
                        </p>
                      </div>
                    </div>
                    {inv.status === "pending" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRevoke(inv.id, inv.email)}
                        title="Revoke invitation"
                      >
                        <XCircle className="text-destructive" />
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={STATUS_VARIANTS[inv.status] ?? "outline"}
                        >
                          {inv.status}
                        </Badge>
                        {inv.status === "expired" && (
                          <Button
                            variant="ghost"
                            
                            className="h-6 px-2 text-xs"
                            onClick={() => handleResend(inv.id, inv.email)}
                          >
                            <RefreshCw className="mr-1 size-3" />
                            Resend
                          </Button>
                        )}
                      </div>
                      <span className="text-muted-foreground text-xs">
                        Sent {formatDate(inv.createdAt)}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
