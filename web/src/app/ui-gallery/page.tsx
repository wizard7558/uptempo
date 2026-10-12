import { notFound } from "next/navigation";

import { GalleryBoard } from "./gallery-board";

export default function UiGalleryPage() {
  if (process.env.VERCEL_ENV === "production") notFound();
  return <GalleryBoard />;
}
