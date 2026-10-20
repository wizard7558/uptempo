"use server";

import { withTenantDb } from "@/lib/db/tenant";
import { AuthError, requireRole } from "@/lib/auth/rbac";
import { trackEvent } from "@/lib/analytics/events";
import { ilike, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { normalizePhone } from "@/lib/phone";

type ImportResult =
  | { success: true; imported: number; skipped: number; errors: string[] }
  | { success: false; error: string };

/** Column roles we can map CSV headers to */
export type ColumnMapping =
  | "first_name"
  | "last_name"
  | "name"
  | "email"
  | "phone"
  | "notes"
  | "birthday"
  | "gender"
  | "address"
  | "apt_suite"
  | "city"
  | "state"
  | "zip"
  | "customer_since"
  | "appointments_booked"
  | "skip";

interface MappedRow {
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  birthday: string | null;
  gender: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  customerSince: string | null;
  appointmentsBooked: number;
}

// ---------------------------------------------------------------------------
// CSV parser — handles quoted fields, commas inside quotes, newlines in
// quoted values, and UTF-8 BOM. No external dependencies.
// ---------------------------------------------------------------------------

function parseCSV(raw: string): string[][] {
  // Strip UTF-8 BOM
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        // Peek next character
        if (i + 1 < text.length && text[i + 1] === '"') {
          // Escaped double-quote
          field += '"';
          i += 2;
          continue;
        }
        // End of quoted field
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    // Not in quotes
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      // Handle \r\n and bare \r as row terminator
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      i++;
      if (i < text.length && text[i] === "\n") i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      i++;
      continue;
    }
    field += ch;
    i++;
  }

  // Flush remaining field / row
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Column auto-detection
// ---------------------------------------------------------------------------

const COLUMN_ALIASES: Record<ColumnMapping, string[]> = {
  first_name: [
    "first name",
    "first_name",
    "firstname",
    "fname",
    "given name",
    "given_name",
  ],
  last_name: [
    "last name",
    "last_name",
    "lastname",
    "lname",
    "surname",
    "family name",
    "family_name",
  ],
  name: ["name", "full name", "full_name", "fullname", "client name", "client_name"],
  email: [
    "email",
    "email address",
    "email_address",
    "emailaddress",
    "e-mail",
    "e_mail",
    "client email",
  ],
  phone: [
    "phone",
    "phone number",
    "phone_number",
    "phonenumber",
    "mobile",
    "mobile phone",
    "mobile_phone",
    "cell",
    "cell phone",
    "cell_phone",
    "telephone",
    "tel",
    "client phone",
  ],
  notes: [
    "notes",
    "note",
    "client notes",
    "client_notes",
    "comments",
    "comment",
    "memo",
  ],
  birthday: [
    "birthday",
    "birthdate",
    "birth date",
    "birth_date",
    "date of birth",
    "dob",
  ],
  gender: ["gender", "sex"],
  address: ["address", "street", "street address", "street_address"],
  apt_suite: ["apt/suite", "apt", "suite", "apartment", "unit"],
  city: ["city", "town"],
  state: ["state", "province", "region"],
  zip: ["zip", "zipcode", "zip code", "zip_code", "postal code", "postal_code"],
  customer_since: [
    "customer since",
    "customer_since",
    "created",
    "joined",
    "join date",
    "signup date",
  ],
  appointments_booked: [
    "appointments booked",
    "appointments_booked",
    "total appointments",
    "bookings",
    "visits",
  ],
  skip: [],
};

/** Headers that should be auto-skipped (Vagaro columns we don't map) */
const AUTO_SKIP_HEADERS = new Set([
  "last visited",
  "membership",
  "day",
  "night",
  "refered by",
  "referred by",
  "online booking",
  "credit card",
  "bank",
  "tags",
  "classes booked",
  "check-ins",
  "points earned",
  "amount paid",
  "no shows/cancellations",
  "employee seen",
]);

function detectColumnMapping(headers: string[]): ColumnMapping[] {
  return headers.map((raw) => {
    const normalized = raw.trim().toLowerCase();
    if (AUTO_SKIP_HEADERS.has(normalized)) return "skip" as ColumnMapping;
    for (const [mapping, aliases] of Object.entries(COLUMN_ALIASES) as [
      ColumnMapping,
      string[],
    ][]) {
      if (mapping === "skip") continue;
      if (aliases.includes(normalized)) return mapping;
    }
    return "skip" as ColumnMapping;
  });
}

