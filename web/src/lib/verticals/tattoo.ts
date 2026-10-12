import { defineVertical } from "./types";

export const tattoo = defineVertical({
  "id": "tattoo",
  "label": "Tattoo studio",
  "description": "Consultation-first booking with deposits, consent and ID checks for tattoo artists.",
  "terms": {
    "staff": {
      "one": "Artist",
      "other": "Artists"
    },
    "customer": {
      "one": "Client",
      "other": "Clients"
    },
    "booking": {
      "one": "Session",
      "other": "Sessions"
    },
    "offering": {
      "one": "Piece",
      "other": "Pieces"
    },
    "place": {
      "one": "Studio",
      "other": "Studios"
    },
    "prepaidBalance": "Prepaid balance"
  },
  "modules": [
    "requests",
    "projects",
    "consent_id",
    "slot_waitlist",
    "gift_cards",
    "attachments",
    "aftercare"
  ],
  "bookingFlow": "request",
  "categories": [
    {
      "slug": "consultation",
      "name": "Consultation"
    },
    {
      "slug": "custom",
      "name": "Custom"
    },
    {
      "slug": "flash",
      "name": "Flash"
    },
    {
      "slug": "cover_up",
      "name": "Cover-up"
    },
    {
      "slug": "touch_up",
      "name": "Touch-up"
    }
  ],
  "serviceTemplates": [
    {
      "name": "Consultation",
      "category": "consultation",
      "minutes": 30,
      "priceCents": 0
    },
    {
      "name": "Small piece",
      "category": "custom",
      "minutes": 120,
      "priceCents": 15000,
      "deposit": {
        "type": "fixed",
        "amount": 5000
      }
    },
    {
      "name": "Half-day session",
      "category": "custom",
      "minutes": 240,
      "priceCents": 60000,
      "deposit": {
        "type": "fixed",
        "amount": 10000
      }
    },
    {
      "name": "Full-day session",
      "category": "custom",
      "minutes": 480,
      "priceCents": 110000,
      "deposit": {
        "type": "fixed",
        "amount": 20000
      }
    },
    {
      "name": "Flash",
      "category": "flash",
      "minutes": 60,
      "priceCents": 15000,
      "deposit": {
        "type": "fixed",
        "amount": 5000
      }
    },
    {
      "name": "Touch-up",
      "category": "touch_up",
      "minutes": 60,
      "priceCents": 0
    }
  ],
  "expenseCategories": [
    "Ink",
    "Needles and cartridges",
    "Disposables",
    "Booth rent",
    "Equipment",
    "Licensing",
    "Other"
  ],
  "requestFields": [
    "placement",
    "size",
    "style",
    "budget",
    "references"
  ],
  "clientFields": [
    {
      "key": "allergies",
      "label": "Allergies",
      "type": "text"
    }
  ],
  "defaults": {
    "bufferAfterMinutes": 15,
    "minNoticeHours": 48,
    "maxAdvanceDays": 180,
    "slotIntervalMinutes": 30
  }
});
