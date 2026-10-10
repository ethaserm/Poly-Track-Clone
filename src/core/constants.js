// Shared world dimensions. Everything is in metres.
export const TILE = 10; // horizontal grid size of one track cell
export const LEVEL = 2.5; // vertical grid step
export const DECK = 0.25; // road surface height above a level's base
export const ROAD_HALF = 4.0; // half width of the drivable surface (wall to wall)
export const WALL_OUTER = 4.6; // half width of the piece including walls
export const WALL_HEIGHT = 0.9;
export const DECK_THICKNESS = 0.6;

export const PHYSICS_HZ = 240;
export const PHYSICS_DT = 1 / PHYSICS_HZ;
export const GHOST_HZ = 30;

// Surface ids stored on collision triangles.
export const SURFACE = {
  ROAD: 0,
  GRASS: 1,
  BOOST: 2,
  WALL: 3,
};

// Grid directions, index = rotation. Rotation r maps local +Z onto DIRS[r].
export const DIRS = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

export function rotateXZ(x, z, rot) {
  switch (((rot % 4) + 4) % 4) {
    case 0:
      return [x, z];
    case 1:
      return [z, -x];
    case 2:
      return [-x, -z];
    default:
      return [-z, x];
  }
}
