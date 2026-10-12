/** Pure age helpers for the consent age gate. Dates are "YYYY-MM-DD" calendar days. */

function parts(day: string): [number, number, number] {
  const [y, m, d] = day.split("-").map(Number);
  return [y, m, d];
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Whole years old on `onDay`. A Feb 29 birthday counts as Mar 1 in years
 * that have no Feb 29.
 */
export function ageOn(dob: string, onDay: string): number {
  const [by, bm, bd] = parts(dob);
  const [oy, om, od] = parts(onDay);
  let month = bm;
  let day = bd;
  if (bm === 2 && bd === 29 && !isLeap(oy)) {
    month = 3;
    day = 1;
  }
  const hadBirthday = om > month || (om === month && od >= day);
  return oy - by - (hadBirthday ? 0 : 1);
}

/** The largest minimum age among the active consent templates, or null when none sets one. */
export function requiredMinAge(
  templates: { kind: string; minAge: number | null; isActive: number }[],
): number | null {
  let max: number | null = null;
  for (const t of templates) {
    if (t.kind !== "consent" || t.isActive !== 1 || t.minAge == null) continue;
    if (max === null || t.minAge > max) max = t.minAge;
  }
  return max;
}
