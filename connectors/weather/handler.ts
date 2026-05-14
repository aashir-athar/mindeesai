/**
 * weather — wttr.in JSON endpoint. Free, no key.
 *
 * https://wttr.in/<location>?format=j1 returns a structured JSON with
 * current_condition + 3-day weather forecast. We summarise to keep the
 * payload small.
 */

import type { ConnectorHandler } from "@/lib/connectors/types";

type Args = { location: string };

interface WttrCurrent {
  temp_C?: string;
  temp_F?: string;
  FeelsLikeC?: string;
  humidity?: string;
  weatherDesc?: Array<{ value: string }>;
  windspeedKmph?: string;
  precipMM?: string;
}
interface WttrDay {
  date: string;
  avgtempC?: string;
  maxtempC?: string;
  mintempC?: string;
  hourly?: Array<{ weatherDesc?: Array<{ value: string }>; chanceofrain?: string }>;
}
interface WttrResponse {
  current_condition?: WttrCurrent[];
  weather?: WttrDay[];
  nearest_area?: Array<{ areaName?: Array<{ value: string }>; country?: Array<{ value: string }> }>;
}

const handler: ConnectorHandler<Args> = async (args, ctx) => {
  const { location } = args ?? ({} as Args);
  if (!location || location.length > 100) {
    return { ok: false, error: "location required (≤ 100 chars)" };
  }
  try {
    const url = `https://wttr.in/${encodeURIComponent(location)}?format=j1`;
    const res = await ctx.fetch(url, {
      headers: { "User-Agent": "MindeesAI/1.0 (https://mindeesai.vercel.app)" },
      signal: ctx.signal,
    });
    if (!res.ok) return { ok: false, error: `wttr.in ${res.status}`, retryable: true };
    const data = (await res.json()) as WttrResponse;
    const cur = data.current_condition?.[0];
    if (!cur) return { ok: false, error: `no current weather for "${location}"` };
    const place = [
      data.nearest_area?.[0]?.areaName?.[0]?.value,
      data.nearest_area?.[0]?.country?.[0]?.value,
    ].filter(Boolean).join(", ") || location;

    const forecast = (data.weather ?? []).slice(0, 3).map((d) => ({
      date: d.date,
      high_C: d.maxtempC,
      low_C: d.mintempC,
      summary: d.hourly?.[4]?.weatherDesc?.[0]?.value ?? "—",
      chance_of_rain: d.hourly?.[4]?.chanceofrain ?? "0",
    }));

    return {
      ok: true,
      output: {
        location: place,
        current: {
          condition: cur.weatherDesc?.[0]?.value ?? "—",
          temp_C: cur.temp_C,
          temp_F: cur.temp_F,
          feels_like_C: cur.FeelsLikeC,
          humidity_pct: cur.humidity,
          wind_kmph: cur.windspeedKmph,
        },
        forecast,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), retryable: true };
  }
};

export default handler;
