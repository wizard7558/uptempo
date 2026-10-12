import { defineVertical } from "./types";
import type { ServiceTemplate } from "./types";

/**
 * Hair salon industry pack. Reproduces the presets that previously lived in
 * services/preset-catalog, onboarding/service-templates, services/categories,
 * expenses/categories and services/default-assistant-tasks.
 */
const serviceTemplates: ServiceTemplate[] = [
  {
    "name": "Women's Haircut",
    "category": "cut",
    "minutes": 60,
    "priceCents": 8500,
    "description": "Consultation, shampoo, cut, and finish style."
  },
  {
    "name": "Men's Haircut",
    "category": "cut",
    "minutes": 30,
    "priceCents": 4500,
    "description": "Precision cut and style."
  },
  {
    "name": "Kids' Haircut",
    "category": "cut",
    "minutes": 30,
    "priceCents": 3500,
    "description": "Cut for clients age 12 and under."
  },
  {
    "name": "Bang Trim",
    "category": "cut",
    "minutes": 15,
    "priceCents": 1500,
    "description": "Quick fringe maintenance between full cuts."
  },
  {
    "name": "Root Touch-Up",
    "category": "color",
    "minutes": 90,
    "priceCents": 9500,
    "description": "Single-process color on regrowth only.",
    "activeMinutes": 30,
    "processingMinutes": 35
  },
  {
    "name": "Single-Process Color",
    "category": "color",
    "minutes": 120,
    "priceCents": 12500,
    "description": "All-over single application of permanent or demi-color.",
    "activeMinutes": 45,
    "processingMinutes": 35
  },
  {
    "name": "Partial Highlights",
    "category": "color",
    "minutes": 120,
    "priceCents": 14500,
    "description": "Foils on the top and crown for dimensional brightness.",
    "activeMinutes": 60,
    "processingMinutes": 30
  },
  {
    "name": "Full Highlights",
    "category": "color",
    "minutes": 180,
    "priceCents": 19500,
    "description": "Foils throughout for a head-to-tip color change.",
    "activeMinutes": 90,
    "processingMinutes": 35
  },
  {
    "name": "Balayage",
    "category": "color",
    "minutes": 180,
    "priceCents": 22500,
    "description": "Hand-painted highlights for a soft, lived-in lightening effect.",
    "activeMinutes": 90,
    "processingMinutes": 45
  },
  {
    "name": "Foilayage",
    "category": "color",
    "minutes": 210,
    "priceCents": 26500,
    "description": "Balayage technique sealed in foils for extra lift.",
    "activeMinutes": 105,
    "processingMinutes": 45
  },
  {
    "name": "Gloss / Toner",
    "category": "color",
    "minutes": 45,
    "priceCents": 5500,
    "description": "Refresh tone, add shine, and neutralize unwanted warmth.",
    "activeMinutes": 15,
    "processingMinutes": 20
  },
  {
    "name": "Color Correction",
    "category": "color",
    "minutes": 240,
    "priceCents": 35000,
    "description": "Multi-step color repair. Quoted per consultation.",
    "activeMinutes": 120,
    "processingMinutes": 60
  },
  {
    "name": "Blowout",
    "category": "style",
    "minutes": 45,
    "priceCents": 5500,
    "description": "Shampoo and round-brush blow-dry style."
  },
  {
    "name": "Special Occasion Style",
    "category": "style",
    "minutes": 60,
    "priceCents": 9500,
    "description": "Updo, half-up, or formal styling for events and weddings."
  },
  {
    "name": "Keratin Smoothing",
    "category": "treatment",
    "minutes": 150,
    "priceCents": 25000,
    "description": "Smoothing treatment that reduces frizz and cuts blow-dry time.",
    "activeMinutes": 60,
    "processingMinutes": 45
  },
  {
    "name": "Bond Repair Treatment",
    "category": "treatment",
    "minutes": 30,
    "priceCents": 4500,
    "description": "In-salon Olaplex or equivalent bond-builder.",
    "activeMinutes": 15,
    "processingMinutes": 10
  },
  {
    "name": "Deep Conditioning Treatment",
    "category": "treatment",
    "minutes": 30,
    "priceCents": 3500,
    "description": "Hydrating mask with steam or heat processing."
  },
  {
    "name": "Scalp Massage Add-On",
    "category": "addon",
    "minutes": 10,
    "priceCents": 1500,
    "description": "10-minute scalp massage during shampoo."
  },
  {
    "name": "Face-Frame Foils Add-On",
    "category": "addon",
    "minutes": 30,
    "priceCents": 4500,
    "description": "A handful of brightening foils around the face."
  },
  {
    "name": "Extensions Consultation",
    "category": "extensions",
    "minutes": 30,
    "priceCents": 0,
    "description": "Color match, length planning, and custom quote."
  },
  {
    "name": "Tape-In Extension Install",
    "category": "extensions",
    "minutes": 90,
    "priceCents": 18500,
    "description": "Install of one row of tape-in extensions."
  },
  {
    "name": "Extension Move-Up",
    "category": "extensions",
    "minutes": 120,
    "priceCents": 22500,
    "description": "Reposition tape-ins as natural hair grows out."
  }
];

