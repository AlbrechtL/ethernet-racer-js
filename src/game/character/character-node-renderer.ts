import { GlContext } from "../../gl/gl-context.ts";
import { CharacterNode } from "./character-node.ts";
import { GlUtil } from "../../gl/gl-util.ts";
import { ShaderFactory, ShaderLightSettings } from "../shader-factory.ts";
import { Shaders } from "../../gl/shaders.ts";
import { Matrices } from "../../math/matrices.ts";
import { CharacterJoint } from "./character-joint.ts";
import { RemoteMeshLoader } from "./remote-mesh-loader.ts";
import { MaterialColor, RemoteMeshData, RemoteMeshDescriptor } from "./remote-mesh.ts";

type NodeRenderingInfo = {
  numIndices: number;
  indexType: GLenum;
  vertexArray: WebGLVertexArrayObject;
};

type SwitchMeshes = {
  body: RemoteMeshData;
  topCube: RemoteMeshData;
  frames: RemoteMeshData;
  interiors: RemoteMeshData;
  contacts: RemoteMeshData;
  leds: RemoteMeshData;
};

type RemoteMeshEntry = {
  descriptor: RemoteMeshDescriptor;
  parts: {
    diffuseColor?: MaterialColor;
    renderingInfo: NodeRenderingInfo;
  }[];
};

export class CharacterNodeRenderer {
  public static readonly MIN_SPHERE_DIVISIONS = 3;
  public static readonly MAX_SPHERE_DIVISIONS = 16;

  private static readonly VERTEX_SHADER = `#version 300 es
in vec4 a_Position;
in vec3 a_Normal;

uniform mat4 u_ModelViewMatrix;
uniform mat4 u_ViewMatrix;
uniform mat4 u_ProjectionMatrix;
uniform mat4 u_NormalMatrix;
uniform vec3 u_MaterialDiffuseColor;
uniform vec3 u_MaterialSpecularColor;
uniform float u_MaterialSpecularExponent;

out vec3 v_LightColor;

$$lighting-function$$

void main() {
  vec4 eyePosition = u_ModelViewMatrix * a_Position;
  gl_Position = u_ProjectionMatrix * eyePosition;

  v_LightColor = computeAllLights(eyePosition);
}
`;

  private static readonly FRAGMENT_SHADER = `#version 300 es
precision mediump float;

in vec3 v_LightColor;

out vec4 outColor;

void main() {
  outColor = vec4(v_LightColor, 1.0);
}
`;

  private static readonly SHADER_LIGHT_SETTINGS: ShaderLightSettings = {
    useMaterial: true,
    useStaticNormal: false,
    useNormalMatrix: true,
  };

  private readonly remoteMeshEntries = new WeakMap<CharacterNode, RemoteMeshEntry>();

  private bodyRenderingInfo: NodeRenderingInfo;
  private topCubeRenderingInfo: NodeRenderingInfo;
  private frameRenderingInfo: NodeRenderingInfo;
  private interiorRenderingInfo: NodeRenderingInfo;
  private contactRenderingInfo: NodeRenderingInfo;
  private ledRenderingInfo: NodeRenderingInfo;

  private shader: WebGLProgram;

  private viewMatrixUniformLocation: WebGLUniformLocation;
  private modelViewMatrixUniformLocation: WebGLUniformLocation;
  private projectionMatrixUniformLocation: WebGLUniformLocation;
  private normalMatrixUniformLocation: WebGLUniformLocation;
  private materialDiffuseColorUniformLocation: WebGLUniformLocation;
  private materialSpecularColorUniformLocation: WebGLUniformLocation;
  private materialSpecularExponentUniformLocation: WebGLUniformLocation;

