"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";

interface EmailPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  loadHtml: () => Promise<string>;
}

export function EmailPreviewDialog({
  open,
  onOpenChange,
  title,
  loadHtml,
}: EmailPreviewDialogProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleOpenChange(next: boolean) {
    if (next && !html) {
      setLoading(true);
      try {
        const result = await loadHtml();
        setHtml(result);
      } finally {
        setLoading(false);
      }
    }
    if (!next) {
      setHtml(null);
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-0 shrink-0">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 px-6 pb-6">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : html ? (
            <iframe
              srcDoc={html}
              title={title}
              className="w-full h-full rounded-md border"
              sandbox="allow-popups"
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
