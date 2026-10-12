const COLORS = [
  "#666fc4", // indigo (4.53:1)
  "#218560", // emerald (4.58:1)
  "#a46a07", // amber (4.52:1)
  "#bc5656", // red (4.56:1)
  "#7d68bc", // violet (4.59:1)
  "#158191", // cyan (4.58:1)
  "#ab6329", // orange (4.62:1)
  "#2c854d", // green (4.60:1)
  "#a757b3", // fuchsia (4.51:1)
  "#257da4", // sky (4.62:1)
];

/**
 * Deterministic color mapping from service ID to a fixed palette color.
 */
export function getServiceColor(serviceId: string): string {
  const hash = serviceId
    .split("")
    .reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return COLORS[hash % COLORS.length];
}

/**
 * Returns a lighter version of the service color for hover states.
 */
export function getServiceColorLight(serviceId: string): string {
  const color = getServiceColor(serviceId);
  // Return with 20% opacity for background
  return color + "33";
}
