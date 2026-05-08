import { FeederAnomaly, IAnomalyApiClient } from "./IAnomalyApiClient";

export class AnomalyApiClient implements IAnomalyApiClient {
  private readonly baseUrl: string;
  private readonly useStaticData: boolean;

  constructor(baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "") {
    this.baseUrl = baseUrl;
    this.useStaticData = process.env.NEXT_PUBLIC_USE_STATIC_DATA === "true";
  }

  async getAnomalies(signal?: AbortSignal): Promise<FeederAnomaly[]> {
    const url = this.useStaticData
      ? "/data/feeders-anomalies.json"
      : `${this.baseUrl}/api/feeders/anomalies`;

    let response: Response;

    try {
      response = await fetch(url, {
        method: "GET",
        signal,
        headers: {
          Accept: "application/json"
        }
      });
    } catch (error) {
      throw new Error(
        this.useStaticData
          ? "Unable to load static anomaly data."
          : "Unable to reach anomalies API. Check if backend is running, CORS is enabled, and certificate is trusted.",
        { cause: error }
      );
    }

    if (!response.ok) {
      const body = await response.text();
      const details = body.slice(0, 200).trim();
      const suffix = details.length > 0 ? ` - ${details}` : "";
      throw new Error(`Failed to load anomalies: ${response.status} ${response.statusText}${suffix}`);
    }

    const raw = (await response.json()) as unknown[];

    return raw
      .map((item) => this.mapAnomaly(item))
      .filter((item): item is FeederAnomaly => item !== null);
  }

  private mapAnomaly(item: unknown): FeederAnomaly | null {
    if (typeof item !== "object" || item === null) {
      return null;
    }

    const data = item as Record<string, unknown>;

    const feeder11Id = this.toNumber(data.feeder11Id);
    if (feeder11Id === null) {
      return null;
    }

    const feeder11Name = this.toString(data.feeder11Name, `Feeder ${feeder11Id}`);
    const anomalyScorePercent = this.toNumber(data.anomalyScorePercent, 0) ?? 0;
    const classification = this.toClassification(data.classification);
    const centroidLatitude = this.toNumber(data.centroidLatitude);
    const centroidLongitude = this.toNumber(data.centroidLongitude);

    if (classification === null) {
      return null;
    }

    return {
      feeder11Id,
      feeder11Name,
      anomalyScorePercent,
      classification,
      centroidLatitude,
      centroidLongitude
    };
  }

  private toClassification(value: unknown): FeederAnomaly["classification"] | null {
    if (typeof value === "string") {
      if (
        value === "Normal" ||
        value === "TheftSuspected" ||
        value === "GhostOrDeadMeters"
      ) {
        return value;
      }
      return null;
    }

    if (typeof value === "number") {
      if (value === 0) return "Normal";
      if (value === 1) return "TheftSuspected";
      if (value === 2) return "GhostOrDeadMeters";
    }

    return null;
  }

  private toNumber(value: unknown, fallback: number | null = null): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return fallback;
  }

  private toString(value: unknown, fallback: string): string {
    return typeof value === "string" && value.trim().length > 0 ? value : fallback;
  }
}