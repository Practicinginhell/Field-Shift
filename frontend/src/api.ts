import type {
  AnalyzeResponse,
  CropHistory,
  CropNumbers,
  CropOption,
  LocateResult,
  ObservedField,
  Priorities,
  RotationYear,
} from "./types";

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

/** "&lang=fr" for French; nothing for English, so English URLs stay as they were. */
const langParam = (lang: string) => (lang === "fr" ? "lang=fr" : "");

export async function fetchCrops(lang = "en"): Promise<CropOption[]> {
  return getJson(await fetch(lang === "fr" ? `/api/crops?${langParam(lang)}` : "/api/crops"));
}

export async function analyze(request: {
  latitude: number;
  longitude: number;
  current_rotation: RotationYear[];
  irrigated: boolean;
  priorities: Priorities;
  excluded_crops: string[];
  own_numbers?: Record<string, CropNumbers>;
  own_cover_cost?: number | null;
  /** The language of every sentence in the answer. */
  language?: "en" | "fr";
}): Promise<AnalyzeResponse> {
  return getJson(
    await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }),
  );
}

export async function fetchCropHistory(latitude: number, longitude: number, lang = "en"): Promise<CropHistory> {
  const params = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude) });
  if (lang === "fr") params.set("lang", "fr");
  return getJson(await fetch(`/api/crop-history?${params}`));
}

/** The prepared satellite record of an example field, or `null` for any other field. */
export async function fetchObserved(latitude: number, longitude: number, lang = "en"): Promise<ObservedField | null> {
  const params = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude) });
  if (lang === "fr") params.set("lang", "fr");
  const response = await fetch(`/api/observed?${params}`);
  if (response.status === 404) return null;
  return getJson(response);
}

/** Resolve a town, postal code, or place name to field coordinates. */
export async function locatePlace(query: string): Promise<LocateResult> {
  const params = new URLSearchParams({ q: query });
  return getJson(await fetch(`/api/locate?${params}`));
}
