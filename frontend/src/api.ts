import type { AnalyzeResponse, CropHistory, CropOption, ObservedField, Priorities, RotationYear } from "./types";

async function getJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = `${response.status}`;
    try {
      const body = await response.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      // Body was not JSON; keep the status code.
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

export async function fetchCrops(): Promise<CropOption[]> {
  return getJson(await fetch("/api/crops"));
}

export async function analyze(request: {
  latitude: number;
  longitude: number;
  current_rotation: RotationYear[];
  irrigated: boolean;
  priorities: Priorities;
  excluded_crops: string[];
}): Promise<AnalyzeResponse> {
  return getJson(
    await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }),
  );
}

export async function fetchCropHistory(latitude: number, longitude: number): Promise<CropHistory> {
  const params = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude) });
  return getJson(await fetch(`/api/crop-history?${params}`));
}

/** The prepared satellite record of an example field, or `null` for any other field. */
export async function fetchObserved(latitude: number, longitude: number): Promise<ObservedField | null> {
  const params = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude) });
  const response = await fetch(`/api/observed?${params}`);
  if (response.status === 404) return null;
  return getJson(response);
}
