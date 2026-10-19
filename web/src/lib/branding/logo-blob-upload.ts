import { uploadImageToBlobStorage } from "@/lib/storage/image-blob-upload";

export type UploadLogoToBlobResult =
  | { ok: true; url: string }
  | { ok: false; error: string; detail?: string };

/**
 * Store a business logo in Vercel Blob (server-only). Used by the `uploadBusinessLogo`
 * server action. Thin wrapper over the shared image-blob upload.
 */
export async function uploadLogoToBlobStorage(input: {
  userId: string;
  file: File;
  oldUrl: string | null;
}): Promise<UploadLogoToBlobResult> {
  return uploadImageToBlobStorage({
    pathPrefix: "logos",
    key: input.userId,
    file: input.file,
    oldUrl: input.oldUrl,
    maxBytes: 2 * 1024 * 1024,
  });
}
