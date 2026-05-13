/**
 * Time-of-day awareness.
 *
 * Not a tensor — just a context shim that surfaces the current
 * date/time into the system prompt so Mindees can reference it
 * naturally ("it's late where you are", "good morning if you're
 * just starting your day").
 *
 * Tries to detect the user's local time via Accept-Language headers
 * elsewhere; for now uses UTC plus a generic "what kind of moment"
 * label that the model can use without claiming false knowledge of
 * the user's timezone.
 */

export interface TimeContext {
  iso: string;
  utc_hour: number;
  utc_day: string;
  moment: "early-morning" | "morning" | "midday" | "afternoon" | "evening" | "night" | "late-night";
}

export function readTime(now = new Date()): TimeContext {
  const hour = now.getUTCHours();
  let moment: TimeContext["moment"];
  if (hour < 5) moment = "late-night";
  else if (hour < 9) moment = "early-morning";
  else if (hour < 12) moment = "morning";
  else if (hour < 14) moment = "midday";
  else if (hour < 18) moment = "afternoon";
  else if (hour < 22) moment = "evening";
  else moment = "night";

  return {
    iso: now.toISOString(),
    utc_hour: hour,
    utc_day: now.toUTCString().split(" ").slice(0, 4).join(" "),
    moment,
  };
}

export function timeNarrative(t: TimeContext): string {
  return `Wall-clock context: it is ${t.utc_day} (${t.utc_hour}:00 UTC, ${t.moment.replace("-", " ")}). Use this only if it's actually relevant ("late where you are" works; "good morning" works only if you can be reasonably sure they ARE having morning). Don't fake intimacy with the clock.`;
}
