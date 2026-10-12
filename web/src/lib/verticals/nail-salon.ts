import { defineVertical } from "./types";

export const nailSalon = defineVertical({
  "id": "nail_salon",
  "label": "Nail salon",
  "description": "Manicures, pedicures and enhancements with chairs and stations as resources.",
  "terms": {
    "staff": {
      "one": "Nail tech",
      "other": "Nail techs"
    },
    "customer": {
      "one": "Client",
      "other": "Clients"
    },
    "booking": {
      "one": "Appointment",
      "other": "Appointments"
    },
    "offering": {
      "one": "Service",
      "other": "Services"
    },
    "place": {
      "one": "Salon",
      "other": "Salons"
    },
    "prepaidBalance": "Prepaid balance"
  },
  "modules": [
    "resources",
    "booking_groups",
    "walk_in_queue",
    "slot_waitlist",
    "gift_cards",
    "attachments"
  ],
  "bookingFlow": "book",
  "categories": [
    {
      "slug": "manicures",
      "name": "Manicures"
    },
    {
      "slug": "pedicures",
      "name": "Pedicures"
    },
    {
      "slug": "enhancements",
      "name": "Enhancements"
    },
    {
      "slug": "addons",
      "name": "Add-ons"
    }
  ],
  "serviceTemplates": [
    {
      "name": "Gel manicure",
      "category": "manicures",
      "minutes": 45,
      "priceCents": 4000
    },
    {
      "name": "Classic manicure",
      "category": "manicures",
      "minutes": 30,
      "priceCents": 2500
    },
    {
      "name": "Gel pedicure",
      "category": "pedicures",
      "minutes": 60,
      "priceCents": 5000
    },
    {
      "name": "Classic pedicure",
      "category": "pedicures",
      "minutes": 45,
      "priceCents": 3500
    },
    {
      "name": "Acrylic full set",
      "category": "enhancements",
      "minutes": 75,
      "priceCents": 6000
    },
    {
      "name": "Acrylic fill",
      "category": "enhancements",
      "minutes": 60,
      "priceCents": 4500
    },
    {
      "name": "Gel removal",
      "category": "addons",
      "minutes": 15,
      "priceCents": 1000,
      "isAddon": true
    },
    {
      "name": "Nail art (per nail)",
      "category": "addons",
      "minutes": 10,
      "priceCents": 500,
      "isAddon": true
    },
    {
      "name": "Chrome finish",
      "category": "addons",
      "minutes": 10,
      "priceCents": 1000,
      "isAddon": true
    }
  ],
  "expenseCategories": [
    "Polish and gel",
    "Acrylic and tips",
    "Tools and files",
    "Disposables",
    "Booth rent",
    "Equipment",
    "Other"
  ],
  "clientFields": [
    {
      "key": "nail_shape",
      "label": "Nail shape",
      "type": "select",
      "options": [
        "Square",
        "Round",
        "Oval",
        "Almond",
        "Coffin",
        "Stiletto"
      ]
    }
  ],
  "defaults": {
    "bufferAfterMinutes": 10,
    "minNoticeHours": 1,
    "maxAdvanceDays": 60,
    "slotIntervalMinutes": 15
  }
});
