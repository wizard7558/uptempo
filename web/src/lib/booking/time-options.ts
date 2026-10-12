/** 15-minute slots from 6:00 AM through 10:00 PM (same as booking panel). */
export const BOOKING_TIME_OPTIONS = (() => {
  const opts: { value: string; label: string }[] = [];
  for (let h = 6; h <= 22; h++) {
    for (let m = 0; m < 60; m += 15) {
      if (h === 22 && m > 0) break;
      const value = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
      const period = h >= 12 ? "PM" : "AM";
      const displayH = h % 12 || 12;
      const label = `${displayH}:${m.toString().padStart(2, "0")} ${period}`;
      opts.push({ value, label });
    }
  }
  return opts;
})();
