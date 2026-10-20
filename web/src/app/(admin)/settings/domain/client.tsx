"use client";

import { useState, useTransition } from "react";
import {
  addCustomDomain,
  removeCustomDomain,
  verifyCustomDomain,
} from "@/actions/domains";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Globe,
  Copy,
  Trash2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from "lucide-react";

interface DomainRecord {
  id: string;
  domain: string;
  type: string;
  verificationStatus: string;
  sslStatus: string;
  stripeRegistered: string;
  isPrimary: number;
  createdAt: Date;
  updatedAt: Date;
}

interface DnsRecord {
  type: string;
  name: string;
  value: string;
}

interface DomainSettings {
  bookingUrl: string;
  customDomains: DomainRecord[];
}

export function DomainSettingsClient({
  initialSettings,
}: {
  initialSettings: DomainSettings;
}) {
  const [customDomains, setCustomDomains] = useState<DomainRecord[]>(
    initialSettings.customDomains,
  );
  const [newDomain, setNewDomain] = useState("");
  const [isAdding, startAddTransition] = useTransition();
  const [verifyingDomain, setVerifyingDomain] = useState<string | null>(null);
  const [removingDomain, setRemovingDomain] = useState<string | null>(null);
  const [dnsRecords, setDnsRecords] = useState<Record<string, DnsRecord[]>>(
    {},
  );
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [domainToRemove, setDomainToRemove] = useState<string | null>(null);

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  }

  function handleAddDomain() {
    if (!newDomain.trim()) return;

    startAddTransition(async () => {
      const result = await addCustomDomain(newDomain.trim());
      if ("error" in result) {
        toast.error(result.error);
        return;
      }

      toast.success("Domain added successfully");
      setNewDomain("");

      // Add to local state with pending status
      const newRecord: DomainRecord = {
        id: crypto.randomUUID(),
        domain: newDomain.trim().toLowerCase(),
        type: "custom",
        verificationStatus: "pending",
        sslStatus: "pending",
        stripeRegistered: "active",
        isPrimary: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      setCustomDomains((prev) => [...prev, newRecord]);
    });
  }

  async function handleVerifyDomain(domain: string) {
    setVerifyingDomain(domain);
    try {
      const result = await verifyCustomDomain(domain);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }

      // Store DNS records for display
      setDnsRecords((prev) => ({ ...prev, [domain]: result.dnsRecords }));

      // Update local state with verification result
      setCustomDomains((prev) =>
        prev.map((d) =>
          d.domain === domain
            ? {
                ...d,
                verificationStatus: result.verified ? "verified" : "pending",
                sslStatus: result.sslStatus,
                updatedAt: new Date(),
              }
            : d,
        ),
      );

      if (result.verified) {
        toast.success("Domain verified and SSL active");
      } else {
        toast.info("DNS not yet propagated. Check your DNS records below.");
      }
    } finally {
      setVerifyingDomain(null);
    }
  }

  async function handleRemoveDomain() {
    if (!domainToRemove) return;
    setRemovingDomain(domainToRemove);
    try {
      const result = await removeCustomDomain(domainToRemove);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }

      toast.success("Domain removed");
      setCustomDomains((prev) =>
        prev.filter((d) => d.domain !== domainToRemove),
      );
      setDnsRecords((prev) => {
        const next = { ...prev };
        delete next[domainToRemove];
        return next;
      });
    } finally {
      setRemovingDomain(null);
      setRemoveDialogOpen(false);
      setDomainToRemove(null);
    }
  }

  function statusBadge(status: string, type: "verification" | "ssl") {
    const labels: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
      pending: { label: "Pending", variant: "outline" },
      verified: { label: "Verified", variant: "default" },
      active: { label: "Active", variant: "default" },
      failed: { label: "Failed", variant: "destructive" },
      error: { label: "Error", variant: "destructive" },
    };

    const config = labels[status] ?? { label: status, variant: "outline" as const };

    return (
      <Badge variant={config.variant} className="text-xs">
        {type === "verification" && status === "verified" && (
          <CheckCircle2 className="mr-1 size-3" />
        )}
        {(status === "failed" || status === "error") && (
          <AlertCircle className="mr-1 size-3" />
        )}
        {config.label}
      </Badge>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Subdomain URL (read-only) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="size-5" />
            Your Booking URL
          </CardTitle>
          <CardDescription>
            Your booking page is always available at this URL.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <div className="flex-1 rounded-md border bg-muted px-3 py-2 font-mono text-sm">
              {initialSettings.bookingUrl}
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() =>
                copyToClipboard(`https://${initialSettings.bookingUrl}`)
              }
              title="Copy URL"
            >
              <Copy className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              asChild
            >
              <a
                href={`https://${initialSettings.bookingUrl}`}
                target="_blank"
                rel="noopener noreferrer"
                title="Open booking page"
              >
                <ExternalLink className="size-4" />
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Add Custom Domain */}
      <Card>
        <CardHeader>
          <CardTitle>Custom Domain</CardTitle>
          <CardDescription>
            Connect your own domain for a professional booking URL (e.g.,
            book.example.com).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="custom-domain">Domain Name</Label>
            <div className="flex gap-2">
              <Input
                id="custom-domain"
                placeholder="book.example.com"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddDomain();
                }}
                disabled={isAdding}
              />
              <Button onClick={handleAddDomain} disabled={isAdding || !newDomain.trim()}>
                {isAdding ? "Adding..." : "Add Domain"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Enter a domain you own. You will need to configure DNS records after adding.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Domain List */}
      {customDomains.map((domain) => (
        <Card key={domain.id}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <CardTitle className="font-mono text-base">
                  {domain.domain}
                </CardTitle>
                <div className="flex items-center gap-2">
                  {statusBadge(domain.verificationStatus, "verification")}
                  {domain.verificationStatus === "verified" &&
                    statusBadge(domain.sslStatus, "ssl")}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  
                  onClick={() => handleVerifyDomain(domain.domain)}
                  disabled={
                    verifyingDomain === domain.domain ||
                    domain.verificationStatus === "verified"
                  }
                >
                  <RefreshCw
                    className={`mr-1 size-3 ${verifyingDomain === domain.domain ? "animate-spin" : ""}`}
                  />
                  {domain.verificationStatus === "verified"
                    ? "Verified"
                    : "Verify DNS"}
                </Button>
                <Dialog
                  open={removeDialogOpen && domainToRemove === domain.domain}
                  onOpenChange={(open) => {
                    setRemoveDialogOpen(open);
                    if (!open) setDomainToRemove(null);
                  }}
                >
                  <DialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="text-destructive hover:bg-destructive/10"
                      onClick={() => setDomainToRemove(domain.domain)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Remove Domain</DialogTitle>
                      <DialogDescription>
                        Are you sure you want to remove{" "}
                        <span className="font-mono font-semibold">
                          {domain.domain}
                        </span>
                        ? This will remove the domain from Vercel and disable
                        Apple Pay/Google Pay for this domain.
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setRemoveDialogOpen(false);
                          setDomainToRemove(null);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={handleRemoveDomain}
                        disabled={removingDomain === domain.domain}
                      >
                        {removingDomain === domain.domain
                          ? "Removing..."
                          : "Remove Domain"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          </CardHeader>

          {/* DNS Instructions (show when pending or when records are available) */}
          {(domain.verificationStatus === "pending" ||
            dnsRecords[domain.domain]) && (
            <CardContent>
              <div className="rounded-lg border bg-muted/50 p-4 space-y-3">
                <h4 className="text-sm font-semibold">DNS Configuration</h4>
                <p className="text-xs text-muted-foreground">
                  Add the following DNS record at your domain registrar, then
                  click &quot;Verify DNS&quot; above.
                </p>

                {dnsRecords[domain.domain] ? (
                  <div className="space-y-2">
                    {dnsRecords[domain.domain].map((record, idx) => (
                      <div
                        key={idx}
                        className="grid grid-cols-[80px_1fr_1fr_40px] gap-2 items-center text-sm"
                      >
                        <span className="font-mono font-medium">
                          {record.type}
                        </span>
                        <span className="font-mono text-xs truncate">
                          {record.name}
                        </span>
                        <span className="font-mono text-xs truncate">
                          {record.value}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={() => copyToClipboard(record.value)}
                          title="Copy value"
                        >
                          <Copy className="size-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-2 text-sm">
                    {domain.domain.split(".").length > 2 ? (
                      <div className="grid grid-cols-[80px_1fr_1fr_40px] gap-2 items-center">
                        <span className="font-mono font-medium">CNAME</span>
                        <span className="font-mono text-xs truncate">
                          {domain.domain}
                        </span>
                        <span className="font-mono text-xs truncate">
                          cname.vercel-dns.com
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={() =>
                            copyToClipboard("cname.vercel-dns.com")
                          }
                          title="Copy value"
                        >
                          <Copy className="size-3" />
                        </Button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-[80px_1fr_1fr_40px] gap-2 items-center">
                        <span className="font-mono font-medium">A</span>
                        <span className="font-mono text-xs truncate">
                          {domain.domain}
                        </span>
                        <span className="font-mono text-xs truncate">
                          76.76.21.21
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={() => copyToClipboard("76.76.21.21")}
                          title="Copy value"
                        >
                          <Copy className="size-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  DNS changes can take 5 minutes to 48 hours to propagate. Your
                  booking URL continues to work during this time.
                </p>
              </div>
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  );
}
