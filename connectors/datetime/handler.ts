/**
 * datetime — zero-network current-time-in-timezone helper.
 *
 * Built on Intl.DateTimeFormat, available in the Node runtime everywhere
 * Next.js runs. Validates the timezone string by attempting a format and
 * catching RangeError (Node throws "Invalid time zone specified").
 */

import type { ConnectorHandler } from "@/lib/connectors/types";

type Args = { timezone?: string; format?: "iso" | "long" | "short" };

const handler: ConnectorHandler<Args> = async (args) => {
  const tz = (args?.timezone ?? "UTC").trim();
  const format = args?.format ?? "long";
  const now = new Date();
  try {
    // Probe: throws RangeError on invalid tz
    const test = new Intl.DateTimeFormat("en-US", { timeZone: tz, dateStyle: "short" });
    test.format(now);
  } catch {
    return {
      ok: false,
      error: `unknown timezone "${tz}". Try an IANA identifier like 'Asia/Karachi' or 'America/New_York'.`,
    };
  }

  const longFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, dateStyle: "full", timeStyle: "long",
  });
  const shortFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, dateStyle: "short", timeStyle: "short",
  });
  const isoFmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });

  const display =
    format === "iso" ? isoFmt.format(now).replace(" ", "T") :
    format === "short" ? shortFmt.format(now) :
    longFmt.format(now);

  // UTC offset of this timezone right now
  const tzOffset = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" })
    .formatToParts(now)
    .find((p) => p.type === "timeZoneName")?.value ?? "GMT";

  return {
    ok: true,
    output: {
      timezone: tz,
      display,
      iso_utc: now.toISOString(),
      epoch_ms: now.getTime(),
      utc_offset: tzOffset,
      day_of_week: new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(now),
    },
  };
};

export default handler;
