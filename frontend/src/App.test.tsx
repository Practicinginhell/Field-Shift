import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { setLang } from "./i18n";
import App from "./App";
import { ALTERNATIVE, BASELINE, CROPS, RESPONSE } from "./testData";

// jsdom has no WebGL, so the map itself is not rendered in tests.
// The stand-in "map" is a button that picks the Ottawa-area point, like a click would.
vi.mock("./MapView", () => ({
  default: ({ onPick }: { onPick: (latitude: number, longitude: number) => void }) => (
    <button type="button" onClick={() => onPick(45.22, -75.8)}>
      map
    </button>
  ),
}));
vi.mock("./SeasonView", () => ({
  default: ({ highlightedStrategyId }: { highlightedStrategyId?: string | null }) => (
    <div data-testid="season-view" data-highlighted={highlightedStrategyId ?? ""}>
      season view
    </div>
  ),
}));
vi.mock("./SatelliteReplay", () => ({ default: () => <div>satellite replay</div> }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  setLang("en");
});

const OTTAWA_HISTORY = {
  source: "AAFC Annual Crop Inventory (Agriculture and Agri-Food Canada)",
  years: [
    { year: 2023, cdl_category: "Corn for grain", crop: "corn" },
    { year: 2024, cdl_category: "Soybeans", crop: "soybean" },
    { year: 2025, cdl_category: "Wheat", crop: null },
  ],
};

