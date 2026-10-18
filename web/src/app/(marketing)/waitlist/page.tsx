import { permanentRedirect } from "next/navigation";

export default function WaitlistPage(): never {
  permanentRedirect("/signup");
}
