// Which meets a family sees under "Upcoming" — kept out of data/meets.ts (and its `server-only`
// guard) on purpose, so it is a plain pure function the test suite can run as it ships.
import type { Meet } from "@/lib/types";

/**
 * The meets a family should see under "Upcoming", soonest first.
 *
 * Families used to get `status !== "completed"` and nothing else, which quietly hid meets from
 * them. The `meets.status` column DEFAULTS to 'completed', so a meet nobody has explicitly moved
 * off that default — and there is no screen in the app that sets a status on the way in — reads as
 * completed and was filtered straight out, even when its date is weeks away. That is why parents
 * reported an empty "Upcoming meets" while the meet was plainly on the calendar.
 *
 * So the date decides, not just the flag: a meet is upcoming when it has not happened yet
 * (today counts), OR when a coach has deliberately marked it as anything other than completed.
 * A meet a coach has marked completed AND whose day has passed is the only thing left out.
 * Unparseable dates fall back to the status flag alone rather than vanishing.
 */
export function upcomingMeets(meets: Meet[], now: Date = new Date()): Meet[] {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const notPast = (m: Meet): boolean => {
    const t = new Date(m.meet_date).getTime();
    return Number.isNaN(t) ? m.status !== "completed" : t >= startOfToday.getTime();
  };

  return meets
    .filter((m) => m.status !== "completed" || notPast(m))
    .slice()
    .sort((a, b) => (a.meet_date < b.meet_date ? -1 : a.meet_date > b.meet_date ? 1 : 0));
}
