import type { Renderer, Attributes } from '@jokkicn/vis-engine';
import { Program, Mesh, Geometry } from '@jokkicn/vis-engine';
import Pass from './base';
import maskVert from '../../shaders/mask.vert.glsl';
import maskFrag from '../../shaders/mask.frag.glsl';
import * as shaderLib from '../../shaders/shaderLib';
import { MaskType } from '../../type';

export interface MaskPassOptions {
  mask?: {
    data: Attributes[];
    type: MaskType;
  };
}

/**
 * 遮罩
 */
export default class MaskPass extends Pass<MaskPassOptions> {
  private readonly program: Program;
  readonly prerender = true;

  private meshes: Mesh[];

  constructor(id: string, renderer: Renderer, options: MaskPassOptions = {} as MaskPassOptions) {
    super(id, renderer, options);

    this.program = new Program(renderer, {
      vertexShader: maskVert,
      fragmentShader: maskFrag,
      includes: shaderLib,
      transparent: true,
    });

    this.meshes = [];

    this.updateGeometry();
  }

  updateGeometry() {
    const { mask } = this.options;

    if (!mask || mask.data.length === 0) return;

    const len = mask.data.length;
    let i = 0;

    for (let k = 0; k < this.meshes.length; k++) {
      const mesh = this.meshes[k];

      // 只销毁 Geometry
      if (mesh.geometry) {
        mesh.geometry.destroy();
      }
    }

    this.meshes = [];
    for (; i < len; i++) {
      const attributes = mask.data[i];

      this.meshes.push(
        new Mesh(this.renderer, {
          mode: this.renderer.gl.TRIANGLES,
          program: this.program,
          geometry: new Geometry(this.renderer, attributes),
        }),
      );
    }
  }

  /**
   * @param rendererParams
   * @param rendererState
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  render(rendererParams, rendererState) {
    const attr = this.renderer.attributes;
    this.renderer.setViewport(this.renderer.width * attr.dpr, this.renderer.height * attr.dpr);
    const { worlds = [0] } = rendererParams.cameras;
    const stencil = this.renderer.gl.getParameter(this.renderer.gl.STENCIL_TEST);
    if (!stencil) {
      this.renderer.state.enable(this.renderer.gl.STENCIL_TEST);
    }

    this.renderer.gl.stencilFunc(this.renderer.gl.ALWAYS, 1, 0xff);
    this.renderer.gl.stencilOp(this.renderer.gl.REPLACE, this.renderer.gl.REPLACE, this.renderer.gl.REPLACE);
    this.renderer.gl.stencilMask(0xff); // 模板允许写入

    this.renderer.gl.clearStencil(0); // 置为 0
    this.renderer.gl.clear(this.renderer.gl.STENCIL_BUFFER_BIT);
    // 0 0 0 0 0
    // 0 0 0 0 0
    // 0 0 0 0 0
    // 0 0 0 0 0
    // 0 0 0 0 0

    for (let k = 0; k < this.meshes.length; k++) {
      const mesh = this.meshes[k];

      for (let j = 0; j < worlds.length; j++) {
        mesh.program.setUniform('u_offset', worlds[j]);

        mesh.updateMatrix();
        mesh.worldMatrixNeedsUpdate = false;
        mesh.worldMatrix.multiply(rendererParams.scene.worldMatrix, mesh.localMatrix);
        mesh.draw({
          ...rendererParams,
          camera: rendererParams.cameras.camera,
        });
      }
    }
    // 0 0 0 0 0
    // 0 1 1 1 0
    // 0 1 1 1 0
    // 0 1 1 1 0
    // 0 0 0 0 0

    const ref = this.options.mask?.type === MaskType.outside ? 0 : 1;

    // ref 为 0 / 1 的通过测试 @fixme 会与瓦片模板测试冲突
    this.renderer.gl.stencilFunc(this.renderer.gl.EQUAL, ref, 0xff);
    this.renderer.gl.stencilOp(this.renderer.gl.KEEP, this.renderer.gl.KEEP, this.renderer.gl.KEEP);

    return stencil;
  }
}
