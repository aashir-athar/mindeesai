/**
 * currency — open.er-api.com free exchange rates. No key, ECB-sourced,
 * daily-refreshed. Supports 161 currencies.
 */

import type { ConnectorHandler } from "@/lib/connectors/types";

type Args = { amount: number; from: string; to: string };

const handler: ConnectorHandler<Args> = async (args, ctx) => {
  const amount = Number(args?.amount);
  const from = String(args?.from ?? "").toUpperCase();
  const to = String(args?.to ?? "").toUpperCase();
  if (!isFinite(amount)) return { ok: false, error: "amount must be a finite number" };
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
    return { ok: false, error: "from/to must be 3-letter ISO currency codes (e.g. USD, PKR, EUR)" };
  }
  try {
    const url = `https://open.er-api.com/v6/latest/${from}`;
    const res = await ctx.fetch(url, { signal: ctx.signal });
    if (!res.ok) return { ok: false, error: `er-api ${res.status}`, retryable: true };
    const data = (await res.json()) as { result?: string; rates?: Record<string, number>; time_last_update_utc?: string };
    if (data.result !== "success" || !data.rates) {
      return { ok: false, error: `er-api returned ${data.result ?? "unknown"}`, retryable: true };
    }
    const rate = data.rates[to];
    if (typeof rate !== "number") {
      return { ok: false, error: `unknown currency code "${to}"` };
    }
    const converted = amount * rate;
    return {
      ok: true,
      output: {
        amount,
        from,
        to,
        rate,
        converted: Number(converted.toFixed(4)),
        formatted: `${amount.toLocaleString()} ${from} ≈ ${converted.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${to}`,
        rate_updated_utc: data.time_last_update_utc,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), retryable: true };
  }
};

export default handler;
