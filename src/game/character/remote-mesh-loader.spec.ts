import { describe, expect, it } from "vitest";
import { RemoteMeshLoader } from "./remote-mesh-loader.ts";

describe("RemoteMeshLoader", () => {
  it("triangulates quad faces and computes normals", () => {
    const model = RemoteMeshLoader.parseObj(`
v -1 -1 0
v 1 -1 0
v 1 1 0
v -1 1 0
f 1 2 3 4
`);
    const mesh = model.parts[0];

    expect(mesh.positions.length).toBe(12);
    expect(mesh.indices).toEqual([0, 1, 2, 0, 2, 3]);
    expect(mesh.normals.length).toBe(mesh.positions.length);
    expect(mesh.normals[2]).toBeCloseTo(1, 6);
    expect(mesh.normals[5]).toBeCloseTo(1, 6);
    expect(mesh.normals[8]).toBeCloseTo(1, 6);
    expect(mesh.normals[11]).toBeCloseTo(1, 6);
  });

  it("applies runtime transforms after normalization", () => {
    const model = RemoteMeshLoader.parseObj(
      `
v 0 0 0
v 2 0 0
v 0 4 0
f 1 2 3
`,
      {
        scale: [2, 4, 6],
        translation: [1, 2, 3],
      },
    );
    const mesh = model.parts[0];

    expect(mesh.positions).toEqual([
      0.5,
      0,
      3,
      1.5,
      0,
      3,
      0.5,
      4,
      3,
    ]);
  });

  it("supports negative OBJ indices", () => {
    const model = RemoteMeshLoader.parseObj(`
v 0 0 0
v 1 0 0
v 0 1 0
f -3 -2 -1
`);
    const mesh = model.parts[0];

    expect(mesh.indices).toEqual([0, 1, 2]);
  });
});