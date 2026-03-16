import React, { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { NavigationIcon } from "lucide-react";

// Fix Leaflet's default icon path issue with bundlers
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

const recommendedIcon = new L.Icon({
  iconUrl:
    "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const defaultIcon = new L.Icon({
  iconUrl:
    "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

function FitBounds({ stores }) {
  const map = useMap();

  useEffect(() => {
    if (stores.length === 0) return;
    const bounds = L.latLngBounds(stores.map((s) => [s.lat, s.lng]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  }, [map, stores]);

  return null;
}

/**
 * Interactive Leaflet map showing grocery store locations.
 *
 * @param {object} props
 * @param {object} props.mapData - shopper_map_data from agent response
 * @param {string} [props.className] - Additional CSS classes
 * @param {string} [props.height] - Map height (default: "400px")
 */
export function StoreMap({ mapData, className = "", height = "400px" }) {
  const center = useMemo(() => {
    if (mapData?.center) return [mapData.center.lat, mapData.center.lng];
    return [45.4215, -75.6972]; // Ottawa default
  }, [mapData]);

  const stores = useMemo(() => {
    return (mapData?.stores || []).filter((s) => s.lat && s.lng);
  }, [mapData]);

  if (stores.length === 0) {
    return (
      <div
        className={`rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground ${className}`}
      >
        No store locations available to display on map.
      </div>
    );
  }

  return (
    <div className={`rounded-xl overflow-hidden border shadow-sm relative z-0 isolate ${className}`}>
      <MapContainer
        center={center}
        zoom={12}
        style={{ height, width: "100%" }}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        />
        <FitBounds stores={stores} />
        {stores.map((store, index) => (
          <Marker
            key={`store-marker-${store.store}-${index}`}
            position={[store.lat, store.lng]}
            icon={store.is_recommended ? recommendedIcon : defaultIcon}
          >
            <Popup maxWidth={280}>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  {store.logo_url && (
                    <img
                      src={store.logo_url}
                      alt=""
                      className="w-5 h-5 rounded-sm object-contain shrink-0"
                    />
                  )}
                  <span className="font-semibold text-base">{store.store}</span>
                  {store.is_recommended && (
                    <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                      Recommended
                    </span>
                  )}
                </div>
                {store.address && (
                  <p className="text-xs text-muted-foreground">{store.address}</p>
                )}
                {store.items && store.items.length > 0 && (
                  <div>
                    <p className="font-medium text-muted-foreground mb-1">
                      Items ({store.items.length}):
                    </p>
                    <ul className="space-y-0.5">
                      {store.items.map((item, i) => (
                        <li
                          key={`popup-item-${i}`}
                          className="flex justify-between gap-2"
                        >
                          <span className="truncate">{item.name}</span>
                          <span className="font-medium whitespace-nowrap">
                            {item.price}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {store.total > 0 && (
                  <p className="font-semibold border-t pt-1">
                    Est. Total: ${store.total.toFixed(2)}
                  </p>
                )}
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(store.store)}&near=${store.lat},${store.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-blue-600 hover:underline text-xs"
                >
                  <NavigationIcon className="w-3 h-3" />
                  Get Directions
                </a>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
