import { type IOutageApiClient, type OutageInfo, type OutageType } from "./IOutageApiClient";

export class OutageApiClient implements IOutageApiClient {
  private readonly baseUrl: string;
  private readonly useStaticData: boolean;

  constructor(baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5601") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.useStaticData = process.env.NEXT_PUBLIC_USE_STATIC_DATA === "true";
  }

  async getPastOutages(signal?: AbortSignal): Promise<OutageInfo[]> {
    if (this.useStaticData) {
      return this.getOutagesFromStatic("/data/outages-history.json", signal);
    }
    return this.getOutages(["/history", "/api/outages/history"], signal);
  }

  async getCurrentOutages(signal?: AbortSignal): Promise<OutageInfo[]> {
    if (this.useStaticData) {
      return this.getOutagesFromStatic("/data/outages-current.json", signal);
    }
    return this.getOutages(["/current", "/api/outages/current"], signal);
  }

  private async getOutagesFromStatic(path: string, signal?: AbortSignal): Promise<OutageInfo[]> {
    const response = await fetch(path, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Static outage data not found at ${path} (${response.status})`);
    }

    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) {
      return [];
    }

    return payload
      .map((item) => this.mapOutage(item))
      .filter((item): item is OutageInfo => item !== null);
  }

  private async getOutages(paths: string[], signal?: AbortSignal): Promise<OutageInfo[]> {
    let lastError: Error | null = null;

    for (const path of paths) {
      try {
        const response = await fetch(`${this.baseUrl}${path}`, {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
          signal,
          cache: "no-store",
        });

        if (response.status === 404) {
          continue;
        }

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Outage API request failed (${response.status}): ${errorText || "Unknown error"}`);
        }

        const payload = (await response.json()) as unknown;
        if (!Array.isArray(payload)) {
          return [];
        }

        return payload
          .map((item) => this.mapOutage(item))
          .filter((item): item is OutageInfo => item !== null);
      } catch (error) {
        if (signal?.aborted) {
          throw error;
        }

        if (error instanceof Error) {
          lastError = error;
        } else {
          lastError = new Error("Unknown outage API error");
        }
      }
    }

    throw lastError ?? new Error("Outage API request failed for all known endpoint paths.");
  }

  private mapOutage(item: unknown): OutageInfo | null {
    if (typeof item !== "object" || item === null) {
      return null;
    }

    const data = item as Record<string, unknown>;
    const meterId = this.toNumber(data.meterId);
    const outageType = this.toOutageType(data.outageType);

    if (meterId === null || outageType === null) {
      return null;
    }

    return {
      meterId,
      detectedAt: this.toDateString(data.detectedAt),
      description: this.toString(data.description, "No description"),
      dtId: this.toNumber(data.dtId),
      dtName: this.toNullableString(data.dtName),
      feeder11Id: this.toNumber(data.feeder11Id),
      feeder11Name: this.toNullableString(data.feeder11Name),
      substationId: this.toNumber(data.substationId),
      substationName: this.toNullableString(data.substationName),
      feeder33Id: this.toNumber(data.feeder33Id),
      feeder33Name: this.toNullableString(data.feeder33Name),
      transmissionStationId: this.toNumber(data.transmissionStationId),
      transmissionStationName: this.toNullableString(data.transmissionStationName),
      latitude: this.toNumber(data.latitude),
      longitude: this.toNumber(data.longitude),
      outageType,
    };
  }

  private toOutageType(value: unknown): OutageType | null {
    if (typeof value === "string") {
      if (
        value === "TelemetryGap" ||
        value === "ActiveTelemetryOutage" ||
        value === "ZeroVoltage" ||
        value === "NoTelemetry"
      ) {
        return value;
      }
      return null;
    }

    if (typeof value === "number") {
      if (value === 0) return "TelemetryGap";
      if (value === 1) return "ActiveTelemetryOutage";
      if (value === 2) return "ZeroVoltage";
      if (value === 3) return "NoTelemetry";
    }

    return null;
  }

  private toNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return null;
  }

  private toString(value: unknown, fallback: string): string {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }

    return fallback;
  }

  private toNullableString(value: unknown): string | null {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }

    return null;
  }

  private toDateString(value: unknown): string | null {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }

    return null;
  }
}