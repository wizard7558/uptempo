"use client";

import { useState, useRef, useTransition, useCallback } from "react";
import Link from "next/link";
import {
  type ColumnMapping,
  previewCSV,
  importClients,
  parseExcelFile,
} from "@/actions/import-clients";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Upload,
  FileSpreadsheet,
  Check,
  AlertCircle,
  ArrowLeft,
} from "lucide-react";

type Stage = "idle" | "previewing" | "importing" | "complete";

const MAPPING_OPTIONS: { value: ColumnMapping; label: string }[] = [
  { value: "name", label: "Full Name" },
  { value: "first_name", label: "First Name" },
  { value: "last_name", label: "Last Name" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "notes", label: "Notes" },
  { value: "birthday", label: "Birthday" },
  { value: "gender", label: "Gender" },
  { value: "address", label: "Address" },
  { value: "apt_suite", label: "Apt/Suite" },
  { value: "city", label: "City" },
  { value: "state", label: "State" },
  { value: "zip", label: "Zip" },
  { value: "customer_since", label: "Customer Since" },
  { value: "appointments_booked", label: "Appointments Booked" },
  { value: "skip", label: "Skip" },
];

const ACCEPTED_TYPES = ".csv,.xlsx,.xls";

export function ImportClientsClient() {
  const [stage, setStage] = useState<Stage>("idle");
  const [csvString, setCsvString] = useState("");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [previewRows, setPreviewRows] = useState<string[][]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [result, setResult] = useState<{
    imported: number;
    skipped: number;
    errors: string[];
  } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const processCSV = useCallback((text: string) => {
    startTransition(async () => {
      const res = await previewCSV(text);
      if (!res.success) {
        toast.error(res.error);
        setStage("idle");
        return;
      }
      setCsvString(text);
      setHeaders(res.headers);
      setMappings(res.mappings);
      setPreviewRows(res.previewRows);
      setTotalRows(res.totalRows);
      setStage("previewing");
    });
  }, []);

  const handleFile = useCallback(
    (file: File) => {
      const name = file.name.toLowerCase();
      const isExcel = name.endsWith(".xlsx") || name.endsWith(".xls");
      const isCsv = name.endsWith(".csv");

      if (!isExcel && !isCsv) {
        toast.error("Please upload a CSV or Excel file (.csv, .xlsx, .xls).");
        return;
      }

      setFileName(file.name);

      if (isExcel) {
        // Parse Excel server-side via FormData
        const formData = new FormData();
        formData.append("file", file);

        startTransition(async () => {
          const res = await parseExcelFile(formData);
          if (!res.success) {
            toast.error(res.error);
            setStage("idle");
            return;
          }
          processCSV(res.csvString);
        });
        return;
      }

      // CSV: read as text on client
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        processCSV(text);
      };
      reader.onerror = () => {
        toast.error("Failed to read file.");
      };
      reader.readAsText(file);
    },
    [processCSV],
  );

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }

  function updateMapping(index: number, value: ColumnMapping) {
    setMappings((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  function handleImport() {
    setStage("importing");
    startTransition(async () => {
      const res = await importClients(csvString, mappings);
      if (!res.success) {
        toast.error(res.error);
        setStage("previewing");
        return;
      }
      setResult({ imported: res.imported, skipped: res.skipped, errors: res.errors });
      setStage("complete");
    });
  }

  function handleReset() {
    setStage("idle");
    setCsvString("");
    setFileName("");
    setHeaders([]);
    setMappings([]);
    setPreviewRows([]);
    setTotalRows(0);
    setResult(null);
  }

  // Check if at least name or (first+last) or email is mapped
  const hasNameMapping =
    mappings.includes("name") ||
    (mappings.includes("first_name") && mappings.includes("last_name"));
  const hasEmailMapping = mappings.includes("email");
  const canImport = hasNameMapping || hasEmailMapping;

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/clients">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Import Clients</h1>
          <p className="text-muted-foreground mt-1">
            Upload a CSV or Excel file to bulk-import your client list.
          </p>
        </div>
      </div>

      {/* Idle — File Upload */}
      {stage === "idle" && (
        <Card>
          <CardHeader>
            <CardTitle>Upload File</CardTitle>
            <CardDescription>
              Export your client list from Vagaro or other software as a CSV or
              Excel file, then upload it here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className={`flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 transition-colors cursor-pointer ${
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-primary/50"
              }`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              {isPending ? (
                <FileSpreadsheet className="size-10 text-muted-foreground animate-pulse" />
              ) : (
                <Upload className="size-10 text-muted-foreground" />
              )}
              <p className="text-sm text-muted-foreground">
                {isPending
                  ? "Reading file..."
                  : "Drop your file here or click to browse"}
              </p>
              <p className="text-xs text-muted-foreground">
                Supports .csv, .xlsx, and .xls files
              </p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED_TYPES}
              onChange={handleFileInput}
              className="hidden"
            />
          </CardContent>
        </Card>
      )}

      {/* Previewing — Column Mapping + Preview Table */}
      {stage === "previewing" && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5" />
                {fileName}
              </CardTitle>
              <CardDescription>
                {totalRows} row{totalRows !== 1 ? "s" : ""} detected. Map each
                column to the correct field, then import.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Column Mappings */}
              <div className="space-y-3">
                <Label className="text-sm font-medium">Column Mapping</Label>
                <div className="grid gap-3 sm:grid-cols-2">
                  {headers.map((header, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="min-w-[120px] truncate text-sm text-muted-foreground">
                        {header}
                      </span>
                      <Select
                        value={mappings[i]}
                        onValueChange={(v) =>
                          updateMapping(i, v as ColumnMapping)
                        }
                      >
                        <SelectTrigger className="w-[160px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MAPPING_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>

              {/* Validation warning */}
              {!canImport && (
                <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Please map at least a Name (or First Name + Last Name) or
                    Email column to continue.
                  </span>
                </div>
              )}

              {/* Preview Table */}
              {previewRows.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium">
                    Preview (first {previewRows.length} row
                    {previewRows.length !== 1 ? "s" : ""})
                  </Label>
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          {headers.map((h, i) => (
                            <th
                              key={i}
                              className="whitespace-nowrap px-3 py-2 text-left font-medium"
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row, ri) => (
                          <tr key={ri} className="border-b last:border-0">
                            {headers.map((_, ci) => (
                              <td
                                key={ci}
                                className="whitespace-nowrap px-3 py-2 text-muted-foreground"
                              >
                                {row[ci] ?? ""}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-3 pt-2">
                <Button
                  onClick={handleImport}
                  disabled={!canImport || isPending}
                >
                  {isPending ? "Importing..." : `Import ${totalRows} client${totalRows !== 1 ? "s" : ""}`}
                </Button>
                <Button variant="outline" onClick={handleReset}>
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Importing */}
      {stage === "importing" && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <FileSpreadsheet className="size-10 text-muted-foreground animate-pulse" />
            <p className="text-muted-foreground">Importing clients...</p>
          </CardContent>
        </Card>
      )}

      {/* Complete */}
      {stage === "complete" && result && (
        <Card>
          <CardContent className="space-y-4 py-8">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-700">
                <Check className="h-6 w-6" />
              </div>
              <h2 className="text-lg font-semibold">Import Complete</h2>
              <p className="text-muted-foreground">
                Imported {result.imported} client
                {result.imported !== 1 ? "s" : ""}
                {result.skipped > 0 && (
                  <>, skipped {result.skipped} duplicate{result.skipped !== 1 ? "s" : ""}</>
                )}
                .
              </p>
            </div>

            {result.errors.length > 0 && (
              <div className="mx-auto max-w-md space-y-1 rounded-md bg-muted p-3 text-sm text-muted-foreground">
                {result.errors.slice(0, 10).map((err, i) => (
                  <p key={i}>{err}</p>
                ))}
                {result.errors.length > 10 && (
                  <p className="font-medium">
                    ...and {result.errors.length - 10} more
                  </p>
                )}
              </div>
            )}

            <div className="flex items-center justify-center gap-3 pt-2">
              <Link href="/clients">
                <Button>View Clients</Button>
              </Link>
              <Button variant="outline" onClick={handleReset}>
                Import More
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