export const hairSalon = defineVertical({
  id: "hair_salon",
  label: "Hair salon",
  description: "Cuts, color, styling and treatments with stylists and processing time.",
  terms: {
    staff: { one: "Stylist", other: "Stylists" },
    customer: { one: "Client", other: "Clients" },
    booking: { one: "Appointment", other: "Appointments" },
    offering: { one: "Service", other: "Services" },
    place: { one: "Salon", other: "Salons" },
    prepaidBalance: "Beauty Bank",
  },
  modules: [
    "processing_time",
    "assistant_tasks",
    "memberships",
    "slot_waitlist",
    "gift_cards",
    "storefront",
    "aftercare",
  ],
  bookingFlow: "book",
  categories: [
  {
    "slug": "cut",
    "name": "Cut"
  },
  {
    "slug": "color",
    "name": "Color"
  },
  {
    "slug": "extensions",
    "name": "Extensions"
  },
  {
    "slug": "style",
    "name": "Style"
  },
  {
    "slug": "treatment",
    "name": "Treatment"
  },
  {
    "slug": "addon",
    "name": "Add-on"
  },
  {
    "slug": "other",
    "name": "Other"
  }
],
  serviceTemplates,
  expenseCategories: [
  "Color",
  "Extensions",
  "Backbar",
  "Retail",
  "Tools & Supplies",
  "Rent",
  "Utilities",
  "Subscriptions",
  "Other"
],
  taskPresets: [
  {
    "name": "Shampoo",
    "minutes": 15
  },
  {
    "name": "All over gloss",
    "minutes": 30
  },
  {
    "name": "Extension prep",
    "minutes": 30
  },
  {
    "name": "Blowdry",
    "minutes": 30
  },
  {
    "name": "Conditioning mask",
    "minutes": 20
  },
  {
    "name": "Laundry",
    "minutes": 15
  },
  {
    "name": "Inventory",
    "minutes": 30
  },
  {
    "name": "Client notes",
    "minutes": 15
  }
],
  clientFields: [
    {
      key: "hair_types",
      label: "Hair profile",
      type: "multi",
      options: [
        { value: "all", label: "All" },
        { value: "blonde", label: "Blonde" },
        { value: "brunette", label: "Brunette" },
        { value: "red", label: "Red" },
        { value: "color-treated", label: "Color Treated" },
        { value: "extensions", label: "Extensions" },
        { value: "curly", label: "Curly" },
        { value: "fine", label: "Fine" },
        { value: "damaged", label: "Damaged" },
      ],
      clientEditable: true,
      matchProductTags: true,
    },
  ],
  defaults: {
    bufferAfterMinutes: 0,
    minNoticeHours: 24,
    maxAdvanceDays: 28,
    slotIntervalMinutes: 15,
  },
});

// ---------------------------------------------------------------------------
// hair_salon-specific extras the generic pack schema does not model. They are
// kept here (not in the schema) so legacy modules can reproduce their exports.
// ---------------------------------------------------------------------------

