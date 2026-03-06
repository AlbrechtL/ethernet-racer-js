import occtImportJsFactory from "occt-import-js";
import occtWasmUrl from "occt-import-js/dist/occt-import-js.wasm?url";
import { MathUtil } from "../../math/math-util.ts";
import { Vector3 } from "../../math/vectors.ts";
import {
  MaterialColor,
  RemoteMeshData,
  RemoteMeshDescriptor,
  RemoteMeshModelData,
} from "./remote-mesh.ts";

const DEFAULT_SCALE: Vector3 = [1.15, 1.15, 1.15];
const DEFAULT_ROTATION: Vector3 = [0, 0, 0];
const DEFAULT_TRANSLATION: Vector3 = [0, 0, 0];
const STEP_EXTENSIONS = new Set(["stp", "step"]);
const OBJ_EXTENSIONS = new Set(["obj"]);

type Bounds = {
  min: Vector3;
  max: Vector3;
};

type FaceVertex = {
  token: string;
  positionIndex: number;
};

type OcctMesh = {
  color?: number[];
  attributes?: {
    position?: { array?: number[] };
    normal?: { array?: number[] };
  };
  index?: { array?: number[] };
};

type OcctResult = {
  success: boolean;
  meshes?: OcctMesh[];
};

type OcctModule = {
  ReadStepFile: (content: Uint8Array, params: object | null) => OcctResult;
};

let occtModulePromise: Promise<OcctModule> | undefined;

export namespace RemoteMeshLoader {
  export async function load(
    descriptor: RemoteMeshDescriptor,
  ): Promise<RemoteMeshModelData> {
    const response = await fetch(descriptor.url);
    if (!response.ok) {
      throw new Error(
        `Could not load remote mesh (${response.status} ${response.statusText})`,
      );
    }

    const buffer = new Uint8Array(await response.arrayBuffer());
    const meshFormat = detectFormat(descriptor.url, buffer);

    if (meshFormat === "obj") {
      const source = new TextDecoder().decode(buffer);
      return parseObj(source, descriptor);
    }

    if (meshFormat === "step") {
      return parseStep(buffer, descriptor);
    }

    throw new Error(`Unsupported remote mesh format for ${descriptor.url}`);
  }

  export function parseObj(
    source: string,
    descriptor: Partial<RemoteMeshDescriptor> = {},
  ): RemoteMeshModelData {
    const sourcePositions: Vector3[] = [];
    const faces: FaceVertex[][] = [];

    source.split(/\r?\n/u).forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        return;
      }

      const segments = line.split(/\s+/u);
      const [keyword, ...values] = segments;

      if (keyword === "v") {
        if (values.length < 3) {
          throw new Error("Invalid OBJ vertex definition");
        }
        sourcePositions.push([
          Number.parseFloat(values[0]),
          Number.parseFloat(values[1]),
          Number.parseFloat(values[2]),
        ]);
        return;
      }

      if (keyword !== "f") {
        return;
      }

      if (values.length < 3) {
        throw new Error("OBJ faces must contain at least three vertices");
      }

