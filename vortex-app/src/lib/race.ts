/** Standard split markers per race distance (metres from the wall). */
export const RACE_MARKERS: Record<string, string[]> = {
  "50": ["Reaction", "15m", "Breakout", "25m", "35m", "45m", "50m"],
  "100": ["Reaction", "15m", "Breakout", "25m", "50m", "75m", "100m"],
  "200": ["Reaction", "50m", "100m", "150m", "200m"],
  "400": ["Reaction", "100m", "200m", "300m", "400m"],
  "800": ["Reaction", "200m", "400m", "600m", "800m"],
  "1500": ["Reaction", "300m", "600m", "900m", "1200m", "1500m"],
};

export const RACE_TYPES = Object.keys(RACE_MARKERS);
