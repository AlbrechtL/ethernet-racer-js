import { CharacterMaterial } from "./character-material.ts";
import { CharacterJoint } from "./character-joint.ts";
import { Matrix4 } from "../../math/matrices.ts";
import { RemoteMeshDescriptor } from "./remote-mesh.ts";

export type CharacterNode = {
  parent: CharacterNode;
  material: CharacterMaterial | undefined;
  joint: CharacterJoint | undefined;
  isVisible: boolean;
  hasShadow: boolean;
  numSphereDivisions: number | undefined;
  remoteMesh: RemoteMeshDescriptor | undefined;
  transformation: Matrix4;
};
