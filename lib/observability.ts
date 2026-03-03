
import crypto from "crypto";

export function requestId() {
  return crypto.randomBytes(8).toString("hex");
}

export function nowMs() {
  return Date.now();
}

export function logInfo(event: string, data: Record<string, any>) {
  console.log(JSON.stringify({ level: "info", event, ...data }));
}

export function logError(event: string, data: Record<string, any>) {
  console.error(JSON.stringify({ level: "error", event, ...data }));
}
