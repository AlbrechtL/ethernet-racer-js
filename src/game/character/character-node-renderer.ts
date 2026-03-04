import { GlContext } from "../../gl/gl-context.ts";
import { CharacterNode } from "./character-node.ts";
import { GlUtil } from "../../gl/gl-util.ts";
import { ShaderFactory, ShaderLightSettings } from "../shader-factory.ts";
import { Shaders } from "../../gl/shaders.ts";
import { Matrices } from "../../math/matrices.ts";

type NodeRenderingInfo = {
  numIndices: number;
  vertexArray: WebGLVertexArrayObject;
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

  private static readonly BOX_POSITIONS: number[] = [
    // Front
    -0.5, -0.5, 0.5,
    0.5, -0.5, 0.5,
    0.5, 0.5, 0.5,
    -0.5, 0.5, 0.5,
    // Back
    0.5, -0.5, -0.5,
    -0.5, -0.5, -0.5,
    -0.5, 0.5, -0.5,
    0.5, 0.5, -0.5,
    // Left
    -0.5, -0.5, -0.5,
    -0.5, -0.5, 0.5,
    -0.5, 0.5, 0.5,
    -0.5, 0.5, -0.5,
    // Right
    0.5, -0.5, 0.5,
    0.5, -0.5, -0.5,
    0.5, 0.5, -0.5,
    0.5, 0.5, 0.5,
    // Top
    -0.5, 0.5, 0.5,
    0.5, 0.5, 0.5,
    0.5, 0.5, -0.5,
    -0.5, 0.5, -0.5,
    // Bottom
    -0.5, -0.5, -0.5,
    0.5, -0.5, -0.5,
    0.5, -0.5, 0.5,
    -0.5, -0.5, 0.5,
  ];

  private static readonly BOX_NORMALS: number[] = [
    // Front
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    // Back
    0, 0, -1,
    0, 0, -1,
    0, 0, -1,
    0, 0, -1,
    // Left
    -1, 0, 0,
    -1, 0, 0,
    -1, 0, 0,
    -1, 0, 0,
    // Right
    1, 0, 0,
    1, 0, 0,
    1, 0, 0,
    1, 0, 0,
    // Top
    0, 1, 0,
    0, 1, 0,
    0, 1, 0,
    0, 1, 0,
    // Bottom
    0, -1, 0,
    0, -1, 0,
    0, -1, 0,
    0, -1, 0,
  ];

  private static readonly BOX_INDICES: number[] = [
    0, 1, 2, 0, 2, 3,
    4, 5, 6, 4, 6, 7,
    8, 9, 10, 8, 10, 11,
    12, 13, 14, 12, 14, 15,
    16, 17, 18, 16, 18, 19,
    20, 21, 22, 20, 22, 23,
  ];

  private renderingInfo: NodeRenderingInfo;

  private shader: WebGLProgram;

  private viewMatrixUniformLocation: WebGLUniformLocation;
  private modelViewMatrixUniformLocation: WebGLUniformLocation;
  private projectionMatrixUniformLocation: WebGLUniformLocation;
  private normalMatrixUniformLocation: WebGLUniformLocation;
  private materialDiffuseColorUniformLocation: WebGLUniformLocation;
  private materialSpecularColorUniformLocation: WebGLUniformLocation;
  private materialSpecularExponentUniformLocation: WebGLUniformLocation;

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

    const vertexArray = GlUtil.createAndBindVertexArray(gl);
    GlUtil.bindPositions(
      CharacterNodeRenderer.BOX_POSITIONS,
      positionAttributeLocation,
      gl,
    );
    GlUtil.bindIndices(CharacterNodeRenderer.BOX_INDICES, gl);
    GlUtil.bindNormals(
      CharacterNodeRenderer.BOX_NORMALS,
      normalAttributeLocation,
      gl,
    );

    this.renderingInfo = {
      numIndices: CharacterNodeRenderer.BOX_INDICES.length,
      vertexArray,
    };
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
    if (!node.isVisible || !node.material) {
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
    gl.uniform3fv(
      this.materialDiffuseColorUniformLocation,
      node.material.diffuseColor,
    );
    gl.uniform3fv(
      this.materialSpecularColorUniformLocation,
      node.material.specularColor,
    );
    gl.uniform1f(
      this.materialSpecularExponentUniformLocation,
      node.material.specularExponent,
    );

    gl.bindVertexArray(this.renderingInfo.vertexArray);
    gl.drawElements(
      gl.TRIANGLES,
      this.renderingInfo.numIndices,
      gl.UNSIGNED_SHORT,
      0,
    );
  }
}
