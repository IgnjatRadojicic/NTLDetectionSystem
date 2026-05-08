import {
  type GetSummaryParams,
  type ISummaryApiClient,
  type NtlSummaryResponse,
} from "./ISummaryApiClient";

export class SummaryApiClient implements ISummaryApiClient {
  private readonly baseUrl: string;
  private readonly useStaticData: boolean;

  constructor(baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5601") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.useStaticData = process.env.NEXT_PUBLIC_USE_STATIC_DATA === "true";
  }

  async getSummary(params?: GetSummaryParams): Promise<NtlSummaryResponse> {
    const url = this.useStaticData
      ? "/data/summary.json"
      : this.buildLiveUrl(params);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: params?.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Summary API request failed (${response.status}): ${errorText || "Unknown error"}`);
    }

    return (await response.json()) as NtlSummaryResponse;
  }

  private buildLiveUrl(params?: GetSummaryParams): string {
    const query = new URLSearchParams();

    if (params?.from) {
      query.set("from", params.from);
    }

    if (params?.to) {
      query.set("to", params.to);
    }

    const querySuffix = query.toString() ? `?${query.toString()}` : "";
    return `${this.baseUrl}/api/Summary${querySuffix}`;
  }
}