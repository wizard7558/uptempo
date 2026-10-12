"use client";

import { authClient } from "@/lib/auth/client";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { revokeNativePush } from "@/lib/native/push-register";

export function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    await revokeNativePush();
    await authClient.signOut();
    router.push("/login");
  }

  return (
    <Button
      variant="ghost"
      
      className="text-xs uppercase tracking-[0.2em]"
      onClick={handleSignOut}
    >
      <LogOut className="mr-2 h-4 w-4" />
      Sign out
    </Button>
  );
}
