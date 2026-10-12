import { defineVertical } from "./types";

export const homeServices = defineVertical({
  "id": "home_services",
  "label": "Home services",
  "description": "On-site jobs such as cleaning and repairs, booked by request with estimates.",
  "terms": {
    "staff": {
      "one": "Technician",
      "other": "Technicians"
    },
    "customer": {
      "one": "Customer",
      "other": "Customers"
    },
    "booking": {
      "one": "Job",
      "other": "Jobs"
    },
    "offering": {
      "one": "Service",
      "other": "Services"
    },
    "place": {
      "one": "Service area",
      "other": "Service areas"
    },
    "prepaidBalance": "Prepaid balance"
  },
  "modules": [
    "booking_groups",
    "requests",
    "on_site",
    "recurring",
    "attachments"
  ],
  "bookingFlow": "request",
  "categories": [
    {
      "slug": "cleaning",
      "name": "Cleaning"
    },
    {
      "slug": "repairs",
      "name": "Repairs"
    },
    {
      "slug": "outdoor",
      "name": "Outdoor"
    },
    {
      "slug": "estimates",
      "name": "Estimates"
    }
  ],
  "serviceTemplates": [
    {
      "name": "Standard clean",
      "category": "cleaning",
      "minutes": 120,
      "priceCents": 14000
    },
    {
      "name": "Deep clean",
      "category": "cleaning",
      "minutes": 240,
      "priceCents": 28000
    },
    {
      "name": "Move-out clean",
      "category": "cleaning",
      "minutes": 300,
      "priceCents": 35000
    },
    {
      "name": "Handyman, per hour",
      "category": "repairs",
      "minutes": 60,
      "priceCents": 8500
    },
    {
      "name": "Gutter cleaning",
      "category": "outdoor",
      "minutes": 120,
      "priceCents": 18000
    },
    {
      "name": "Estimate visit",
      "category": "estimates",
      "minutes": 30,
      "priceCents": 0
    }
  ],
  "expenseCategories": [
    "Supplies",
    "Fuel",
    "Vehicle",
    "Tools and equipment",
    "Insurance",
    "Subcontractors",
    "Other"
  ],
  "requestFields": [
    "address",
    "description",
    "photos",
    "preferred_days"
  ],
  "clientFields": [
    {
      "key": "property_type",
      "label": "Property type",
      "type": "select",
      "options": [
        "House",
        "Apartment",
        "Office",
        "Other"
      ]
    },
    {
      "key": "access_notes",
      "label": "Access notes",
      "type": "text"
    },
    {
      "key": "pets",
      "label": "Pets",
      "type": "text"
    }
  ],
  "defaults": {
    "bufferAfterMinutes": 0,
    "minNoticeHours": 24,
    "maxAdvanceDays": 60,
    "slotIntervalMinutes": 30
  }
});
