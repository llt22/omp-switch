export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function toPositiveNumber(value: unknown, fallback: number | null): number | null {
  const parsed = toNumber(value);
  return parsed !== undefined && parsed > 0 ? parsed : fallback;
}

export function toPositiveNumberOrNull(value: unknown): number | null {
  const parsed = toNumber(value);
  return parsed !== undefined && parsed > 0 ? parsed : null;
}

export function toBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

const AUTHOR_PREFIX = /^[A-Za-z][A-Za-z0-9 .+&'-]{0,23}: /;
const NOISE_TAGS = /\s*\((?:latest|Antigravity|\$+|>?\d+% off|retires [^)]*)\)/g;

export function cleanModelName(name: string): string {
  const cleaned = name.replace(AUTHOR_PREFIX, "").replace(NOISE_TAGS, "").replace(/ {2,}/g, " ").trim();
  return cleaned.length > 0 ? cleaned : name;
}

export function toModelName(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export function toInputCapabilities(value: unknown): ("text" | "image")[] {
  if (!Array.isArray(value)) return ["text"];
  const supportsImage = value.some(item => item === "image");
  return supportsImage ? ["text", "image"] : ["text"];
}