function stubApi(analyze: () => Promise<Response>, history: unknown = OTTAWA_HISTORY, observed: unknown = null) {
  const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
    if (url === "/api/crops" || url === "/api/crops?lang=fr") return Promise.resolve(new Response(JSON.stringify(CROPS)));
    if (url === "/api/analyze") return analyze();
    if (url.startsWith("/api/crop-history")) return Promise.resolve(new Response(JSON.stringify(history)));
    if (url.startsWith("/api/observed")) {
      return Promise.resolve(
        observed ? new Response(JSON.stringify(observed)) : new Response('{"detail": "example fields only"}', { status: 404 }),
      );
    }
    return Promise.reject(new Error(`unexpected ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

test("compares rotations and shows the baseline first with its evidence", async () => {
  const fetchMock = stubApi(() => Promise.resolve(new Response(JSON.stringify(RESPONSE))));
  render(<App />);

  fireEvent.click(await screen.findByRole("button", { name: "Compare rotations" }));

  expect(await screen.findAllByText("Your current rotation")).toBeTruthy();
  expect(screen.getAllByText("Option to explore")).toHaveLength(2);
  expect(screen.getAllByText("Corn + rye cover – Soybean + rye cover").length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText(/Sorghum needs about 110 frost-free days/)).toBeTruthy();
  expect(screen.getByText("860 mm")).toBeTruthy();
  // The plain view shows rain, frost-free season and soil; evaporation demand stays in the text and chart.
  expect(screen.queryByText("Evaporation demand")).toBeNull();
  expect(screen.getByText("Frost-free season").closest(".kpi")?.textContent).toContain("176 days");
  expect(screen.getByText(/Dundas/)).toBeTruthy();
  const activePreset = screen.getByRole("button", { name: "Iowa, corn and soybean" });
  expect(activePreset.getAttribute("aria-pressed")).toBe("true");
  const [, init] = fetchMock.mock.calls.find(([url]) => url === "/api/analyze")!;
  const body = JSON.parse((init as RequestInit).body as string);
  expect(body.current_rotation).toEqual([
    { crop: "corn", cover: false },
    { crop: "soybean", cover: false },
  ]);
});

test("explains a failed analysis instead of showing stale results", async () => {
  stubApi(() =>
    Promise.resolve(new Response(JSON.stringify({ detail: "NASA POWER could not be reached" }), { status: 502 })),
  );
  render(<App />);

  fireEvent.click(await screen.findByRole("button", { name: "Compare rotations" }));

  expect((await screen.findByRole("alert")).textContent).toContain("NASA POWER could not be reached");
  expect(screen.queryByText("Your current rotation")).toBeNull();
});

test("tells the user when the server is not running", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
  render(<App />);

  expect((await screen.findByRole("alert")).textContent).toContain("./scripts/dev");
});

test("clicking the map moves the field and fills its rotation from past crop maps", async () => {
  const fetchMock = stubApi(() => Promise.reject(new Error("not called")));
  render(<App />);
  await screen.findByRole("button", { name: "Compare rotations" });

  fireEvent.click(screen.getByRole("button", { name: "map" }));

  expect(screen.getByText(/45\.22° N, 75\.80° W/)).toBeTruthy();
  expect(await screen.findByText(/Filled from AAFC Annual Crop Inventory/)).toBeTruthy();
  expect((screen.getByLabelText("Year 1 crop") as HTMLSelectElement).value).toBe("corn");
  expect((screen.getByLabelText("Year 2 crop") as HTMLSelectElement).value).toBe("soybean");
  expect(fetchMock).toHaveBeenCalledWith("/api/crop-history?latitude=45.22&longitude=-75.8");
});

test("keeps a year the crop map could not name as a blank for the farmer to fill", async () => {
  // 2024 unknown: dropping it would make corn (2023) and corn (2025) look back to back.
  stubApi(() => Promise.reject(new Error("not called")), {
    source: "AAFC Annual Crop Inventory",
    years: [
      { year: 2023, cdl_category: "Corn for grain", crop: "corn" },
      { year: 2024, cdl_category: "Wheat", crop: null },
      { year: 2025, cdl_category: "Corn for grain", crop: "corn" },
    ],
  });
  render(<App />);
  await screen.findByRole("button", { name: "Compare rotations" });

  fireEvent.click(screen.getByRole("button", { name: "map" }));

  expect(await screen.findByText(/What did you grow in 2024\?/)).toBeTruthy();
  expect((screen.getByLabelText("Year 2 crop") as HTMLSelectElement).value).toBe("");
  expect((screen.getByLabelText("Year 3 crop") as HTMLSelectElement).value).toBe("corn");
  const compare = screen.getByRole("button", { name: "Compare rotations" }) as HTMLButtonElement;
  expect(compare.disabled).toBe(true);

  fireEvent.change(screen.getByLabelText("Year 2 crop"), { target: { value: "soybean" } });

  expect(compare.disabled).toBe(false);
});

test("drops a comparison that comes back after the farmer moved to another field", async () => {
  let answer: (r: Response) => void = () => {};
  const fetchMock = stubApi(() => new Promise<Response>((resolve) => (answer = resolve)));
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Compare rotations" }));

  fireEvent.click(screen.getAllByRole("button", { name: /Nevada example/ })[0]);
  answer(new Response(JSON.stringify(RESPONSE)));
  await new Promise((r) => setTimeout(r, 0));

  expect(screen.queryByText("Your current rotation")).toBeNull();
  expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("/api/observed"))).toBe(false);
});

test("says so when no crop map covers the clicked point, and keeps the rotation", async () => {
  stubApi(() => Promise.reject(new Error("not called")), { source: "x", years: [{ year: 2024, cdl_category: null, crop: null }] });
  render(<App />);
  await screen.findByRole("button", { name: "Compare rotations" });

  fireEvent.click(screen.getByRole("button", { name: "map" }));

  expect(await screen.findByText(/town centers and yards aren't mapped/)).toBeTruthy();
  expect((screen.getByLabelText("Year 1 crop") as HTMLSelectElement).value).toBe("corn");
});

test("sends the crops the farmer can't grow or sell with the analysis", async () => {
  const fetchMock = stubApi(() => Promise.resolve(new Response(JSON.stringify(RESPONSE))));
  render(<App />);
  await screen.findByRole("button", { name: "Compare rotations" });

  fireEvent.click(screen.getByLabelText("Canola"));
  fireEvent.click(screen.getByRole("button", { name: "Compare rotations" }));
  await screen.findAllByText("Your current rotation");

  const call = fetchMock.mock.calls.find(([url]) => url === "/api/analyze");
  expect(JSON.parse(String(call?.[1]?.body)).excluded_crops).toEqual(["canola"]);
});

test("updates the margins as the farmer types, and sends their numbers next time", async () => {
  const withEconomics = {
    ...RESPONSE,
    economics: {
      region: "Iowa",
      currency: "USD",
      basis: "Costs are the budget's variable costs.",
      cover_crop_cost: 41.55,
      crops: [
        { crop: "corn", name: "Corn (grain)", unit: "bu", yield_per_acre: 211, price: 4.6, cost_per_acre: 483.6, own: false },
        { crop: "soybean", name: "Soybean", unit: "bu", yield_per_acre: 61, price: 12.1, cost_per_acre: 290.21, own: false },
      ],
      sources: ["Iowa State University budget"],
    },
  };
  const fetchMock = stubApi(() => Promise.resolve(new Response(JSON.stringify(withEconomics))));
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Compare rotations" }));
  await screen.findAllByText("Your current rotation");
  expect(screen.getAllByText(/Gross margin about \$467 an acre a year/).length).toBeGreaterThan(0);

  fireEvent.click(screen.getByRole("button", { name: "Enter your yields and prices" }));
  fireEvent.change(screen.getByLabelText("Corn (grain) price, $ per bu"), { target: { value: "5.6" } });

  // corn 211 bu x $5.60 - $483.60 = $698.00; soybean $447.89: mean $572.95, no reload
  expect(screen.getAllByText(/Gross margin about \$573 an acre a year/).length).toBeGreaterThan(0);
  expect(fetchMock.mock.calls.filter(([url]) => url === "/api/analyze")).toHaveLength(1);

  fireEvent.change(screen.getByLabelText("Save water"), { target: { value: "5" } });
  fireEvent.click(screen.getByRole("button", { name: "Update comparison" }));
  await vi.waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === "/api/analyze")).toHaveLength(2));
  const calls = fetchMock.mock.calls.filter(([url]) => url === "/api/analyze");
  expect(JSON.parse(String(calls[1][1]?.body)).own_numbers).toEqual({
    corn: { yield_per_acre: 211, price: 5.6, cost_per_acre: 483.6 },
  });
});

test("calls the soil's erodibility by its name, with the slope", async () => {
  stubApi(() => Promise.resolve(new Response(JSON.stringify(RESPONSE))));
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Compare rotations" }));
  await screen.findAllByText("Your current rotation");
  expect(screen.getByText("Soil erodibility")).toBeTruthy();
  expect(screen.getByText("moderate (slope 1%)")).toBeTruthy();
  expect(screen.queryByText("Erosion risk")).toBeNull();
});

test("switches the whole page to French, asks the API in French, and remembers it", async () => {
  const fetchMock = stubApi(() => Promise.resolve(new Response(JSON.stringify(RESPONSE))));
  render(<App />);
  await screen.findByRole("button", { name: "Compare rotations" });

  fireEvent.click(screen.getByRole("button", { name: "Français" }));

  expect(screen.getByRole("heading", { name: "1. Votre champ" })).toBeTruthy();
  expect(document.documentElement.lang).toBe("fr");
  expect(localStorage.getItem("field-shift-lang")).toBe("fr");
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/crops?lang=fr"));

  fireEvent.click(screen.getByRole("button", { name: "Comparer les rotations" }));
  await screen.findAllByText("Votre rotation actuelle");
  const call = fetchMock.mock.calls.find(([url]) => url === "/api/analyze");
  expect(JSON.parse(String(call?.[1]?.body)).language).toBe("fr");
  expect(screen.getByText("Notre suggestion pour votre champ")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "English" }));
  expect(screen.getByRole("heading", { name: "1. Your field" })).toBeTruthy();
});

test("shows the satellite replay only when the field has a prepared record", async () => {
  const observed = { id: "iowa", latitude: 42.38, longitude: -93.75, years: [], clear_view_share: 0.5, sources: [], methods: [] };
  stubApi(() => Promise.resolve(new Response(JSON.stringify(RESPONSE))), OTTAWA_HISTORY, observed);
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Compare rotations" }));

  expect(await screen.findByText("satellite replay")).toBeTruthy();
});

test("other fields get no satellite replay and no error", async () => {
  stubApi(() => Promise.resolve(new Response(JSON.stringify(RESPONSE))));
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Compare rotations" }));

  await screen.findAllByText("Your current rotation");
  expect(screen.queryByText("satellite replay")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});

test("prompts to update the comparison when priorities change after a run", async () => {
  const fetchMock = stubApi(() => Promise.resolve(new Response(JSON.stringify(RESPONSE))));
  render(<App />);

  fireEvent.click(await screen.findByRole("button", { name: "Compare rotations" }));
  await screen.findAllByText("Your current rotation");
  expect(screen.queryByRole("button", { name: "Update comparison" })).toBeNull();

  fireEvent.change(screen.getByLabelText("Save water"), { target: { value: "5" } });
  const updateBtn = screen.getByRole("button", { name: "Update comparison" });
  expect(updateBtn).toBeTruthy();

  fireEvent.click(updateBtn);
  await screen.findAllByText("Your current rotation");
  expect(fetchMock.mock.calls.filter(([url]) => url === "/api/analyze")).toHaveLength(2);
  expect(screen.queryByRole("button", { name: "Update comparison" })).toBeNull();
});

test("allows interacting with the monthly water chart to inspect a month's water balance", async () => {
  stubApi(() => Promise.resolve(new Response(JSON.stringify(RESPONSE))));
  render(<App />);

  fireEvent.click(await screen.findByRole("button", { name: "Compare rotations" }));
  await screen.findAllByText("Your current rotation");

  const prompt = screen.getByText(/Hover or click a month to inspect its water balance/);
  const readout = prompt.closest(".chart-readout") as HTMLElement;
  expect(readout).toBeTruthy();
  expect(screen.getByText(/Click any month to inspect/i)).toBeTruthy();

  const julyButton = screen.getByRole("button", { name: /July: Rain 110 mm, evaporation demand 170 mm/i });
  fireEvent.click(julyButton);

  expect(julyButton.getAttribute("aria-pressed")).toBe("true");
  expect(within(readout).getByText("July")).toBeTruthy();
  expect(within(readout).getByText("Rain 110 mm")).toBeTruthy();
  expect(within(readout).getByText("Evaporation demand 170 mm")).toBeTruthy();
  expect(within(readout).getByText(/60 mm deficit/)).toBeTruthy();
  expect(within(readout).getByText(/Viewing in 3D/i)).toBeTruthy();

  const aprilButton = screen.getByRole("button", { name: /April: Rain 90 mm, evaporation demand 80 mm/i });
  fireEvent.mouseEnter(aprilButton);
  expect(within(readout).getByText("April")).toBeTruthy();
  expect(within(readout).getByText(/\+10 mm surplus/)).toBeTruthy();
  expect(within(readout).getByText(/Click to jump 3D/i)).toBeTruthy();

  // Moving focus/hover away returns to the clicked (pinned) month.
  fireEvent.mouseLeave(aprilButton);
  expect(within(readout).getByText("July")).toBeTruthy();
});

test("shows a live loading skeleton without fake percentages while comparing rotations", async () => {
  let resolveAnalyze!: (value: Response) => void;
  const analyzePromise = new Promise<Response>((resolve) => {
    resolveAnalyze = resolve;
  });
  stubApi(() => analyzePromise);
  const { container } = render(<App />);

  fireEvent.click(await screen.findByRole("button", { name: "Compare rotations" }));

  const loadingStatus = await screen.findByRole("status", { name: "Comparison status" });
  expect(loadingStatus.textContent).toMatch(/climate|soil|comparing/i);
  expect(loadingStatus.textContent).not.toMatch(/\d+%/);
  expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();

  resolveAnalyze(new Response(JSON.stringify(RESPONSE)));
  expect(await screen.findAllByText("Your current rotation")).toBeTruthy();
  expect(container.querySelector('[aria-busy="true"]')).toBeNull();
});

test("links comparison matrix selection to detail panels and 3D plot highlighting", async () => {
  stubApi(() => Promise.resolve(new Response(JSON.stringify(RESPONSE))));
  const { container } = render(<App />);

  fireEvent.click(await screen.findByRole("button", { name: "Compare rotations" }));
  await screen.findAllByText("Your current rotation");

  // Initially highlights and inspects the first alternative ("current-plus-cover").
  const seasonMock = await screen.findByTestId("season-view");
  expect(seasonMock.getAttribute("data-highlighted")).toBe("current-plus-cover");
  expect(container.querySelector(".detail-panels")?.getAttribute("data-count")).toBe("1");

  // Selecting the third strategy switches both detail panel and 3D highlight.
  fireEvent.click(screen.getByRole("button", { name: "Inspect Alfalfa (3 yrs) – Corn" }));
  expect(seasonMock.getAttribute("data-highlighted")).toBe("x");
  expect(container.querySelector(".detail-panels")?.textContent).toContain("Alfalfa (3 yrs) – Corn");

  // Pinning current rotation alongside compares 2 details at once.
  fireEvent.click(screen.getByRole("button", { name: "Compare details with Corn – Soybean" }));
  expect(container.querySelector(".detail-panels")?.getAttribute("data-count")).toBe("2");
});

test("collapses inputs into a summary bar with Edit toggle and deduplicates shared local checks", async () => {
  const scrollIntoViewMock = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoViewMock,
  });
  stubApi(() => Promise.resolve(new Response(JSON.stringify(RESPONSE))));
  const { container } = render(<App />);

  fireEvent.click(await screen.findByRole("button", { name: "Compare rotations" }));
  await screen.findAllByText("Your current rotation");

  const editButton = screen.getByRole("button", { name: "Edit field & goals" });
  expect(editButton.getAttribute("aria-expanded")).toBe("false");
  expect(container.querySelector(".inputs.is-collapsed")).toBeTruthy();
  expect(container.querySelector(".summary-chips")?.textContent).toContain("Goals");

  fireEvent.click(editButton);
  expect(editButton.getAttribute("aria-expanded")).toBe("true");
  expect(editButton.textContent).toContain("Done editing");
  expect(container.querySelector(".inputs.is-collapsed")).toBeNull();
  expect(scrollIntoViewMock).toHaveBeenCalled();

  // Shared local review bullets appear once in the common block instead of repeating per strategy.
  expect(screen.getByText("Check locally for any change")).toBeTruthy();
  expect(screen.getAllByText("Local pests and diseases decide how much a rotation helps.")).toHaveLength(1);
});

test("the results say what only the farmer decides and open that control", async () => {
  stubApi(() => Promise.resolve(new Response(JSON.stringify(RESPONSE))));
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Compare rotations" }));

  const box = await screen.findByRole("region", { name: "Your call" });
  expect(box.textContent).toContain("Rainfed");
  expect(box.textContent).toContain("No crops ruled out");

  fireEvent.click(within(box).getByRole("button", { name: /crops you can't grow or sell/i }));

  const excluded = screen.getByText(/Crops you can't grow or sell here/).closest("details");
  await vi.waitFor(() => expect(excluded?.open).toBe(true));
});

test("excluded crops disclosure separates subtitle with ruled-out count and primary CTA keeps accessible name", async () => {
  stubApi(() => Promise.reject(new Error("not called")));
  render(<App />);

  const cta = await screen.findByRole("button", { name: "Compare rotations" });
  expect(cta.querySelector(".primary-cta-arrow[aria-hidden='true'] svg")).toBeTruthy();

  const excluded = screen.getByText(/Crops you can't grow or sell here/).closest("details");
  expect(excluded?.querySelector(".excluded-icon[aria-hidden='true'] svg")).toBeTruthy();
  expect(excluded?.querySelector(".excluded-sub")?.textContent).toBe("No buyer or equipment");
  expect(excluded?.querySelector(".excluded-count")).toBeNull();

  fireEvent.click(await within(excluded as HTMLElement).findByLabelText("Canola"));
  expect(excluded?.querySelector(".excluded-count")?.textContent).toBe("1 ruled out");
});

test("answering no to a new crop rules it out and compares again", async () => {
  const withAlfalfa = {
    ...RESPONSE,
    strategies: [
      BASELINE,
      { ...ALTERNATIVE, years: [{ crop: "alfalfa", cover: false }, { crop: "corn", cover: false }] },
    ],
  };
  const fetchMock = stubApi(() => Promise.resolve(new Response(JSON.stringify(withAlfalfa))));
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Compare rotations" }));

  expect(await screen.findByText(/Can you grow and sell Alfalfa here/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "No, rule out Alfalfa" }));

  await vi.waitFor(() => {
    const calls = fetchMock.mock.calls.filter(([url]) => url === "/api/analyze");
    expect(calls).toHaveLength(2);
    expect(JSON.parse(String(calls[1][1]?.body)).excluded_crops).toEqual(["alfalfa"]);
  });
  expect((await screen.findByRole("region", { name: "Your call" })).textContent).toContain("Ruled out: Alfalfa");
});

test("answering yes keeps the option and says so", async () => {
  const withAlfalfa = {
    ...RESPONSE,
    strategies: [BASELINE, { ...ALTERNATIVE, years: [{ crop: "alfalfa", cover: false }] }],
  };
  stubApi(() => Promise.resolve(new Response(JSON.stringify(withAlfalfa))));
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Compare rotations" }));

  fireEvent.click(await screen.findByRole("button", { name: "Yes, I can grow and sell Alfalfa" }));

  expect(screen.getByText(/You can grow and sell Alfalfa/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "No, rule out Alfalfa" })).toBeNull();
});

test("finds a field by pasted coordinates without /api/locate, by town via /api/locate, or by GPS", async () => {
  const baseFetch = stubApi(() => Promise.reject(new Error("not called")));
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url.startsWith("/api/locate?")) {
      return Promise.resolve(
        new Response(JSON.stringify({ latitude: 42.0308, longitude: -93.6319, display_name: "Ames, Iowa" })),
      );
    }
    return baseFetch(url, init);
  });
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: (ok: (pos: { coords: { latitude: number; longitude: number } }) => void) =>
        ok({ coords: { latitude: 43.5448, longitude: -80.2482 } }),
    },
  });

  render(<App />);
  const search = await screen.findByLabelText("Search town, postal code, or lat, lon");

  fireEvent.change(search, { target: { value: "41.5868, -93.6250" } });
  fireEvent.click(screen.getByRole("button", { name: "Find" }));
  expect(screen.getByText(/41\.59° N, 93\.63° W/)).toBeTruthy();
  expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("/api/locate"))).toBe(false);

  fireEvent.change(search, { target: { value: "Ames, Iowa" } });
  fireEvent.click(screen.getByRole("button", { name: "Find" }));
  expect(await screen.findByText(/42\.03° N, 93\.63° W/)).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledWith("/api/locate?q=Ames%2C+Iowa");

  fireEvent.click(screen.getByRole("button", { name: "Use my location" }));
  expect(await screen.findByText(/43\.54° N, 80\.25° W/)).toBeTruthy();
});

test("folds priority sliders by default, surfaces 3D seasons from AnswerCard/StrategyCard, scrolls on RotationList click, and unifies YourNumbers under YourCall", async () => {
  const scrollIntoViewMock = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoViewMock,
  });
  const withEconomics = {
    ...RESPONSE,
    economics: {
      region: "Iowa",
      currency: "USD",
      basis: "Costs are variable costs.",
      cover_crop_cost: 41.55,
      crops: [{ crop: "corn", name: "Corn (grain)", unit: "bu", yield_per_acre: 211, price: 4.6, cost_per_acre: 483.6, own: false }],
      sources: [],
    },
  };
  stubApi(() => Promise.resolve(new Response(JSON.stringify(withEconomics))));
  const { container } = render(<App />);

  await screen.findByRole("button", { name: "Compare rotations" });
  const prioDetails = container.querySelector("#control-priorities") as HTMLDetailsElement | null;
  expect(prioDetails?.tagName).toBe("DETAILS");
  expect(prioDetails?.open).toBe(false);

  fireEvent.click(screen.getByRole("button", { name: "Compare rotations" }));
  await screen.findAllByText("Your current rotation");

  // Single unified "Your yields and prices" trigger inside YourCall (no redundant <details> bar below it).
  expect(container.querySelector("#control-numbers summary")).toBeNull();
  expect(screen.queryByLabelText("Corn (grain) price, $ per bu")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Enter your yields and prices" }));
  expect(screen.getByLabelText("Corn (grain) price, $ per bu")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Hide yields and prices" }));
  expect(screen.queryByLabelText("Corn (grain) price, $ per bu")).toBeNull();

  // Clicking "See why and what to check" in RotationList scrolls cleanly to #detail-panels.
  scrollIntoViewMock.mockClear();
  const listButtons = screen.getAllByRole("button", { name: "See why and what to check" });
  fireEvent.click(listButtons[0]);
  expect(scrollIntoViewMock).toHaveBeenCalled();

  // AnswerCard 3D button and StrategyCard "Compare in 3D" both open #sec-more and scroll to #sec-seasons.
  const more = container.querySelector("#sec-more") as HTMLDetailsElement;
  expect(more.open).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "See through the seasons (3D)" }));
  expect(more.open).toBe(true);

  more.open = false;
  fireEvent.click(screen.getByRole("button", { name: "Compare details with Alfalfa (3 yrs) – Corn" }));
  const compareBtns = screen.getAllByRole("button", { name: "Compare in 3D" });
  expect(compareBtns.length).toBeGreaterThanOrEqual(1);
  fireEvent.click(compareBtns[0]);
  expect(more.open).toBe(true);
});
