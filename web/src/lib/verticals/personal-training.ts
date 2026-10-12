import { defineVertical } from "./types";

export const personalTraining = defineVertical({
  "id": "personal_training",
  "label": "Personal training",
  "description": "One-on-one and group training with packages, memberships and recurring sessions.",
  "terms": {
    "staff": {
      "one": "Trainer",
      "other": "Trainers"
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
      "one": "Session type",
      "other": "Session types"
    },
    "place": {
      "one": "Gym",
      "other": "Gyms"
    },
    "prepaidBalance": "Prepaid balance"
  },
  "modules": [
    "classes",
    "packages",
    "memberships",
    "recurring",
    "slot_waitlist"
  ],
  "bookingFlow": "book",
  "categories": [
    {
      "slug": "personal",
      "name": "Personal"
    },
    {
      "slug": "small_group",
      "name": "Small group"
    },
    {
      "slug": "classes",
      "name": "Classes"
    },
    {
      "slug": "assessments",
      "name": "Assessments"
    },
    {
      "slug": "virtual",
      "name": "Virtual"
    }
  ],
  "serviceTemplates": [
    {
      "name": "1:1 session, 60 min",
      "category": "personal",
      "minutes": 60,
      "priceCents": 8000
    },
    {
      "name": "1:1 session, 30 min",
      "category": "personal",
      "minutes": 30,
      "priceCents": 4500
    },
    {
      "name": "Partner session",
      "category": "small_group",
      "minutes": 60,
      "priceCents": 11000
    },
    {
      "name": "Assessment",
      "category": "assessments",
      "minutes": 45,
      "priceCents": 0
    },
    {
      "name": "Bootcamp",
      "category": "classes",
      "minutes": 45,
      "priceCents": 2000,
      "isClass": true,
      "capacity": 12
    },
    {
      "name": "Virtual session",
      "category": "virtual",
      "minutes": 45,
      "priceCents": 6000
    }
  ],
  "expenseCategories": [
    "Equipment",
    "Gym fees",
    "Certifications",
    "Software",
    "Marketing",
    "Travel",
    "Other"
  ],
  "clientFields": [
    {
      "key": "goals",
      "label": "Goals",
      "type": "text"
    },
    {
      "key": "injuries",
      "label": "Injuries",
      "type": "text"
    }
  ],
  "defaults": {
    "bufferAfterMinutes": 0,
    "minNoticeHours": 2,
    "maxAdvanceDays": 60,
    "slotIntervalMinutes": 15
  }
});