      faces.push(
        values.map((token) => ({
          token,
          positionIndex: resolveObjIndex(token.split("/")[0], sourcePositions.length),
        })),
      );
    });

    if (sourcePositions.length === 0) {
      throw new Error("OBJ mesh does not contain any vertices");
    }
    if (faces.length === 0) {
      throw new Error("OBJ mesh does not contain any faces");
    }

    const positions: number[] = [];
    const indices: number[] = [];
    const vertexMap = new Map<string, number>();

    const getOrCreateVertexIndex = (faceVertex: FaceVertex): number => {
      const existingIndex = vertexMap.get(faceVertex.token);
      if (existingIndex !== undefined) {
        return existingIndex;
      }

      const sourcePosition = sourcePositions[faceVertex.positionIndex];
      const newIndex = positions.length / 3;
      positions.push(...sourcePosition);
      vertexMap.set(faceVertex.token, newIndex);
      return newIndex;
    };

    faces.forEach((face) => {
      for (let index = 1; index < face.length - 1; index++) {
        indices.push(
          getOrCreateVertexIndex(face[0]),
          getOrCreateVertexIndex(face[index]),
          getOrCreateVertexIndex(face[index + 1]),
        );
      }
    });

    return normalizeModel([{ positions, normals: [], indices }], descriptor);
  }

  function resolveObjIndex(value: string | undefined, listLength: number): number {
    if (!value) {
      throw new Error("OBJ face entry is missing a vertex index");
    }

    const parsedIndex = Number.parseInt(value, 10);
    if (!Number.isFinite(parsedIndex) || parsedIndex === 0) {
      throw new Error(`Invalid OBJ face vertex index: ${value}`);
    }

    const normalizedIndex = parsedIndex > 0 ? parsedIndex - 1 : listLength + parsedIndex;
    if (normalizedIndex < 0 || normalizedIndex >= listLength) {
      throw new Error(`OBJ vertex index out of range: ${value}`);
    }

    return normalizedIndex;
  }

  async function parseStep(
    buffer: Uint8Array,
    descriptor: Partial<RemoteMeshDescriptor>,
  ): Promise<RemoteMeshModelData> {
    const occt = await getOcctModule();
    const result = occt.ReadStepFile(buffer, {
      linearUnit: "millimeter",
      linearDeflectionType: "bounding_box_ratio",
      linearDeflection: 0.002,
      angularDeflection: 0.2,
    });

    if (!result.success || !result.meshes?.length) {
      throw new Error("STEP import did not return any mesh data");
    }

    const parts: RemoteMeshData[] = result.meshes
      .map((mesh) => ({
        positions: mesh.attributes?.position?.array ?? [],
        normals: mesh.attributes?.normal?.array ?? [],
        indices: mesh.index?.array ?? [],
        diffuseColor: toMaterialColor(mesh.color),
      }))
      .filter((mesh) => mesh.positions.length > 0 && mesh.indices.length > 0);

    if (parts.length === 0) {
      throw new Error("STEP import returned meshes without triangulated geometry");
    }

    return normalizeModel(parts, descriptor);
  }

  function toMaterialColor(color: number[] | undefined): MaterialColor | undefined {
    if (!color || color.length < 3) {
      return undefined;
    }
    return [color[0], color[1], color[2]];
  }

  async function getOcctModule(): Promise<OcctModule> {
    if (!occtModulePromise) {
      occtModulePromise = occtImportJsFactory({
        locateFile: (path: string) => {
          if (path.endsWith(".wasm")) {
            return occtWasmUrl;
          }
          return path;
        },
      }) as Promise<OcctModule>;
    }

    return occtModulePromise;
  }

  function detectFormat(url: string, buffer: Uint8Array): "obj" | "step" {
    const pathname = new URL(url).pathname;
    const extension = pathname.split(".").pop()?.toLowerCase();
    if (extension && OBJ_EXTENSIONS.has(extension)) {
      return "obj";
    }
    if (extension && STEP_EXTENSIONS.has(extension)) {
      return "step";
    }

    const header = new TextDecoder().decode(buffer.slice(0, 64)).toUpperCase();
    if (header.includes("ISO-10303-21")) {
      return "step";
    }
    return "obj";
  }

  function normalizeModel(
    parts: RemoteMeshData[],
    descriptor: Partial<RemoteMeshDescriptor>,
  ): RemoteMeshModelData {
    const bounds = computeModelBounds(parts);
    const scale = descriptor.scale ?? DEFAULT_SCALE;
    const rotation = descriptor.rotation ?? DEFAULT_ROTATION;
    const translation = descriptor.translation ?? DEFAULT_TRANSLATION;
    const center: Vector3 = [
      (bounds.min[0] + bounds.max[0]) / 2,
      (bounds.min[1] + bounds.max[1]) / 2,
      (bounds.min[2] + bounds.max[2]) / 2,
    ];
    const maxDimension = Math.max(
      bounds.max[0] - bounds.min[0],
      bounds.max[1] - bounds.min[1],
      bounds.max[2] - bounds.min[2],
    );

    if (maxDimension === 0) {
      throw new Error("Remote mesh has zero size");
    }

    return {
      parts: parts.map((part) => {
        const transformedPositions = transformPositions(
          part.positions,
          center,
          maxDimension,
          scale,
          rotation,
          translation,
        );

        return {
          ...part,
          positions: transformedPositions,
          normals: computeNormals(transformedPositions, part.indices),
        };
      }),
    };
  }

  function transformPositions(
    positions: number[],
    center: Vector3,
    maxDimension: number,
    scale: Vector3,
    rotation: Vector3,
    translation: Vector3,
  ): number[] {
    const transformedPositions: number[] = [];

    for (let index = 0; index < positions.length; index += 3) {
      const normalized: Vector3 = [
        (positions[index] - center[0]) / maxDimension,
        (positions[index + 1] - center[1]) / maxDimension,
        (positions[index + 2] - center[2]) / maxDimension,
      ];
      const scaled: Vector3 = [
        normalized[0] * scale[0],
        normalized[1] * scale[1],
        normalized[2] * scale[2],
      ];
      const rotated = rotatePoint(scaled, rotation);

      transformedPositions.push(
        rotated[0] + translation[0],
        rotated[1] + translation[1],
        rotated[2] + translation[2],
      );
    }

    return transformedPositions;
  }

  function rotatePoint(point: Vector3, rotation: Vector3): Vector3 {
    let [x, y, z] = point;
    const [xRadians, yRadians, zRadians] = rotation.map((degrees) =>
      MathUtil.toRadians(degrees),
    ) as Vector3;

    const sinX = Math.sin(xRadians);
    const cosX = Math.cos(xRadians);
    [y, z] = [y * cosX - z * sinX, y * sinX + z * cosX];

    const sinY = Math.sin(yRadians);
    const cosY = Math.cos(yRadians);
    [x, z] = [x * cosY + z * sinY, -x * sinY + z * cosY];

    const sinZ = Math.sin(zRadians);
    const cosZ = Math.cos(zRadians);
    [x, y] = [x * cosZ - y * sinZ, x * sinZ + y * cosZ];

    return [x, y, z];
  }

  function computeModelBounds(parts: RemoteMeshData[]): Bounds {
    const allPositions = parts.flatMap((part) => part.positions);
    return computeBounds(allPositions);
  }

  function computeBounds(positions: number[]): Bounds {
    const bounds: Bounds = {
      min: [positions[0], positions[1], positions[2]],
      max: [positions[0], positions[1], positions[2]],
    };

    for (let index = 3; index < positions.length; index += 3) {
      bounds.min[0] = Math.min(bounds.min[0], positions[index]);
      bounds.min[1] = Math.min(bounds.min[1], positions[index + 1]);
      bounds.min[2] = Math.min(bounds.min[2], positions[index + 2]);
      bounds.max[0] = Math.max(bounds.max[0], positions[index]);
      bounds.max[1] = Math.max(bounds.max[1], positions[index + 1]);
      bounds.max[2] = Math.max(bounds.max[2], positions[index + 2]);
    }

    return bounds;
  }

  function computeNormals(positions: number[], indices: number[]): number[] {
    const normals = new Array<number>(positions.length).fill(0);

    for (let index = 0; index < indices.length; index += 3) {
      const index0 = indices[index] * 3;
      const index1 = indices[index + 1] * 3;
      const index2 = indices[index + 2] * 3;

      const point0: Vector3 = [
        positions[index0],
        positions[index0 + 1],
        positions[index0 + 2],
      ];
      const point1: Vector3 = [
        positions[index1],
        positions[index1 + 1],
        positions[index1 + 2],
      ];
      const point2: Vector3 = [
        positions[index2],
        positions[index2 + 1],
        positions[index2 + 2],
      ];

      const vector1: Vector3 = [
        point1[0] - point0[0],
        point1[1] - point0[1],
        point1[2] - point0[2],
      ];
      const vector2: Vector3 = [
        point2[0] - point0[0],
        point2[1] - point0[1],
        point2[2] - point0[2],
      ];
      const faceNormal: Vector3 = [
        vector1[1] * vector2[2] - vector1[2] * vector2[1],
        vector1[2] * vector2[0] - vector1[0] * vector2[2],
        vector1[0] * vector2[1] - vector1[1] * vector2[0],
      ];

      addNormal(normals, index0, faceNormal);
      addNormal(normals, index1, faceNormal);
      addNormal(normals, index2, faceNormal);
    }

    for (let index = 0; index < normals.length; index += 3) {
      const length = Math.hypot(
        normals[index],
        normals[index + 1],
        normals[index + 2],
      );
      if (length === 0) {
        normals[index + 2] = 1;
        continue;
      }
      normals[index] /= length;
      normals[index + 1] /= length;
      normals[index + 2] /= length;
    }

    return normals;
  }

  function addNormal(normals: number[], index: number, normal: Vector3): void {
    normals[index] += normal[0];
    normals[index + 1] += normal[1];
    normals[index + 2] += normal[2];
  }
}