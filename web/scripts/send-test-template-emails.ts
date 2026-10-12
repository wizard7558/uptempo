/**
 * Send sample Form Request + Aftercare emails to a test address using the
 * latest templates in a tenant schema (and a real form_responses row + token
 * for a working form link).
 *
 * Usage (from web/):
 *   npx tsx scripts/send-test-template-emails.ts <to-email> [tenant-slug]
 *
 * Requires DATABASE_URL, RESEND_API_KEY (or emails log as [Email Dev]),
 * BOOKING_SESSION_SECRET (same as production for valid form links),
 * NEXT_PUBLIC_APP_URL for form URLs (optional; defaults per getBaseUrl()).
 */

import { config } from "dotenv";
import postgres from "postgres";
import { createFormToken } from "../src/lib/email/tokens";
import { sendEmail } from "../src/lib/email/send";
import { FormRequestEmail } from "../src/emails/form-request";
import { AftercareEmail } from "../src/emails/aftercare";
import { getBaseUrl } from "../src/lib/utils";

config({ path: ".env.local" });
config({ path: ".env" });
// Optional: USE_TEMPLATE_EMAIL_ENV=/path/to/.env.vercel.production npx tsx ... (override for prod DB)
if (process.env.USE_TEMPLATE_EMAIL_ENV) {
  config({ path: process.env.USE_TEMPLATE_EMAIL_ENV, override: true });
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required (set in .env.local)");
  process.exit(1);
}

function assertSafeSlug(slug: string): string {
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new Error(`Invalid tenant slug: ${slug}`);
  }
  return slug;
}

async function main() {
  const [to, slugArg] = process.argv.slice(2);
  if (!to || !to.includes("@")) {
    console.error(
      "Usage: npx tsx scripts/send-test-template-emails.ts <to-email> [tenant-slug]",
    );
    process.exit(1);
  }

  const sql = postgres(DATABASE_URL);

  let slug = slugArg;
  if (!slug) {
    const candidates = await sql<{ slug: string }[]>`
      SELECT slug FROM tenants ORDER BY updated_at DESC
    `;
    if (candidates.length === 0) {
      console.error("No tenants in database.");
      await sql.end({ timeout: 2 });
      process.exit(1);
    }
    for (const c of candidates) {
      const s = assertSafeSlug(c.slug);
      const schema = `tenant_${s}`;
      const [{ formCount }] = await sql<{ formCount: string }[]>`
        SELECT COUNT(*)::text AS "formCount"
        FROM ${sql(schema)}.form_templates
        WHERE is_active = 1
      `;
      const [{ afterCount }] = await sql<{ afterCount: string }[]>`
        SELECT COUNT(*)::text AS "afterCount"
        FROM ${sql(schema)}.aftercare_templates
        WHERE is_active = 1
      `;
      if (Number(formCount) > 0 || Number(afterCount) > 0) {
        slug = s;
        break;
      }
    }
    if (!slug) {
      console.error(
        "No tenant has active form or aftercare templates. Pass tenant-slug explicitly or create templates in Settings.",
      );
      await sql.end({ timeout: 2 });
      process.exit(1);
    }
    console.log(`Using tenant slug: ${slug}`);
  }

  slug = assertSafeSlug(slug);
  const schemaName = `tenant_${slug}`;

  const [tenant] = await sql<{ name: string }[]>`
    SELECT name FROM tenants WHERE slug = ${slug} LIMIT 1
  `;
  const salonName = tenant?.name ?? "Our Salon";

  const [formTpl] = await sql<
    { id: string; name: string; description: string | null }[]
  >`
    SELECT id, name, description
    FROM ${sql(schemaName)}.form_templates
    WHERE is_active = 1
    ORDER BY created_at DESC
    LIMIT 1
  `;

  const [afterTpl] = await sql<
    {
      name: string;
      content: string;
      product_recommendations: string | null;
    }[]
  >`
    SELECT name, content, product_recommendations
    FROM ${sql(schemaName)}.aftercare_templates
    WHERE is_active = 1
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (!formTpl) {
    console.error("No active form template found for this tenant.");
  }
  if (!afterTpl) {
    console.error("No active aftercare template found for this tenant.");
  }

  const baseUrl = getBaseUrl();

  // --- Form request email (needs appointment + stub form_response) ---
  if (formTpl) {
    const [appt] = await sql<
      { appointment_id: string; client_id: string; client_name: string }[]
    >`
      SELECT
        a.id AS appointment_id,
        a.client_id,
        c.name AS client_name
      FROM ${sql(schemaName)}.appointments a
      INNER JOIN ${sql(schemaName)}.clients c ON c.id = a.client_id
      LIMIT 1
    `;

    if (!appt) {
      console.warn(
        "Skipping form email: no appointments with clients found (create a booking first).",
      );
    } else {
      const [inserted] = await sql<{ id: string }[]>`
        INSERT INTO ${sql(schemaName)}.form_responses (
          form_template_id,
          appointment_id,
          client_id,
          responses
        ) VALUES (
          ${formTpl.id}::uuid,
          ${appt.appointment_id}::uuid,
          ${appt.client_id}::uuid,
          '{}'::jsonb
        )
        RETURNING id
      `;

      const formToken = createFormToken(inserted!.id, appt.appointment_id);
      const formUrl = `${baseUrl}/forms/${formToken}`;

      const r = await sendEmail({
        to,
        subject: `Please complete: ${formTpl.name}`,
        react: FormRequestEmail({
          salonName,
          clientName: appt.client_name,
          formName: formTpl.name,
          formDescription: formTpl.description,
          formUrl,
        }),
        salonName,
      });
      console.log(
        r.success
          ? `Form request email sent (id: ${r.id ?? "dev-log"})`
          : "Form request email failed (Resend error — see logs)",
      );
      console.log(`  Form preview URL: ${formUrl}`);
    }
  }

  // --- Aftercare email ---
  if (afterTpl) {
    const r = await sendEmail({
      to,
      subject: `Your aftercare instructions from ${salonName}`,
      react: AftercareEmail({
        salonName,
        clientName: "Riley",
        templates: [
          {
            name: afterTpl.name,
            content: afterTpl.content,
            productRecommendations: afterTpl.product_recommendations,
          },
        ],
      }),
      salonName,
    });
    console.log(
      r.success
        ? `Aftercare email sent (id: ${r.id ?? "dev-log"})`
        : "Aftercare email failed (Resend error — see logs)",
    );
  }

  await sql.end({ timeout: 5 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
