// Track constants, with no dependencies — so the simulation and its tests
// never have to load a renderer.

/** World x per lane: 0 left, 1 centre, 2 right. */
export const LANE_X = [-2.2, 0, 2.2];
/** The same three lanes as the model exports them (z across the track). */
export const LANE_Z = [14.9, 12.7, 10.5];
/** Model y of the rail bed. */
export const GROUND_Y = 1.3;
/** How long one corridor tile is. */
export const TILE_PITCH = 38.4;

/** Obstacle hitboxes, in world units above the ground. */
export const HIT = {
  low: { top: 1.0 },      // must be airborne above this
  high: { bottom: 1.15 }, // must be rolling below this
  train: { top: 3.0 },
};
