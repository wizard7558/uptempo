import { defineVertical } from "./types";

export const massageWellness = defineVertical({
  "id": "massage_wellness",
  "label": "Massage and wellness",
  "description": "Massage, facials and spa treatments with rooms, packages and memberships.",
  "terms": {
    "staff": {
      "one": "Therapist",
      "other": "Therapists"
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
      "one": "Treatment",
      "other": "Treatments"
    },
    "place": {
      "one": "Studio",
      "other": "Studios"
    },
    "prepaidBalance": "Prepaid balance"
  },
  "modules": [
    "resources",
    "booking_groups",
    "packages",
    "memberships",
    "slot_waitlist",
    "gift_cards",
    "aftercare"
  ],
  "bookingFlow": "book",
  "categories": [
    {
      "slug": "massage",
      "name": "Massage"
    },
    {
      "slug": "facials",
      "name": "Facials"
    },
    {
      "slug": "couples",
      "name": "Couples"
    },
    {
      "slug": "addons",
      "name": "Add-ons"
    }
  ],
  "serviceTemplates": [
    {
      "name": "Swedish massage, 60 min",
      "category": "massage",
      "minutes": 60,
      "priceCents": 9000
    },
    {
      "name": "Swedish massage, 90 min",
      "category": "massage",
      "minutes": 90,
      "priceCents": 12500
    },
    {
      "name": "Deep tissue, 60 min",
      "category": "massage",
      "minutes": 60,
      "priceCents": 10000
    },
    {
      "name": "Deep tissue, 90 min",
      "category": "massage",
      "minutes": 90,
      "priceCents": 14000
    },
    {
      "name": "Hot stone, 90 min",
      "category": "massage",
      "minutes": 90,
      "priceCents": 14000
    },
    {
      "name": "Prenatal massage",
      "category": "massage",
      "minutes": 60,
      "priceCents": 9500
    },
    {
      "name": "Couples massage",
      "category": "couples",
      "minutes": 60,
      "priceCents": 19000
    },
    {
      "name": "Facial",
      "category": "facials",
      "minutes": 60,
      "priceCents": 9500
    },
    {
      "name": "Aromatherapy",
      "category": "addons",
      "minutes": 10,
      "priceCents": 1500,
      "isAddon": true
    }
  ],
  "expenseCategories": [
    "Oils and lotions",
    "Linens and laundry",
    "Disposables",
    "Room rent",
    "Equipment",
    "Other"
  ],
  "clientFields": [
    {
      "key": "pressure",
      "label": "Pressure",
      "type": "select",
      "options": [
        "Light",
        "Medium",
        "Firm"
      ]
    },
    {
      "key": "therapist_preference",
      "label": "Therapist preference",
      "type": "select",
      "options": [
        "No preference",
        "Female",
        "Male"
      ]
    }
  ],
  "defaults": {
    "bufferAfterMinutes": 15,
    "minNoticeHours": 2,
    "maxAdvanceDays": 90,
    "slotIntervalMinutes": 15
  }
});
