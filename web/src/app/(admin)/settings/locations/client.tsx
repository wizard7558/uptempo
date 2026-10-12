"use client";

import { useState, useTransition } from "react";
import { createLocation, listLocations, updateLocation } from "@/actions/locations";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { LinkIcon } from "lucide-react";
import { toast } from "sonner";

interface LocationRecord {
  id: string;
  name: string;
  address: string | null;
  isActive: number;
  createdAt: Date;
  updatedAt: Date;
}

interface LocationsPageClientProps {
  initialLocations: LocationRecord[];
  salonSlug: string;
}

export function LocationsPageClient({
  initialLocations,
  salonSlug,
}: LocationsPageClientProps) {
  const [locations, setLocations] = useState(initialLocations);
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [isPending, startTransition] = useTransition();

  async function refreshLocations() {
    const updated = await listLocations();
    setLocations(updated);
  }

  function handleCreate() {
    startTransition(async () => {
      const result = await createLocation({
        name: newName,
        address: newAddress || null,
      });

      if (!result.success) {
        toast.error(
          "message" in result.error
            ? result.error.message
            : "Failed to create location",
        );
        return;
      }

      setNewName("");
      setNewAddress("");
      await refreshLocations();
      toast.success("Location created");
    });
  }

  function handleSave(location: LocationRecord) {
    startTransition(async () => {
      const result = await updateLocation({
        id: location.id,
        name: location.name,
        address: location.address,
        isActive: location.isActive,
      });

      if (!result.success) {
        toast.error(
          "message" in result.error
            ? result.error.message
            : "Failed to update location",
        );
        return;
      }

      await refreshLocations();
      toast.success("Location saved");
    });
  }

  async function copyBookingLink(location: LocationRecord) {
    const url = `${window.location.origin}/book/${salonSlug}?location=${location.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Booking link copied", { description: url });
    } catch {
      toast.error("Couldn't copy — here's the link", { description: url });
    }
  }

  function updateDraft(
    id: string,
    changes: Partial<Pick<LocationRecord, "name" | "address" | "isActive">>,
  ) {
    setLocations((current) =>
      current.map((location) =>
        location.id === id ? { ...location, ...changes } : location,
      ),
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Add Location</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="location-name">Location name</Label>
              <Input
                id="location-name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="Newport Beach"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="location-address">Address</Label>
              <Textarea
                id="location-address"
                value={newAddress}
                onChange={(event) => setNewAddress(event.target.value)}
                placeholder="123 Main St, Newport Beach, CA 92660"
                rows={3}
              />
            </div>
          </div>

          <Button
            onClick={handleCreate}
            disabled={isPending || newName.trim().length === 0}
          >
            {isPending ? "Saving..." : "Add Location"}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {locations.map((location) => (
          <Card key={location.id}>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base">{location.name}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Used in booking, reminders, and calendar events.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Label htmlFor={`active-${location.id}`} className="text-sm">
                  Active
                </Label>
                <Switch
                  id={`active-${location.id}`}
                  checked={location.isActive === 1}
                  onCheckedChange={(checked) =>
                    updateDraft(location.id, { isActive: checked ? 1 : 0 })
                  }
                />
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor={`name-${location.id}`}>Location name</Label>
                  <Input
                    id={`name-${location.id}`}
                    value={location.name}
                    onChange={(event) =>
                      updateDraft(location.id, { name: event.target.value })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`address-${location.id}`}>Address</Label>
                  <Textarea
                    id={`address-${location.id}`}
                    value={location.address ?? ""}
                    onChange={(event) =>
                      updateDraft(location.id, {
                        address: event.target.value || null,
                      })
                    }
                    rows={3}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => handleSave(location)}
                  disabled={isPending || location.name.trim().length === 0}
                >
                  {isPending ? "Saving..." : "Save Changes"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => copyBookingLink(location)}
                  title="Copy a booking link that pre-selects this location"
                >
                  <LinkIcon className="mr-2 size-4" />
                  Copy booking link
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
