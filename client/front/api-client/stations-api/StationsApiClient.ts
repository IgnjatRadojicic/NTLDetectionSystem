import {
  type DistributionSubstationRecord,
  type GetDistributionSubstationsParams,
  type IStationsApiClient,
  type SubstationRecord,
  type TransmissionStationRecord,
} from "./IStationsApiClient";

export class StationsApiClient implements IStationsApiClient {
  private readonly baseUrl: string;
  private readonly useStaticData: boolean;

  constructor(baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5601") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.useStaticData = process.env.NEXT_PUBLIC_USE_STATIC_DATA === "true";
  }

  async getTransmissionStations(signal?: AbortSignal): Promise<TransmissionStationRecord[]> {
    const url = this.useStaticData
      ? "/data/transmission-stations.json"
      : `${this.baseUrl}/api/registry/transmission-stations`;
    return this.getJson<TransmissionStationRecord[]>(url, signal);
  }

  async getSubstations(signal?: AbortSignal): Promise<SubstationRecord[]> {
    const url = this.useStaticData
      ? "/data/substations.json"
      : `${this.baseUrl}/api/registry/substations`;
    return this.getJson<SubstationRecord[]>(url, signal);
  }

  async getDistributionSubstations(
    params?: GetDistributionSubstationsParams,
  ): Promise<DistributionSubstationRecord[]> {
    if (this.useStaticData) {
      // Static file is pre-filtered to flagged feeders only. Ignore feederIds param.
      return this.getJson<DistributionSubstationRecord[]>(
        "/data/distribution-substations.json",
        params?.signal,
      );
    }

    const query = new URLSearchParams();

    if (params?.feederIds && params.feederIds.length > 0) {
      query.set("feederIds", params.feederIds.join(","));
    }

    const querySuffix = query.toString() ? `?${query.toString()}` : "";

    return this.getJson<DistributionSubstationRecord[]>(
      `${this.baseUrl}/api/registry/distribution-substations${querySuffix}`,
      params?.signal,
    );
  }

  private async getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal,
      cache: "no-store",
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Registry API request failed (${response.status}): ${errorText || "Unknown error"}`);
    }

    return (await response.json()) as T;
  }
}