  private static addCuboid(
    meshData: RemoteMeshData,
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
    minZ: number,
    maxZ: number,
  ): void {
    const { positions, normals, indices } = meshData;

    const addFace = (
      v0: [number, number, number],
      v1: [number, number, number],
      v2: [number, number, number],
      v3: [number, number, number],
      normal: [number, number, number],
    ) => {
      const baseIndex = positions.length / 3;
      positions.push(...v0, ...v1, ...v2, ...v3);
      normals.push(...normal, ...normal, ...normal, ...normal);
      indices.push(
        baseIndex,
        baseIndex + 1,
        baseIndex + 2,
        baseIndex,
        baseIndex + 2,
        baseIndex + 3,
      );
    };

    addFace(
      [minX, minY, maxZ],
      [maxX, minY, maxZ],
      [maxX, maxY, maxZ],
      [minX, maxY, maxZ],
      [0, 0, 1],
    );
    addFace(
      [maxX, minY, minZ],
      [minX, minY, minZ],
      [minX, maxY, minZ],
      [maxX, maxY, minZ],
      [0, 0, -1],
    );
    addFace(
      [minX, minY, minZ],
      [minX, minY, maxZ],
      [minX, maxY, maxZ],
      [minX, maxY, minZ],
      [-1, 0, 0],
    );
    addFace(
      [maxX, minY, maxZ],
      [maxX, minY, minZ],
      [maxX, maxY, minZ],
      [maxX, maxY, maxZ],
      [1, 0, 0],
    );
    addFace(
      [minX, maxY, maxZ],
      [maxX, maxY, maxZ],
      [maxX, maxY, minZ],
      [minX, maxY, minZ],
      [0, 1, 0],
    );
    addFace(
      [minX, minY, minZ],
      [maxX, minY, minZ],
      [maxX, minY, maxZ],
      [minX, minY, maxZ],
      [0, -1, 0],
    );
  }