/** Stable preset keys, index-aligned with `hairSalon.serviceTemplates`. */
export const HAIR_SALON_PRESET_KEYS: string[] = [
  "haircut_womens",
  "haircut_mens",
  "haircut_kids",
  "trim_bang",
  "color_root_touchup",
  "color_single_process",
  "color_partial_highlights",
  "color_full_highlights",
  "color_balayage",
  "color_foilayage",
  "color_gloss_toner",
  "color_correction",
  "style_blowout",
  "style_special_occasion",
  "treatment_keratin_smoothing",
  "treatment_olaplex",
  "treatment_deep_conditioning",
  "addon_scalp_massage",
  "addon_face_frame",
  "extensions_consultation",
  "extensions_install_tape",
  "extensions_move_up"
];

/** Expense category slugs (stored values), index-aligned with `hairSalon.expenseCategories` labels. */
export const HAIR_SALON_EXPENSE_CATEGORY_VALUES: string[] = [
  "color",
  "extensions",
  "backbar",
  "retail",
  "tools_supplies",
  "rent",
  "utilities",
  "subscriptions",
  "other"
];

/** Legacy onboarding quick-add list: different ids, names, prices and a narrower category set than the presets. */
export const HAIR_SALON_ONBOARDING_TEMPLATES: Array<{
  id: string;
  name: string;
  defaultDurationMinutes: number;
  priceCents: number;
  category: "cut" | "color" | "extensions" | "style" | "treatment" | "other";
}> = [
  {
    "id": "womens-haircut",
    "name": "Women's Haircut",
    "defaultDurationMinutes": 60,
    "priceCents": 8500,
    "category": "cut"
  },
  {
    "id": "mens-haircut",
    "name": "Men's Haircut",
    "defaultDurationMinutes": 30,
    "priceCents": 4500,
    "category": "cut"
  },
  {
    "id": "kids-haircut",
    "name": "Kids Haircut",
    "defaultDurationMinutes": 30,
    "priceCents": 3000,
    "category": "cut"
  },
  {
    "id": "bang-trim",
    "name": "Bang Trim",
    "defaultDurationMinutes": 15,
    "priceCents": 1500,
    "category": "cut"
  },
  {
    "id": "blowout",
    "name": "Blowout",
    "defaultDurationMinutes": 45,
    "priceCents": 5500,
    "category": "style"
  },
  {
    "id": "color-full",
    "name": "Color (Full)",
    "defaultDurationMinutes": 120,
    "priceCents": 18000,
    "category": "color"
  },
  {
    "id": "color-root-touchup",
    "name": "Color (Root Touch-Up)",
    "defaultDurationMinutes": 90,
    "priceCents": 12000,
    "category": "color"
  },
  {
    "id": "highlights-full",
    "name": "Highlights (Full)",
    "defaultDurationMinutes": 150,
    "priceCents": 22000,
    "category": "color"
  },
  {
    "id": "highlights-partial",
    "name": "Highlights (Partial)",
    "defaultDurationMinutes": 90,
    "priceCents": 15000,
    "category": "color"
  },
  {
    "id": "balayage",
    "name": "Balayage",
    "defaultDurationMinutes": 180,
    "priceCents": 25000,
    "category": "color"
  },
  {
    "id": "deep-conditioning",
    "name": "Deep Conditioning Treatment",
    "defaultDurationMinutes": 30,
    "priceCents": 4000,
    "category": "treatment"
  },
  {
    "id": "keratin-treatment",
    "name": "Keratin Treatment",
    "defaultDurationMinutes": 180,
    "priceCents": 30000,
    "category": "treatment"
  },
  {
    "id": "updo",
    "name": "Updo / Formal Style",
    "defaultDurationMinutes": 60,
    "priceCents": 8500,
    "category": "style"
  },
  {
    "id": "extensions-install",
    "name": "Extensions (Install)",
    "defaultDurationMinutes": 180,
    "priceCents": 35000,
    "category": "extensions"
  },
  {
    "id": "extensions-maintenance",
    "name": "Extensions (Maintenance)",
    "defaultDurationMinutes": 90,
    "priceCents": 15000,
    "category": "extensions"
  }
];
