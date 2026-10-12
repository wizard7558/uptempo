import { defineVertical } from "./types";

export const general = defineVertical({
  "id": "general",
  "label": "Other business",
  "description": "A neutral starting point for any appointment-based business.",
  "terms": {
    "staff": {
      "one": "Staff",
      "other": "Staff"
    },
    "customer": {
      "one": "Client",
      "other": "Clients"
    },
    "booking": {
      "one": "Booking",
      "other": "Bookings"
    },
    "offering": {
      "one": "Service",
      "other": "Services"
    },
    "place": {
      "one": "Location",
      "other": "Locations"
    },
    "prepaidBalance": "Prepaid balance"
  },
  "modules": [
    "slot_waitlist",
    "gift_cards"
  ],
  "bookingFlow": "book",
  "categories": [
    {
      "slug": "general",
      "name": "General"
    }
  ],
  "serviceTemplates": [
    {
      "name": "Consultation",
      "category": "general",
      "minutes": 30,
      "priceCents": 0
    },
    {
      "name": "Appointment",
      "category": "general",
      "minutes": 60,
      "priceCents": 0
    }
  ],
  "expenseCategories": [
    "Supplies",
    "Rent",
    "Equipment",
    "Software",
    "Marketing",
    "Other"
  ],
  "clientFields": [],
  "defaults": {
    "bufferAfterMinutes": 0,
    "minNoticeHours": 2,
    "maxAdvanceDays": 60,
    "slotIntervalMinutes": 15
  }
});