  private static createSwitchMeshes(): SwitchMeshes {
    const body: RemoteMeshData = { positions: [], normals: [], indices: [] };
    const topCube: RemoteMeshData = { positions: [], normals: [], indices: [] };
    const frames: RemoteMeshData = { positions: [], normals: [], indices: [] };
    const interiors: RemoteMeshData = { positions: [], normals: [], indices: [] };
    const contacts: RemoteMeshData = { positions: [], normals: [], indices: [] };
    const leds: RemoteMeshData = { positions: [], normals: [], indices: [] };

    const meshScale = 2;
    const scale = (value: number): number => value * meshScale;

    CharacterNodeRenderer.addCuboid(
      body,
      scale(-0.16),
      scale(0.16),
      scale(-0.34),
      scale(0.34),
      scale(-0.09),
      scale(0.09),
    );
    CharacterNodeRenderer.addCuboid(
      body,
      scale(-0.145),
      scale(0.145),
      scale(-0.29),
      scale(0.31),
      scale(0.09),
      scale(0.105),
    );
    CharacterNodeRenderer.addCuboid(
      topCube,
      scale(-0.06),
      scale(0.06),
      scale(0.34),
      scale(0.4),
      scale(-0.035),
      scale(0.035),
    );

    CharacterNodeRenderer.addCuboid(
      body,
      scale(-0.118),
      scale(0.118),
      scale(-0.31),
      scale(0.27),
      scale(-0.109),
      scale(-0.09),
    );

    const portCenterX = scale(0);
    const topPortCenterY = scale(0.205);
    const portStepY = scale(0.112);
    const portHalfWidth = scale(0.046);
    const portHalfHeight = scale(0.032);

    for (let portIndex = 0; portIndex < 5; portIndex++) {
      const centerY = topPortCenterY - portIndex * portStepY;

      CharacterNodeRenderer.addCuboid(
        frames,
        portCenterX - (portHalfWidth + scale(0.0045)),
        portCenterX - (portHalfWidth - scale(0.0015)),
        centerY - (portHalfHeight + scale(0.0045)),
        centerY + (portHalfHeight + scale(0.0045)),
        scale(-0.124),
        scale(-0.09),
      );
      CharacterNodeRenderer.addCuboid(
        frames,
        portCenterX + (portHalfWidth - scale(0.0015)),
        portCenterX + (portHalfWidth + scale(0.0045)),
        centerY - (portHalfHeight + scale(0.0045)),
        centerY + (portHalfHeight + scale(0.0045)),
        scale(-0.124),
        scale(-0.09),
      );
      CharacterNodeRenderer.addCuboid(
        frames,
        portCenterX - (portHalfWidth - scale(0.0015)),
        portCenterX + (portHalfWidth - scale(0.0015)),
        centerY + (portHalfHeight - scale(0.0005)),
        centerY + (portHalfHeight + scale(0.0045)),
        scale(-0.124),
        scale(-0.09),
      );
      CharacterNodeRenderer.addCuboid(
        frames,
        portCenterX - (portHalfWidth - scale(0.0015)),
        portCenterX + (portHalfWidth - scale(0.0015)),
        centerY - (portHalfHeight + scale(0.0045)),
        centerY - (portHalfHeight - scale(0.0005)),
        scale(-0.124),
        scale(-0.09),
      );

      CharacterNodeRenderer.addCuboid(
        frames,
        portCenterX - (portHalfWidth + scale(0.0065)),
        portCenterX - (portHalfWidth + scale(0.0035)),
        centerY - (portHalfHeight + scale(0.0065)),
        centerY + (portHalfHeight + scale(0.0065)),
        scale(-0.092),
        scale(-0.085),
      );
      CharacterNodeRenderer.addCuboid(
        frames,
        portCenterX + (portHalfWidth + scale(0.0035)),
        portCenterX + (portHalfWidth + scale(0.0065)),
        centerY - (portHalfHeight + scale(0.0065)),
        centerY + (portHalfHeight + scale(0.0065)),
        scale(-0.092),
        scale(-0.085),
      );
      CharacterNodeRenderer.addCuboid(
        frames,
        portCenterX - (portHalfWidth + scale(0.0035)),
        portCenterX + (portHalfWidth + scale(0.0035)),
        centerY + (portHalfHeight + scale(0.0035)),
        centerY + (portHalfHeight + scale(0.0065)),
        scale(-0.092),
        scale(-0.085),
      );
      CharacterNodeRenderer.addCuboid(
        frames,
        portCenterX - (portHalfWidth + scale(0.0035)),
        portCenterX + (portHalfWidth + scale(0.0035)),
        centerY - (portHalfHeight + scale(0.0065)),
        centerY - (portHalfHeight + scale(0.0035)),
        scale(-0.092),
        scale(-0.085),
      );

      CharacterNodeRenderer.addCuboid(
        interiors,
        portCenterX - (portHalfWidth - scale(0.0085)),
        portCenterX + (portHalfWidth - scale(0.0085)),
        centerY - (portHalfHeight - scale(0.007)),
        centerY + (portHalfHeight - scale(0.007)),
        scale(-0.131),
        scale(-0.124),
      );
      CharacterNodeRenderer.addCuboid(
        interiors,
        portCenterX - (portHalfWidth - scale(0.0125)),
        portCenterX + (portHalfWidth - scale(0.0125)),
        centerY + scale(0.010),
        centerY + scale(0.017),
        scale(-0.115),
        scale(-0.101),
      );
      CharacterNodeRenderer.addCuboid(
        interiors,
        portCenterX - (portHalfWidth - scale(0.005)),
        portCenterX - (portHalfWidth - scale(0.0015)),
        centerY - (portHalfHeight - scale(0.0035)),
        centerY + (portHalfHeight - scale(0.0035)),
        scale(-0.123),
        scale(-0.094),
      );
      CharacterNodeRenderer.addCuboid(
        interiors,
        portCenterX + (portHalfWidth - scale(0.0015)),
        portCenterX + (portHalfWidth - scale(0.005)),
        centerY - (portHalfHeight - scale(0.0035)),
        centerY + (portHalfHeight - scale(0.0035)),
        scale(-0.123),
        scale(-0.094),
      );
      CharacterNodeRenderer.addCuboid(
        interiors,
        portCenterX - (portHalfWidth - scale(0.005)),
        portCenterX + (portHalfWidth - scale(0.005)),
        centerY - (portHalfHeight - scale(0.0035)),
        centerY - (portHalfHeight - scale(0.0005)),
        scale(-0.123),
        scale(-0.094),
      );
      CharacterNodeRenderer.addCuboid(
        interiors,
        portCenterX - (portHalfWidth - scale(0.0065)),
        portCenterX + (portHalfWidth - scale(0.0065)),
        centerY + (portHalfHeight - scale(0.001)),
        centerY + (portHalfHeight + scale(0.0025)),
        scale(-0.121),
        scale(-0.098),
      );

      CharacterNodeRenderer.addCuboid(
        leds,
        portCenterX - (portHalfWidth + scale(0.020)),
        portCenterX - (portHalfWidth + scale(0.013)),
        centerY + scale(0.012),
        centerY + scale(0.020),
        scale(-0.0915),
        scale(-0.0865),
      );
      CharacterNodeRenderer.addCuboid(
        leds,
        portCenterX - (portHalfWidth + scale(0.020)),
        portCenterX - (portHalfWidth + scale(0.013)),
        centerY - scale(0.020),
        centerY - scale(0.012),
        scale(-0.0915),
        scale(-0.0865),
      );

      CharacterNodeRenderer.addCuboid(
        contacts,
        portCenterX - (portHalfWidth - scale(0.0105)),
        portCenterX + (portHalfWidth - scale(0.0105)),
        centerY + scale(0.0135),
        centerY + scale(0.0175),
        scale(-0.1235),
        scale(-0.1155),
      );

      for (let pinIndex = 0; pinIndex < 8; pinIndex++) {
        const contactPinSpacing = scale(0.0092);
        const pinX =
          portCenterX - ((contactPinSpacing * 7) / 2) + pinIndex * contactPinSpacing;
        CharacterNodeRenderer.addCuboid(
          contacts,
          pinX - scale(0.0011),
          pinX + scale(0.0011),
          centerY + scale(0.0015),
          centerY + scale(0.0175),
          scale(-0.123),
          scale(-0.1145),
        );
      }
    }

    return { body, topCube, frames, interiors, contacts, leds };
  }

