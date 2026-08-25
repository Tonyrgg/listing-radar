import type { ListingMapPin } from "@/lib/map/types";

export type ListingCluster = {
  id: string;
  latitude: number;
  longitude: number;
  listings: ListingMapPin[];
  displaced: boolean;
};

const SPIDERFY_ZOOM = 18;
const METERS_PER_LATITUDE_DEGREE = 111_320;

function clusterCellSize(zoom: number) {
  if (zoom >= 17) return 0.00014;
  if (zoom >= 16) return 0.00028;
  if (zoom >= 15) return 0.00056;
  if (zoom >= 14) return 0.0011;
  if (zoom >= 13) return 0.0022;
  return 0.0044;
}

function coordinateKey(pin: ListingMapPin) {
  // Seven decimals keep locations distinct down to about one centimetre.
  return `${pin.latitude.toFixed(7)}:${pin.longitude.toFixed(7)}`;
}

function spiderfyListings(listingPins: ListingMapPin[]): ListingCluster[] {
  const coincident = new Map<string, ListingMapPin[]>();
  for (const pin of listingPins) {
    coincident.set(coordinateKey(pin), [...(coincident.get(coordinateKey(pin)) ?? []), pin]);
  }

  return Array.from(coincident.values()).flatMap<ListingCluster>((listings) => {
    if (listings.length === 1) {
      const listing = listings[0];
      return [{ id: listing.id, latitude: listing.latitude, longitude: listing.longitude, listings, displaced: false }];
    }
    const ordered = [...listings].sort((left, right) => left.id.localeCompare(right.id));
    const latitude = ordered[0].latitude;
    const longitude = ordered[0].longitude;
    const radiusMeters = Math.min(16, 6 + Math.sqrt(ordered.length) * 3);
    const longitudeDegree = METERS_PER_LATITUDE_DEGREE * Math.cos((latitude * Math.PI) / 180);

    return ordered.map((listing, index) => {
      const angle = -Math.PI / 2 + (index * 2 * Math.PI) / ordered.length;
      return {
        id: listing.id,
        latitude: latitude + (Math.sin(angle) * radiusMeters) / METERS_PER_LATITUDE_DEGREE,
        longitude: longitude + (Math.cos(angle) * radiusMeters) / longitudeDegree,
        listings: [listing],
        displaced: true,
      };
    });
  });
}

export function listingClusters(listingPins: ListingMapPin[], zoom: number): ListingCluster[] {
  if (zoom >= SPIDERFY_ZOOM) return spiderfyListings(listingPins);

  const cellSize = clusterCellSize(zoom);
  const groups = new Map<string, ListingMapPin[]>();
  for (const pin of listingPins) {
    const key = `${Math.floor(pin.latitude / cellSize)}:${Math.floor(pin.longitude / cellSize)}`;
    groups.set(key, [...(groups.get(key) ?? []), pin]);
  }

  return Array.from(groups.entries()).map(([key, listings]) => ({
    id: listings.length === 1 ? listings[0].id : `cluster-${zoom}-${key}`,
    latitude: listings.reduce((sum, listing) => sum + listing.latitude, 0) / listings.length,
    longitude: listings.reduce((sum, listing) => sum + listing.longitude, 0) / listings.length,
    listings,
    displaced: false,
  }));
}
