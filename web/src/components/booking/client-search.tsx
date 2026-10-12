"use client";

import { useState, useEffect, useDeferredValue } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { X, UserPlus, Search } from "lucide-react";
import { listClients, createClient } from "@/actions/clients";
import { toast } from "sonner";

interface Client {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

interface ClientSearchProps {
  selectedClient: Client | null;
  onSelect: (client: Client | null) => void;
}

export function ClientSearch({ selectedClient, onSelect }: ClientSearchProps) {
  const [open, setOpen] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState("");
  const [showNewForm, setShowNewForm] = useState(false);
  const [newClient, setNewClient] = useState({
    name: "",
    email: "",
    phone: "",
  });
  const [isCreating, setIsCreating] = useState(false);
  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    listClients({ q: deferredSearch, page: 1, pageSize: 50 }).then((result) => {
      setClients(
        result.clients.map((client) => ({
          id: client.id,
          name: client.name,
          email: client.email,
          phone: client.phone,
        })),
      );
    });
  }, [deferredSearch]);

  async function handleCreateClient() {
    if (!newClient.name.trim()) return;

    setIsCreating(true);
    const result = await createClient({
      name: newClient.name.trim(),
      email: newClient.email.trim() || null,
      phone: newClient.phone.trim() || null,
    });

    if (result.success) {
      const client: Client = {
        id: result.id,
        name: newClient.name.trim(),
        email: newClient.email.trim() || null,
        phone: newClient.phone.trim() || null,
      };
      onSelect(client);
      setClients((prev) => [...prev, client]);
      setNewClient({ name: "", email: "", phone: "" });
      setShowNewForm(false);
      setOpen(false);
      toast.success("Client created");
    } else {
      const message =
        result.error && "message" in result.error
          ? (result.error as { message?: string }).message
          : undefined;
      toast.error(message ?? "Failed to create client");
    }
    setIsCreating(false);
  }

  if (selectedClient) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="gap-1 py-1">
          {selectedClient.name}
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="ml-1 rounded-full hover:bg-muted"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
        {selectedClient.email && (
          <span className="text-xs text-muted-foreground">
            {selectedClient.email}
          </span>
        )}
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-start text-muted-foreground"
        >
          <Search className="mr-2 h-4 w-4" />
          Search clients...
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        {showNewForm ? (
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">New Client</h4>
              <Button
                variant="ghost"
                
                onClick={() => setShowNewForm(false)}
              >
                Back
              </Button>
            </div>
            <div className="space-y-2">
              <div>
                <Label htmlFor="new-name" className="text-xs">
                  Name *
                </Label>
                <Input
                  id="new-name"
                  value={newClient.name}
                  onChange={(e) =>
                    setNewClient((p) => ({ ...p, name: e.target.value }))
                  }
                  placeholder="Client name"
                  className="h-8"
                />
              </div>
              <div>
                <Label htmlFor="new-email" className="text-xs">
                  Email
                </Label>
                <Input
                  id="new-email"
                  type="email"
                  value={newClient.email}
                  onChange={(e) =>
                    setNewClient((p) => ({ ...p, email: e.target.value }))
                  }
                  placeholder="email@example.com"
                  className="h-8"
                />
              </div>
              <div>
                <Label htmlFor="new-phone" className="text-xs">
                  Phone
                </Label>
                <Input
                  id="new-phone"
                  type="tel"
                  value={newClient.phone}
                  onChange={(e) =>
                    setNewClient((p) => ({ ...p, phone: e.target.value }))
                  }
                  placeholder="(555) 555-5555"
                  className="h-8"
                />
              </div>
            </div>
            <Button
              
              className="w-full"
              onClick={handleCreateClient}
              disabled={!newClient.name.trim() || isCreating}
            >
              {isCreating ? "Creating..." : "Create & Select"}
            </Button>
          </div>
        ) : (
          <Command>
            <CommandInput
              placeholder="Search by name, email, or phone..."
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty>No clients found.</CommandEmpty>
              <CommandGroup>
                {clients.map((client) => (
                  <CommandItem
                    key={client.id}
                    value={`${client.name} ${client.email ?? ""} ${client.phone ?? ""}`}
                    onSelect={() => {
                      onSelect(client);
                      setOpen(false);
                    }}
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">{client.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {[client.email, client.phone]
                          .filter(Boolean)
                          .join(" | ")}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup>
                <CommandItem onSelect={() => setShowNewForm(true)}>
                  <UserPlus className="mr-2 h-4 w-4" />
                  Create new client
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  );
}