  private static createRenderingInfo(
    meshData: RemoteMeshData,
    positionAttributeLocation: GLint,
    normalAttributeLocation: GLint,
    gl: WebGL2RenderingContext,
  ): NodeRenderingInfo {
    const vertexArray = GlUtil.createAndBindVertexArray(gl);
    GlUtil.bindPositions(meshData.positions, positionAttributeLocation, gl);
    const useUInt32 = meshData.positions.length / 3 > 65535;
    GlUtil.bindIndices(meshData.indices, gl, useUInt32);
    GlUtil.bindNormals(meshData.normals, normalAttributeLocation, gl);

    return {
      numIndices: meshData.indices.length,
      indexType: useUInt32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
      vertexArray,
    };
  }

  private drawMesh(
    renderingInfo: NodeRenderingInfo,
    diffuseColor: [number, number, number],
    specularColor: [number, number, number],
    specularExponent: number,
    gl: WebGL2RenderingContext,
  ): void {
    gl.uniform3fv(this.materialDiffuseColorUniformLocation, diffuseColor);
    gl.uniform3fv(this.materialSpecularColorUniformLocation, specularColor);
    gl.uniform1f(this.materialSpecularExponentUniformLocation, specularExponent);

    gl.bindVertexArray(renderingInfo.vertexArray);
    gl.drawElements(gl.TRIANGLES, renderingInfo.numIndices, renderingInfo.indexType, 0);
  }

  public async init(nodes: CharacterNode[]): Promise<void> {
    const gl = GlContext.gl;

    this.shader = ShaderFactory.createShader(
      CharacterNodeRenderer.VERTEX_SHADER,
      CharacterNodeRenderer.FRAGMENT_SHADER,
      CharacterNodeRenderer.SHADER_LIGHT_SETTINGS,
      gl,
    );
    [
      this.viewMatrixUniformLocation,
      this.modelViewMatrixUniformLocation,
      this.projectionMatrixUniformLocation,
      this.normalMatrixUniformLocation,
      this.materialDiffuseColorUniformLocation,
      this.materialSpecularColorUniformLocation,
      this.materialSpecularExponentUniformLocation,
    ] = Shaders.getUniformLocations(
      this.shader,
      gl,
      "u_ViewMatrix",
      "u_ModelViewMatrix",
      "u_ProjectionMatrix",
      "u_NormalMatrix",
      "u_MaterialDiffuseColor",
      "u_MaterialSpecularColor",
      "u_MaterialSpecularExponent",
    );
    const [positionAttributeLocation, normalAttributeLocation] =
      Shaders.getAttributeLocations(this.shader, gl, "a_Position", "a_Normal");

    const switchMeshes = CharacterNodeRenderer.createSwitchMeshes();

    this.bodyRenderingInfo = CharacterNodeRenderer.createRenderingInfo(
      switchMeshes.body,
      positionAttributeLocation,
      normalAttributeLocation,
      gl,
    );
    this.topCubeRenderingInfo = CharacterNodeRenderer.createRenderingInfo(
      switchMeshes.topCube,
      positionAttributeLocation,
      normalAttributeLocation,
      gl,
    );
    this.frameRenderingInfo = CharacterNodeRenderer.createRenderingInfo(
      switchMeshes.frames,
      positionAttributeLocation,
      normalAttributeLocation,
      gl,
    );
    this.interiorRenderingInfo = CharacterNodeRenderer.createRenderingInfo(
      switchMeshes.interiors,
      positionAttributeLocation,
      normalAttributeLocation,
      gl,
    );
    this.contactRenderingInfo = CharacterNodeRenderer.createRenderingInfo(
      switchMeshes.contacts,
      positionAttributeLocation,
      normalAttributeLocation,
      gl,
    );
    this.ledRenderingInfo = CharacterNodeRenderer.createRenderingInfo(
      switchMeshes.leds,
      positionAttributeLocation,
      normalAttributeLocation,
      gl,
    );

    await Promise.all(
      nodes
        .filter((node) => !!node.remoteMesh)
        .map(async (node) => {
          try {
            const descriptor = node.remoteMesh as RemoteMeshDescriptor;
            const remoteMesh = await RemoteMeshLoader.load(descriptor);
            const parts = remoteMesh.parts.map((part) => ({
              diffuseColor: part.diffuseColor,
              renderingInfo: CharacterNodeRenderer.createRenderingInfo(
                part,
                positionAttributeLocation,
                normalAttributeLocation,
                gl,
              ),
            }));
            this.remoteMeshEntries.set(node, { descriptor, parts });
          } catch (error) {
            console.error("Could not load remote mesh for character node", error);
          }
        }),
    );
  }

