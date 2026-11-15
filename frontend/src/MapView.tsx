import { LngLat, Map as MapLibreMap, Marker, setWorkerUrl, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { useEffect, useRef } from "react";

import { t } from "./i18n";

// MapLibre 6 looks for its worker next to its own script, which a production bundle
// does not copy. Bundle the worker as a file and point MapLibre at it.
setWorkerUrl(workerUrl);

// OpenStreetMap raster tiles: no API key, light development use only. Replace with a
// hosted basemap (or NASA GIBS imagery) before heavy use.
const STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

interface Props {
  latitude: number;
  longitude: number;
  onPick: (latitude: number, longitude: number) => void;
}

export default function MapView({ latitude, longitude, onPick }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;

  useEffect(() => {
    if (!container.current) return;
    // clickTolerance: MapLibre's default of 3 px turns a trackpad press that slides a few
    // pixels into a drag, so the click (and the field move) is silently lost.
    const m = new MapLibreMap({
      container: container.current,
      style: STYLE,
      center: [longitude, latitude],
      zoom: 11,
      clickTolerance: 10,
    });
    m.on("click", (event) => pick.current(event.lngLat.lat, event.lngLat.lng));
    marker.current = new Marker({ color: "#1f6f3d" }).setLngLat([longitude, latitude]).addTo(m);
    map.current = m;
    return () => m.remove();
    // The map is created once; the effect below follows position changes.
  }, []);

  useEffect(() => {
    marker.current?.setLngLat([longitude, latitude]);
    const m = map.current;
    if (m && m.getCenter().distanceTo(new LngLat(longitude, latitude)) > 5000) {
      m.flyTo({ center: [longitude, latitude], zoom: 12 });
    }
  }, [latitude, longitude]);

  return <div ref={container} className="map" aria-label={t("Map: click to choose your field")} />;
}
