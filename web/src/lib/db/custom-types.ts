import { customType } from "drizzle-orm/pg-core";
import { parse as parseRange } from "postgres-range";

export interface TimeRange {
  start: Date;
  end: Date;
}

export const tstzrange = customType<{ data: TimeRange; driverData: string }>({
  dataType() {
    return "tstzrange";
  },
  fromDriver(value: string): TimeRange {
    const parsed = parseRange(value, (val) => new Date(val));
    if (parsed.lower === null || parsed.upper === null) {
      throw new Error("Unbounded ranges not supported for appointments");
    }
    return { start: parsed.lower, end: parsed.upper };
  },
  toDriver(value: TimeRange): string {
    return `[${value.start.toISOString()},${value.end.toISOString()})`;
  },
});
