import { Vector3 } from "../../math/vectors.ts";

export type MaterialColor = [number, number, number];

export type RemoteMeshDescriptor = {
  url: string;
  scale?: Vector3;
  rotation?: Vector3;
  translation?: Vector3;
  diffuseColor?: MaterialColor;
  specularColor?: MaterialColor;
  specularExponent?: number;
};

export type RemoteMeshData = {
  positions: number[];
  normals: number[];
  indices: number[];
  diffuseColor?: MaterialColor;
};

export type RemoteMeshModelData = {
  parts: RemoteMeshData[];
};