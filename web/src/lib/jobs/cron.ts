function fieldMatches(field: string, value: number): boolean {
  return field.split(",").some((part) => {
    if (part === "*") return true;
    const step = /^[*]\/(\d+)$/.exec(part);
    if (step) {
      const n = Number(step[1]);
      return n > 0 && value % n === 0;
    }
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) {
      return value >= Number(range[1]) && value <= Number(range[2]);
    }
    if (/^\d+$/.test(part)) return value === Number(part);
    return false;
  });
}

/** True when `date` (read in UTC) falls on a 5-field cron expression. */
export function matchesCron(expr: string, date: Date): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  return (
    fieldMatches(minute, date.getUTCMinutes()) &&
    fieldMatches(hour, date.getUTCHours()) &&
    fieldMatches(dayOfMonth, date.getUTCDate()) &&
    fieldMatches(month, date.getUTCMonth() + 1) &&
    fieldMatches(dayOfWeek, date.getUTCDay())
  );
}
