import { OG_SIZE, renderOgImage } from "@/lib/brand/og-image";

export const alt = "Uptempo Bookings";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function OpengraphImage() {
  return renderOgImage("Scheduling software for appointment businesses.");
}
