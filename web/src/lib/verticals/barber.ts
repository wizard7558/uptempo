import { defineVertical } from "./types";

export const barber = defineVertical({
  "id": "barber",
  "label": "Barbershop",
  "description": "Walk-in friendly cuts, fades and shaves for barbers and shops.",
  "terms": {
    "staff": {
      "one": "Barber",
      "other": "Barbers"
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
      "one": "Shop",
      "other": "Shops"
    },
    "prepaidBalance": "Prepaid balance"
  },
  "modules": [
    "memberships",
    "walk_in_queue",
    "slot_waitlist",
    "gift_cards"
  ],
  "bookingFlow": "book",
  "categories": [
    {
      "slug": "cuts",
      "name": "Cuts"
    },
    {
      "slug": "beard",
      "name": "Beard"
    },
    {
      "slug": "shaves",
      "name": "Shaves"
    },
    {
      "slug": "kids",
      "name": "Kids"
    },
    {
      "slug": "addons",
      "name": "Add-ons"
    }
  ],
  "serviceTemplates": [
    {
      "name": "Haircut",
      "category": "cuts",
      "minutes": 30,
      "priceCents": 3500
    },
    {
      "name": "Skin fade",
      "category": "cuts",
      "minutes": 45,
      "priceCents": 4000
    },
    {
      "name": "Beard trim",
      "category": "beard",
      "minutes": 20,
      "priceCents": 2000
    },
    {
      "name": "Cut and beard",
      "category": "cuts",
      "minutes": 50,
      "priceCents": 5500
    },
    {
      "name": "Kids cut",
      "category": "kids",
      "minutes": 30,
      "priceCents": 2500
    },
    {
      "name": "Line-up",
      "category": "cuts",
      "minutes": 15,
      "priceCents": 1500
    },
    {
      "name": "Hot towel shave",
      "category": "shaves",
      "minutes": 30,
      "priceCents": 3500
    }
  ],
  "expenseCategories": [
    "Supplies",
    "Product",
    "Booth rent",
    "Equipment",
    "Laundry",
    "Marketing",
    "Other"
  ],
  "clientFields": [],
  "defaults": {
    "bufferAfterMinutes": 0,
    "minNoticeHours": 1,
    "maxAdvanceDays": 60,
    "slotIntervalMinutes": 15
  }
});
