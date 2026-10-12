"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import {
  updateClientProfile,
  type ClientProfileData,
} from "@/actions/client-profile";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface Props {
  clientId: string;
  initialProfile: ClientProfileData | null;
  errorMessage?: string;
}

export function ClientProfileForm({
  clientId,
  initialProfile,
  errorMessage,
}: Props) {
  const [pending, setPending] = useState(false);
  const [name, setName] = useState(initialProfile?.name ?? "");
  const [email, setEmail] = useState(initialProfile?.email ?? "");
  const [phone, setPhone] = useState(initialProfile?.phone ?? "");
  const [birthday, setBirthday] = useState(initialProfile?.birthday ?? "");
  const [gender, setGender] = useState(initialProfile?.gender ?? "");
  const [address, setAddress] = useState(initialProfile?.address ?? "");
  const [city, setCity] = useState(initialProfile?.city ?? "");
  const [state, setState] = useState(initialProfile?.state ?? "");
  const [zip, setZip] = useState(initialProfile?.zip ?? "");

  if (errorMessage === "Unauthorized") {
    return (
      <p className="text-sm text-destructive">
        Your session expired. Book again to sign in.
      </p>
    );
  }

  if (!initialProfile && errorMessage) {
    return (
      <p className="text-sm text-destructive">{errorMessage}</p>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const res = await updateClientProfile(clientId, {
      name,
      email: email || null,
      phone: phone || null,
      birthday: birthday || null,
      gender: gender || null,
      address: address || null,
      city: city || null,
      state: state || null,
      zip: zip || null,
    });
    setPending(false);
    if (res.success) {
      toast.success("Profile saved");
    } else {
      toast.error(res.error);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 border border-[var(--line)] bg-[var(--ivory-raised)] p-4">
      <Field htmlFor="name" label="Name" required>
        <Field.Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoComplete="name"
        />
      </Field>
      <Field htmlFor="email" label="Email">
        <Field.Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
      </Field>
      <Field htmlFor="phone" label="Phone">
        <Field.Input
          id="phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoComplete="tel"
        />
      </Field>
      <Field htmlFor="birthday" label="Birthday">
        <Field.Input
          id="birthday"
          type="date"
          value={birthday ? birthday.slice(0, 10) : ""}
          onChange={(e) => setBirthday(e.target.value)}
        />
      </Field>
      <Field htmlFor="gender" label="Gender (optional)">
        <Field.Input
          id="gender"
          value={gender}
          onChange={(e) => setGender(e.target.value)}
          placeholder="How you identify"
        />
      </Field>
      <Field htmlFor="address" label="Street address">
        <Field.Input
          id="address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          autoComplete="street-address"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field htmlFor="city" label="City">
          <Field.Input
            id="city"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            autoComplete="address-level2"
          />
        </Field>
        <Field htmlFor="state" label="State">
          <Field.Input
            id="state"
            value={state}
            onChange={(e) => setState(e.target.value)}
            autoComplete="address-level1"
          />
        </Field>
      </div>
      <Field htmlFor="zip" label="ZIP">
        <Field.Input
          id="zip"
          value={zip}
          onChange={(e) => setZip(e.target.value)}
          autoComplete="postal-code"
        />
      </Field>
      <Button
        type="submit"
        disabled={pending}
        className="w-full sm:w-auto"
        variant="default"
        
      >
        {pending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Saving...
          </>
        ) : (
          "Save profile"
        )}
      </Button>
    </form>
  );
}
