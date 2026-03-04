import { GlContext } from "../../gl/gl-context.ts";
import { CharacterNode } from "./character-node.ts";
import { GlUtil } from "../../gl/gl-util.ts";
import { ShaderFactory, ShaderLightSettings } from "../shader-factory.ts";
import { Shaders } from "../../gl/shaders.ts";
import { Matrices } from "../../math/matrices.ts";
import { CharacterJoint } from "./character-joint.ts";

type NodeRenderingInfo = {
  numIndices: number;
  vertexArray: WebGLVertexArrayObject;
};

type MeshData = {
  positions: number[];
  normals: number[];
  indices: number[];
};

type SwitchMeshes = {
  body: MeshData;
  cavities: MeshData;
  contacts: MeshData;
};

export class CharacterNodeRenderer {
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

  private bodyRenderingInfo: NodeRenderingInfo;
  private cavityRenderingInfo: NodeRenderingInfo;
  private contactRenderingInfo: NodeRenderingInfo;

  private shader: WebGLProgram;

  private viewMatrixUniformLocation: WebGLUniformLocation;
  private modelViewMatrixUniformLocation: WebGLUniformLocation;
  private projectionMatrixUniformLocation: WebGLUniformLocation;
  private normalMatrixUniformLocation: WebGLUniformLocation;
  private materialDiffuseColorUniformLocation: WebGLUniformLocation;
  private materialSpecularColorUniformLocation: WebGLUniformLocation;
  private materialSpecularExponentUniformLocation: WebGLUniformLocation;

  private static addCuboid(
    meshData: MeshData,
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
    const body: MeshData = { positions: [], normals: [], indices: [] };
    const cavities: MeshData = { positions: [], normals: [], indices: [] };
    const contacts: MeshData = { positions: [], normals: [], indices: [] };

    CharacterNodeRenderer.addCuboid(body, -0.16, 0.16, -0.34, 0.34, -0.09, 0.09);
    CharacterNodeRenderer.addCuboid(body, -0.145, 0.145, -0.29, 0.31, 0.09, 0.105);
    CharacterNodeRenderer.addCuboid(body, -0.06, 0.06, 0.34, 0.40, -0.035, 0.035);

    // Back RJ45 panel area: 5 ports stacked vertically (like reference image)
    CharacterNodeRenderer.addCuboid(body, -0.118, 0.118, -0.31, 0.27, -0.109, -0.09);

    const portCenterX = 0;
    const topPortCenterY = 0.205;
    const portStepY = 0.112;
    const portHalfWidth = 0.072;
    const portHalfHeight = 0.036;

    for (let portIndex = 0; portIndex < 5; portIndex++) {
      const centerY = topPortCenterY - portIndex * portStepY;

      // Opening frame walls (square-ish mouth)
      CharacterNodeRenderer.addCuboid(
        cavities,
        portCenterX - (portHalfWidth + 0.004),
        portCenterX - (portHalfWidth - 0.002),
        centerY - (portHalfHeight + 0.004),
        centerY + (portHalfHeight + 0.004),
        -0.124,
        -0.09,
      );
      CharacterNodeRenderer.addCuboid(
        cavities,
        portCenterX + (portHalfWidth - 0.002),
        portCenterX + (portHalfWidth + 0.004),
        centerY - (portHalfHeight + 0.004),
        centerY + (portHalfHeight + 0.004),
        -0.124,
        -0.09,
      );
      CharacterNodeRenderer.addCuboid(
        cavities,
        portCenterX - (portHalfWidth - 0.002),
        portCenterX + (portHalfWidth - 0.002),
        centerY + (portHalfHeight - 0.001),
        centerY + (portHalfHeight + 0.004),
        -0.124,
        -0.09,
      );
      CharacterNodeRenderer.addCuboid(
        cavities,
        portCenterX - (portHalfWidth - 0.002),
        portCenterX + (portHalfWidth - 0.002),
        centerY - (portHalfHeight + 0.004),
        centerY - (portHalfHeight - 0.001),
        -0.124,
        -0.09,
      );

      // Deep back plate inside cavity
      CharacterNodeRenderer.addCuboid(
        cavities,
        portCenterX - (portHalfWidth - 0.010),
        portCenterX + (portHalfWidth - 0.010),
        centerY - (portHalfHeight - 0.008),
        centerY + (portHalfHeight - 0.008),
        -0.128,
        -0.123,
      );

      // Upper latch shelf inside cavity
      CharacterNodeRenderer.addCuboid(
        cavities,
        portCenterX - (portHalfWidth - 0.014),
        portCenterX + (portHalfWidth - 0.014),
        centerY + 0.012,
        centerY + 0.019,
        -0.114,
        -0.101,
      );

      // Gold contact rail
      CharacterNodeRenderer.addCuboid(
        contacts,
        portCenterX - (portHalfWidth - 0.017),
        portCenterX + (portHalfWidth - 0.017),
        centerY + 0.015,
        centerY + 0.018,
        -0.125,
        -0.119,
      );

      // Eight contact pins
      for (let pinIndex = 0; pinIndex < 8; pinIndex++) {
        const pinX = portCenterX - 0.046 + pinIndex * 0.013;
        CharacterNodeRenderer.addCuboid(
          contacts,
          pinX - 0.0018,
          pinX + 0.0018,
          centerY + 0.003,
          centerY + 0.018,
          -0.1245,
          -0.1185,
        );
      }
    }

    return { body, cavities, contacts };
  }

  private static createRenderingInfo(
    meshData: MeshData,
    positionAttributeLocation: GLint,
    normalAttributeLocation: GLint,
    gl: WebGL2RenderingContext,
  ): NodeRenderingInfo {
    const vertexArray = GlUtil.createAndBindVertexArray(gl);
    GlUtil.bindPositions(meshData.positions, positionAttributeLocation, gl);
    GlUtil.bindIndices(meshData.indices, gl);
    GlUtil.bindNormals(meshData.normals, normalAttributeLocation, gl);

    return {
      numIndices: meshData.indices.length,
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
    gl.drawElements(gl.TRIANGLES, renderingInfo.numIndices, gl.UNSIGNED_SHORT, 0);
  }

  public async init(): Promise<void> {
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
    this.cavityRenderingInfo = CharacterNodeRenderer.createRenderingInfo(
      switchMeshes.cavities,
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
    gl.uniformMatrix4fv(
      this.viewMatrixUniformLocation,
      false,
      GlContext.viewMatrix,
    );
  }

  public draw(node: CharacterNode): void {
    if (node.joint !== CharacterJoint.ROOT) {
      return;
    }

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

    this.drawMesh(
      this.bodyRenderingInfo,
      [0.17, 0.17, 0.19],
      [0.35, 0.35, 0.4],
      14,
      gl,
    );
    this.drawMesh(
      this.cavityRenderingInfo,
      [0.17, 0.17, 0.18],
      [0.22, 0.22, 0.24],
      8,
      gl,
    );
    this.drawMesh(
      this.contactRenderingInfo,
      [0.64, 0.52, 0.14],
      [0.85, 0.75, 0.3],
      26,
      gl,
    );
  }
}