// ---------------------------------------------------------------------------
// Data cleaning
// ---------------------------------------------------------------------------

/** Treat Vagaro's "---" placeholder as empty */
function cleanValue(val: string): string {
  const trimmed = val.trim();
  return trimmed === "---" ? "" : trimmed;
}

/** Parse human-readable dates like "Oct 29, 2025" or "Sep 17, 2007" to YYYY-MM-DD */
function parseDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Try ISO format first (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  // Try "Mon DD, YYYY" format (Vagaro style)
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, "0");
    const d = String(parsed.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function mapRow(
  fields: string[],
  mappings: ColumnMapping[],
): MappedRow | null {
  let firstName = "";
  let lastName = "";
  let name = "";
  let email = "";
  let phone = "";
  let notes = "";
  let birthday = "";
  let gender = "";
  let address = "";
  let aptSuite = "";
  let city = "";
  let state = "";
  let zip = "";
  let customerSince = "";
  let appointmentsBooked = "";

  for (let i = 0; i < mappings.length; i++) {
    const value = cleanValue(fields[i] ?? "");
    switch (mappings[i]) {
      case "first_name":
        firstName = value;
        break;
      case "last_name":
        lastName = value;
        break;
      case "name":
        name = value;
        break;
      case "email":
        email = value;
        break;
      case "phone":
        phone = value;
        break;
      case "notes":
        notes = value;
        break;
      case "birthday":
        birthday = value;
        break;
      case "gender":
        gender = value;
        break;
      case "address":
        address = value;
        break;
      case "apt_suite":
        aptSuite = value;
        break;
      case "city":
        city = value;
        break;
      case "state":
        state = value;
        break;
      case "zip":
        zip = value;
        break;
      case "customer_since":
        customerSince = value;
        break;
      case "appointments_booked":
        appointmentsBooked = value;
        break;
    }
  }

  // Combine first + last name if there's no single "name" column
  const fullName = name || [firstName, lastName].filter(Boolean).join(" ");

  // Combine apt/suite with address
  const fullAddress = [aptSuite, address].filter(Boolean).join(" ");

  // Require at least a name to import (relaxed for bulk imports — no email/phone required)
  if (!fullName && !email) return null;

  return {
    name: fullName || email, // fall back to email as name if needed
    email: email || null,
    phone: normalizePhone(phone),
    notes: notes || null,
    birthday: parseDate(birthday),
    gender: gender ? gender.charAt(0).toUpperCase() + gender.slice(1).toLowerCase() : null,
    address: fullAddress || null,
    city: city || null,
    state: state || null,
    zip: zip || null,
    customerSince: parseDate(customerSince),
    appointmentsBooked: parseInt(appointmentsBooked, 10) || 0,
  };
}

// ---------------------------------------------------------------------------
// Excel parsing
// ---------------------------------------------------------------------------

/**
 * Parse an Excel file (uploaded as FormData) and convert to CSV string.
 * Auto-detects the header row by looking for known column names,
 * skipping Vagaro metadata rows.
 */
export async function parseExcelFile(formData: FormData): Promise<
  | { success: true; csvString: string }
  | { success: false; error: string }
> {
  await requireRole("owner", "admin");
  try {

    const file = formData.get("file") as File | null;
    if (!file) {
      return { success: false, error: "No file provided." };
    }

    const XLSX = await import("xlsx");
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return { success: false, error: "Excel file has no sheets." };
    }

    const sheet = workbook.Sheets[sheetName];
    const allRows: string[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      raw: false,
    });

    if (allRows.length < 2) {
      return { success: false, error: "Excel file has no data." };
    }

    // Auto-detect header row: find the first row with 3+ recognized column names
    let headerIndex = 0;
    for (let i = 0; i < Math.min(allRows.length, 10); i++) {
      const row = allRows[i];
      const detected = detectColumnMapping(row);
      const recognized = detected.filter((m) => m !== "skip").length;
      if (recognized >= 3) {
        headerIndex = i;
        break;
      }
    }

    // Build CSV from header row onward
    const dataRows = allRows.slice(headerIndex);
    const csvString = dataRows
      .map((row) =>
        row
          .map((cell) => {
            const str = String(cell ?? "");
            // Quote fields containing commas, quotes, or newlines
            if (str.includes(",") || str.includes('"') || str.includes("\n")) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          })
          .join(","),
      )
      .join("\n");

    return { success: true, csvString };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to parse Excel file.";
    return { success: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// Server action — import
// ---------------------------------------------------------------------------

export async function importClients(
  csvString: string,
  columnMappings: ColumnMapping[],
): Promise<ImportResult> {
  const { userId, tenantSlug } = await requireRole("owner", "admin");
  if (!tenantSlug) throw new AuthError("NO_TENANT", "No active business");
  const slug = tenantSlug;
  try {

    const rows = parseCSV(csvString);
    if (rows.length < 2) {
      return { success: false, error: "CSV must have a header row and at least one data row." };
    }

    // Skip header row
    const dataRows = rows.slice(1);

    // Validate mappings length matches header count
    if (columnMappings.length !== rows[0].length) {
      return { success: false, error: "Column mapping count does not match CSV columns." };
    }

    const errors: string[] = [];
    const validRows: MappedRow[] = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      // Skip completely empty rows
      if (row.every((cell) => cell.trim() === "")) continue;

      const mapped = mapRow(row, columnMappings);
      if (!mapped) {
        errors.push(`Row ${i + 2}: Skipped — missing both name and email.`);
        continue;
      }
      validRows.push(mapped);
    }

    if (validRows.length === 0) {
      return {
        success: false,
        error: "No valid rows found. Each row must have at least a name or email.",
      };
    }

    // Deduplicate within the import batch by email and phone (keep first occurrence)
    const seenEmails = new Set<string>();
    const seenPhones = new Set<string>();
    const deduped: MappedRow[] = [];
    for (const row of validRows) {
      if (row.email) {
        const lower = row.email.toLowerCase();
        if (seenEmails.has(lower)) continue;
        seenEmails.add(lower);
      }
      if (row.phone) {
        if (seenPhones.has(row.phone)) {
          // Only skip if there's no email (phone-only duplicate)
          if (!row.email) continue;
        }
        seenPhones.add(row.phone);
      }
      deduped.push(row);
    }

    // Insert into tenant DB, skipping existing emails and phones
    let imported = 0;
    let skipped = 0;

    await withTenantDb(slug, async (db, { clients }) => {
      for (const row of deduped) {
        // Check for existing client by email
        if (row.email) {
          const existing = await db
            .select({ id: clients.id })
            .from(clients)
            .where(ilike(clients.email, row.email))
            .limit(1);

          if (existing.length > 0) {
            skipped++;
            continue;
          }
        }

        // Check for existing client by phone
        if (row.phone) {
          const existing = await db
            .select({ id: clients.id })
            .from(clients)
            .where(eq(clients.phone, row.phone))
            .limit(1);

          if (existing.length > 0) {
            skipped++;
            continue;
          }
        }

        await db.insert(clients).values({
          name: row.name,
          email: row.email,
          phone: row.phone,
          notes: row.notes,
          birthday: row.birthday,
          gender: row.gender,
          address: row.address,
          city: row.city,
          state: row.state,
          zip: row.zip,
          customerSince: row.customerSince,
          appointmentsBooked: row.appointmentsBooked,
          source: "import",
        });
        imported++;
      }
    });

    revalidatePath("/clients");
    trackEvent(
      "clients.imported",
      { count: imported, skipped },
      { tenantSlug: slug, userId },
    );

    return { success: true, imported, skipped, errors };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed";
    return { success: false, error: message };
  }
}

/**
 * Parse CSV and detect columns — used by the client preview step.
 * Returns the parsed headers, detected mappings, and first 5 data rows.
 */
export async function previewCSV(csvString: string): Promise<
  | {
      success: true;
      headers: string[];
      mappings: ColumnMapping[];
      previewRows: string[][];
      totalRows: number;
    }
  | { success: false; error: string }
> {
  await requireRole("owner", "admin");
  try {

    const rows = parseCSV(csvString);
    if (rows.length < 2) {
      return { success: false, error: "CSV must have a header row and at least one data row." };
    }

    const headers = rows[0];
    const mappings = detectColumnMapping(headers);
    const dataRows = rows.slice(1).filter((r) => !r.every((c) => c.trim() === ""));

    return {
      success: true,
      headers,
      mappings,
      previewRows: dataRows.slice(0, 5),
      totalRows: dataRows.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Preview failed";
    return { success: false, error: message };
  }
}