  public prepareDrawing(): void {
    const gl = GlContext.gl;

    gl.enable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    gl.useProgram(this.shader);
    gl.uniformMatrix4fv(
      this.projectionMatrixUniformLocation,
      false,
      GlContext.perspectiveMatrix,
    );
    gl.uniformMatrix4fv(this.viewMatrixUniformLocation, false, GlContext.viewMatrix);
  }

  public draw(node: CharacterNode): void {
    const gl = GlContext.gl;

    gl.uniformMatrix4fv(
      this.modelViewMatrixUniformLocation,
      false,
      GlContext.modelViewMatrix.current,
    );
    gl.uniformMatrix4fv(
      this.normalMatrixUniformLocation,
      true,
      Matrices.invert(GlContext.modelViewMatrix.current) ??
        GlContext.modelViewMatrix.current,
    );

    const remoteMeshEntry = this.remoteMeshEntries.get(node);
    if (remoteMeshEntry) {
      remoteMeshEntry.parts.forEach((part) => {
        const diffuseColor =
          remoteMeshEntry.descriptor.diffuseColor ??
          part.diffuseColor ??
          [1.0, 0.5, 0.0];
        const specularColor =
          remoteMeshEntry.descriptor.specularColor ??
          createSpecularColor(diffuseColor);

        this.drawMesh(
          part.renderingInfo,
          diffuseColor,
          specularColor,
          remoteMeshEntry.descriptor.specularExponent ?? 22,
          gl,
        );
      });
      return;
    }

    if (node.joint !== CharacterJoint.ROOT) {
      return;
    }

    this.drawMesh(this.bodyRenderingInfo, [1.0, 0.5, 0.0], [1.0, 0.6, 0.2], 14, gl);
    this.drawMesh(this.topCubeRenderingInfo, [0.05, 0.05, 0.05], [0.1, 0.1, 0.1], 18, gl);
    this.drawMesh(this.frameRenderingInfo, [0.95, 0.95, 0.92], [0.55, 0.55, 0.52], 12, gl);
    this.drawMesh(this.interiorRenderingInfo, [0.06, 0.06, 0.07], [0.18, 0.18, 0.2], 10, gl);
    this.drawMesh(
      this.contactRenderingInfo,
      [0.82, 0.69, 0.18],
      [0.95, 0.86, 0.38],
      34,
      gl,
    );
    this.drawMesh(this.ledRenderingInfo, [0.2, 0.82, 0.24], [0.52, 0.95, 0.55], 40, gl);
  }
}

function createSpecularColor(diffuseColor: MaterialColor): MaterialColor {
  return [
    Math.min(diffuseColor[0] + 0.2, 1.0),
    Math.min(diffuseColor[1] + 0.2, 1.0),
    Math.min(diffuseColor[2] + 0.2, 1.0),
  ];
}