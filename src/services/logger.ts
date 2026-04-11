import { invoke } from "@tauri-apps/api/core";

type LogLevel = "error" | "warn" | "info" | "debug";

const isDev = import.meta.env.DEV;

/** Redact bearer tokens and other secrets from log output. */
function redactSecrets(text: string): string {
  return text
    .replace(/Bearer\s+\S+/g, "Bearer [REDACTED]")
    .replace(/access_token["\s:=]+\S+/g, "access_token=[REDACTED]")
    .replace(/refresh_token["\s:=]+\S+/g, "refresh_token=[REDACTED]");
}

function formatError(err: unknown): string {
  let text: string;
  if (err instanceof Error) {
    text = err.stack || err.message;
  } else if (typeof err === "string") {
    text = err;
  } else {
    try {
      text = JSON.stringify(err);
    } catch {
      text = String(err);
    }
  }
  return redactSecrets(text);
}

function writeToFile(level: LogLevel, message: string) {
  invoke("write_log", { level, message }).catch(() => {
    if (!isDev) console.error(`[${level}] ${message}`);
  });
}

function log(level: LogLevel, message: string, err?: unknown) {
  const full = err ? `${redactSecrets(message)}: ${formatError(err)}` : redactSecrets(message);

  // Always write to log file
  writeToFile(level, full);

  // In dev, also write to console for convenience
  if (isDev) {
    if (level === "error") console.error(full);
    else if (level === "warn") console.warn(full);
    else if (level === "info") console.info(full);
    else console.debug(full);
  }
}

export const logger = {
  error: (message: string, err?: unknown) => log("error", message, err),
  warn: (message: string, err?: unknown) => log("warn", message, err),
  info: (message: string, err?: unknown) => log("info", message, err),
  debug: (message: string, err?: unknown) => log("debug", message, err),

  /** Returns the path to the log file on disk. */
  getLogPath: () => invoke<string>("get_log_path_cmd"),
};
