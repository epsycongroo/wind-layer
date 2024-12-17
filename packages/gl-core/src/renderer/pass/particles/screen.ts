import type { Renderer } from '@sakitam-gis/vis-engine';
import { BlendType, Geometry, Mesh, Program } from '@sakitam-gis/vis-engine';
import Pass from '../base';
import { littleEndian } from '../../../utils/common';
import vert from '../../../shaders/common.vert.glsl';
import frag from '../../../shaders/particles/screen.frag.glsl';
import * as shaderLib from '../../../shaders/shaderLib';
import type { BandType } from '../../../type';
import type { SourceType } from '../../../source';
import type ParticlesPass from './particles';

export interface ScreenPassOptions {
  source: SourceType;
  bandType: BandType;
  prerender: boolean;
  enableBlend: boolean;
  particlesPass?: ParticlesPass;
}

export default class ScreenPass extends Pass<ScreenPassOptions> {
  public prerender: boolean;

  private program: WithNull<Program>;
  private mesh: WithNull<Mesh>;
  private geometry: WithNull<Geometry>;

  constructor(id: string, renderer: Renderer, options: ScreenPassOptions = {} as ScreenPassOptions) {
    super(id, renderer, options);
    this.prerender = Boolean(options.prerender);

    this.program = new Program(renderer, {
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        opacity: {
          value: 1,
        },
        u_fade: {
          value: 1,
        },
        u_screen: {
          value: null,
        },
      },
      defines: [`RENDER_TYPE ${this.options.bandType}`, `LITTLE_ENDIAN ${littleEndian}`],
      includes: shaderLib,
      transparent: true,
      blending: options.enableBlend ? BlendType.CustomBlending : BlendType.NoBlending,
      blendFunc: {
        src: this.renderer.gl.ONE,
        dst: this.renderer.gl.ONE_MINUS_SRC_ALPHA,
      },
      blendEquation: {
        modeAlpha: this.renderer.gl.FUNC_ADD,
        modeRGB: this.renderer.gl.FUNC_ADD,
      },
    });

    this.geometry = new Geometry(renderer, {
      position: {
        size: 2,
        data: new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
      },
      uv: {
        size: 2,
        data: new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
      },
      index: {
        size: 1,
        data: new Uint16Array([0, 1, 2, 2, 1, 3]),
      },
    });

    this.mesh = new Mesh(renderer, {
      mode: renderer.gl.TRIANGLES,
      program: this.program,
      geometry: this.geometry,
    });
  }

  get renderTarget() {
    if (this.options.particlesPass && this.prerender) {
      return this.options.particlesPass.renderTarget;
    }
  }

  /**
   * @param rendererParams
   * @param rendererState
   */
  render(rendererParams, rendererState) {
    if (this.renderTarget) {
      this.renderTarget.bind();
      this.renderer.setViewport(this.renderTarget.width, this.renderTarget.height);
    } else {
      const attr = this.renderer.attributes;
      this.renderer.setViewport(this.renderer.width * attr.dpr, this.renderer.height * attr.dpr);
    }
    if (rendererState && this.mesh) {
      const camera = rendererParams.cameras.planeCamera;
      this.mesh.program.setUniform('u_fade', 1);
      this.mesh.program.setUniform('u_opacity', this.prerender ? rendererState.fadeOpacity : rendererState.opacity);
      this.mesh.program.setUniform(
        'u_screen',
        this.prerender
          ? this.options.particlesPass?.textures.backgroundTexture
          : this.options.particlesPass?.textures.screenTexture,
      );

      this.mesh.updateMatrix();
      this.mesh.worldMatrixNeedsUpdate = false;
      this.mesh.worldMatrix.multiply(camera.worldMatrix, this.mesh.localMatrix);
      this.mesh.draw({
        ...rendererParams,
        camera,
      });
    }

    if (this.renderTarget) {
      this.renderTarget.unbind();
    }

    if (this.options.particlesPass && !this.prerender) {
      this.options.particlesPass?.swapRenderTarget();
    }
  }

  destroy() {
    if (this.mesh) {
      this.mesh.destroy();
      this.mesh = null;
    }

    if (this.program) {
      this.program.destroy();
      this.program = null;
    }

    if (this.geometry) {
      this.geometry.destroy();
      this.geometry = null;
    }
  }
}
