import { barber } from "./barber";
import { general } from "./general";
import { hairSalon } from "./hair-salon";
import { homeServices } from "./home-services";
import { massageWellness } from "./massage-wellness";
import { nailSalon } from "./nail-salon";
import { personalTraining } from "./personal-training";
import { tattoo } from "./tattoo";
import type { Vertical, VerticalId } from "./types";

export * from "./types";

export const VERTICALS: Record<VerticalId, Vertical> = {
  hair_salon: hairSalon,
  barber,
  nail_salon: nailSalon,
  tattoo,
  massage_wellness: massageWellness,
  personal_training: personalTraining,
  home_services: homeServices,
  general,
};

/** Display order for pickers. */
const DISPLAY_ORDER: VerticalId[] = [
  "hair_salon",
  "barber",
  "nail_salon",
  "tattoo",
  "massage_wellness",
  "personal_training",
  "home_services",
  "general",
];

/** Returns the pack for an id; unknown or missing ids fall back to `general`. */
export function getVertical(id: string | null | undefined): Vertical {
  if (id && Object.prototype.hasOwnProperty.call(VERTICALS, id)) {
    return VERTICALS[id as VerticalId];
  }
  return VERTICALS.general;
}

export function listVerticals(): Vertical[] {
  return DISPLAY_ORDER.map((id) => VERTICALS[id]);
}
