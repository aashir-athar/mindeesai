/**
 * Tiny structured logger. Outputs JSON lines in production for easy log-search,
 * pretty prefixed text in development.
 */

type Level = "debug" | "info" | "warn" | "error";

const isDev = process.env.NODE_ENV !== "production";

function emit(level: Level, scope: string, ...args: unknown[]) {
  if (isDev) {
    const tag = `[${new Date().toISOString().slice(11, 23)}] ${level.toUpperCase().padEnd(5)} ${scope}`;
    // eslint-disable-next-line no-console
    console[level === "debug" ? "log" : level](tag, ...args);
    return;
  }
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level,
      scope,
      msg: args.map((a) => (typeof a === "string" ? a : safeStringify(a))).join(" "),
    }),
  );
}

function safeStringify(x: unknown): string {
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}

export function createLogger(scope: string) {
  return {
    debug: (...a: unknown[]) => emit("debug", scope, ...a),
    info: (...a: unknown[]) => emit("info", scope, ...a),
    warn: (...a: unknown[]) => emit("warn", scope, ...a),
    error: (...a: unknown[]) => emit("error", scope, ...a),
  };
}

export const log = createLogger("app");
