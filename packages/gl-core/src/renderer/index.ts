import type { Attributes, Renderer, Scene } from '@jokkicn/vis-engine';
import { DataTexture, Raf, utils, Vector2 } from '@jokkicn/vis-engine';
import wgw from 'wind-gl-worker';
import Pipelines from './Pipelines';
import ColorizeComposePass from './pass/color/compose';
import ColorizePass from './pass/color/colorize';
import RasterPass from './pass/raster/image';
import RasterComposePass from './pass/raster/compose';
import ParticlesComposePass from './pass/particles/compose';
import UpdatePass from './pass/particles/update';
import ScreenPass from './pass/particles/screen';
import ParticlesPass from './pass/particles/particles';
import PickerPass from './pass/picker';
import { isFunction, resolveURL } from '../utils/common';
import {createLinearGradient, createZoom, isRasterize} from '../utils/style-parser';
import type { MaskType } from '../type';
import { getBandType, RenderFrom, RenderType } from '../type';
import type { SourceType } from '../source';
import type Tile from '../tile/Tile';
import type TileID from '../tile/TileID';
import MaskPass from './pass/mask';
import ArrowComposePass from './pass/arrow/compose';
import ArrowPass from './pass/arrow/arrow';
// import ComposeRenderPass from './pass/particles/compose-test';

export interface UserOptions {
  /**
   * 渲染类型
   * 目前支持三种类型：
   * 0：普通 raster 瓦片渲染
   * 1：气象数据的色斑图渲染
   * 2：风等 vector 数据的粒子渲染
   */
  renderType: RenderType;
  /**
   * 指定渲染通道
   */
  renderFrom?: RenderFrom;
  styleSpec?: {
    'fill-color'?: any[];
    opacity?: number | any[];
    numParticles?: number | any[];
    speedFactor?: number | any[];
    fadeOpacity?: number | any[];
    dropRate?: number | any[];
    dropRateBump?: number | any[];

    /**
     * arrow space
     */
    space?: number | any[];

    /**
     * arrow size
     */
    size?: [number, number];
  };

  displayRange?: [number, number];
  widthSegments?: number;
  heightSegments?: number;
  wireframe?: boolean;

  flipY?: boolean;

  /**
   * 是否开启拾取
   */
  picking?: boolean;
  /**
   * 可以为任意 GeoJSON 数据
   */
  mask?: {
    data: Attributes[];
    type: MaskType;
  };
}

export interface BaseLayerOptions extends UserOptions {
  /**
   * 获取当前视野内的瓦片
   */
  getViewTiles: (data: any, renderType: RenderType) => TileID[];

  /**
   * 这里我们 Mock 一个瓦片图层，用于获取视野内的所有可渲染瓦片，与getViewTiles不同的是
   * 此方法不会限制层级，方便我们在大层级时也能合理采样
   */
  getGridTiles: (source: SourceType) => TileID[];

  /**
   * 获取某层级下瓦片的投影宽高
   * @param z
   */
  getTileProjSize: (z: number, tiles: TileID[]) => [number, number];

  /**
   * 获取当前视图下像素和投影的转换关系
   */
  getPixelsToUnits: () => [number, number];

  /**
   * 像素到投影坐标的转换关系
   */
  getPixelsToProjUnit: () => [number, number];

  getZoom?: () => number;
  getExtent?: () => number[];
  triggerRepaint?: () => void;
  flipY?: boolean;

  glScale?: () => number;
  zoomScale?: () => number;
  onInit?: (error, data) => void;
}

export const defaultOptions: BaseLayerOptions = {
  getViewTiles: () => [],
  getGridTiles: () => [],
  getTileProjSize: (z) => [256, 256], // eslint-disable-line
  getPixelsToUnits: () => [1, 1],
  getPixelsToProjUnit: () => [1, 1],
  renderType: RenderType.colorize,
  renderFrom: RenderFrom.r,
  styleSpec: {
    'fill-color': [
      'interpolate',
      ['linear'],
      ['get', 'value'],
      0.0,
      '#3288bd',
      10,
      '#66c2a5',
      20,
      '#abdda4',
      30,
      '#e6f598',
      40,
      '#fee08b',
      50,
      '#fdae61',
      60,
      '#f46d43',
      100.0,
      '#d53e4f',
    ],
    opacity: 1,
    numParticles: 65535,
    speedFactor: 1,
    fadeOpacity: 0.93,
    dropRate: 0.003,
    dropRateBump: 0.002,
    space: 20,
    size: [16, 16],
  },
  displayRange: [Infinity, Infinity],
  widthSegments: 1,
  heightSegments: 1,
  wireframe: false,
  flipY: false,
  glScale: () => 1,
  zoomScale: () => 1,
  onInit: () => undefined,
};

/**
 * 因为使用的是共享 worker 所以外部依赖仅需要注册一次
 */
let registerDeps = false;

export default class BaseLayer {
  private options: BaseLayerOptions;
  private readonly uid: string;
  private renderPipeline: WithNull<Pipelines>;
  private readonly scene: Scene;
  private readonly renderer: Renderer;
  private readonly dispatcher: any;
  private readonly source: SourceType;
  private raf: Raf;
  private sharedState: {
    u_bbox: [number, number, number, number];
    u_data_bbox: [number, number, number, number];
    u_scale: [number, number];
  };

  private opacity: number;
  private numParticles: number;
  private speedFactor: number;
  private fadeOpacity: number;
  private dropRate: number;
  private dropRateBump: number;
  private space: number;
  private size: [number, number];
  private colorRange: Vector2;
  private colorRampTexture: DataTexture;
  private nextStencilID: number;
  private maskPass: MaskPass;
  private isRasterize: boolean;

  constructor(source: SourceType, rs: { renderer: Renderer; scene: Scene }, options?: Partial<BaseLayerOptions>) {
    this.renderer = rs.renderer;
    this.scene = rs.scene;
    this.source = source;

    if (!this.renderer) {
      throw new Error('initialize error');
    }

    this.uid = utils.uid('ScalarFill');

    if (!options) {
      // eslint-disable-next-line no-param-reassign
      options = {} as BaseLayerOptions;
    }

    this.options = {
      ...defaultOptions,
      ...options,
      styleSpec: {
        ...defaultOptions.styleSpec,
        ...options.styleSpec,
      },
    };

    this.opacity = 1;

    this.nextStencilID = 1;

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    this.dispatcher = new wgw.Dispatcher(wgw.getGlobalWorkerPool(), this, this.uid);

    if (!registerDeps) {
      const deps = wgw.getConfigDeps();
      this.dispatcher.broadcast(
        'configDeps',
        deps.map((d) => resolveURL(d)),
        (err, data) => {
          this.options.onInit?.(err, data);
        },
      );
      registerDeps = true;
    }

    this.update = this.update.bind(this);
    this.onTileLoaded = this.onTileLoaded.bind(this);

    this.source.prepare(this.renderer, this.dispatcher, {
      renderFrom: this.options.renderFrom ?? RenderFrom.r,
    });
    this.source.onAdd(this);
    if (Array.isArray(this.source.sourceCache)) {
      this.source.sourceCache.forEach((s) => {
        s.on('update', this.update);
        s.on('tileLoaded', this.onTileLoaded);
      });
    } else {
      this.source.sourceCache.on('update', this.update);
      this.source.sourceCache.on('tileLoaded', this.onTileLoaded);
    }

    this.initialize();
  }

  initialize() {
    this.updateOptions({});
    this.sharedState = {
      u_bbox: [0, 0, 1, 1],
      u_data_bbox: [0, 0, 1, 1],
      u_scale: [1, 1],
    };
    this.renderPipeline = new Pipelines(this.renderer);
    const bandType = getBandType(this.options.renderFrom ?? RenderFrom.r);

    if (this.options.mask) {
      this.maskPass = new MaskPass('MaskPass', this.renderer, {
        mask: this.options.mask,
      });
    }

    if (this.options.renderType === RenderType.image) {
      const composePass = new RasterComposePass('RasterComposePass', this.renderer, {
        bandType,
        source: this.source,
        renderFrom: this.options.renderFrom ?? RenderFrom.r,
        maskPass: this.maskPass,
        stencilConfigForOverlap: this.stencilConfigForOverlap.bind(this),
      });
      const rasterPass = new RasterPass('RasterPass', this.renderer, {
        bandType,
        source: this.source,
        texture: composePass.textures.current,
        textureNext: composePass.textures.next,
      });
      this.renderPipeline?.addPass(composePass);
      if (this.options.picking) {
        const pickerPass = new PickerPass('PickerPass', this.renderer, {
          source: this.source,
          texture: composePass.textures.current,
          textureNext: composePass.textures.next,
          useFloatTexture: false,
        });
        this.renderPipeline?.addPass(pickerPass);
      }
      this.renderPipeline?.addPass(rasterPass);
    } else if (this.options.renderType === RenderType.colorize) {
      const composePass = new ColorizeComposePass('ColorizeComposePass', this.renderer, {
        bandType,
        source: this.source,
        renderFrom: this.options.renderFrom ?? RenderFrom.r,
        maskPass: this.maskPass,
        stencilConfigForOverlap: this.stencilConfigForOverlap.bind(this),
        isRasterize: () => this.isRasterize,
      });
      const colorizePass = new ColorizePass('ColorizePass', this.renderer, {
        bandType,
        source: this.source,
        texture: composePass.textures.current,
        textureNext: composePass.textures.next,
      });
      this.renderPipeline?.addPass(composePass);

      if (this.options.picking) {
        const pickerPass = new PickerPass('PickerPass', this.renderer, {
          source: this.source,
          texture: composePass.textures.current,
          textureNext: composePass.textures.next,
          useFloatTexture: true,
        });
        this.renderPipeline?.addPass(pickerPass);
      }

      this.renderPipeline?.addPass(colorizePass);
    } else if (this.options.renderType === RenderType.particles) {
      const composePass = new ParticlesComposePass('ParticlesComposePass', this.renderer, {
        id: utils.uid('ParticlesComposePass'),
        bandType,
        source: this.source,
        renderFrom: this.options.renderFrom ?? RenderFrom.r,
        stencilConfigForOverlap: this.stencilConfigForOverlap.bind(this),
        getTileProjSize: this.options.getTileProjSize,
      });
      this.renderPipeline?.addPass(composePass);

      const updatePass = new UpdatePass('UpdatePass', this.renderer, {
        bandType,
        source: this.source,
        texture: composePass.textures.current,
        textureNext: composePass.textures.next,
        getParticleNumber: () => this.numParticles,
        glScale: this.options.glScale?.() as number,
      });
      this.renderPipeline?.addPass(updatePass);

      const particlesPass = new ParticlesPass('ParticlesPass', this.renderer, {
        bandType,
        source: this.source,
        texture: composePass.textures.current,
        textureNext: composePass.textures.next,
        getParticles: () => updatePass.textures,
        getParticleNumber: () => this.numParticles,
        maskPass: this.maskPass,
      });

      const particlesTexturePass = new ScreenPass('ParticlesTexturePass', this.renderer, {
        bandType,
        source: this.source,
        prerender: true,
        enableBlend: false,
        particlesPass,
      });

      this.renderPipeline?.addPass(particlesTexturePass);
      this.renderPipeline?.addPass(particlesPass);

      const screenPass = new ScreenPass('ScreenPass', this.renderer, {
        bandType,
        source: this.source,
        prerender: false,
        enableBlend: true,
        particlesPass,
      });

      this.renderPipeline?.addPass(screenPass);

      this.raf = new Raf(
        () => {
          if (this.options.triggerRepaint) {
            this.options.triggerRepaint();
          }
        },
        { autoStart: true },
      );
    } else if (this.options.renderType === RenderType.arrow) {
      const composePass = new ArrowComposePass('ArrowComposePass', this.renderer, {
        id: utils.uid('ArrowComposePass'),
        bandType,
        source: this.source,
        renderFrom: this.options.renderFrom ?? RenderFrom.r,
        stencilConfigForOverlap: this.stencilConfigForOverlap.bind(this),
        getTileProjSize: this.options.getTileProjSize,
      });
      const arrowPass = new ArrowPass('ArrowPass', this.renderer, {
        bandType,
        source: this.source,
        texture: composePass.textures.current,
        textureNext: composePass.textures.next,
        getPixelsToUnits: this.options.getPixelsToUnits,
        getGridTiles: this.options.getGridTiles,
        maskPass: this.maskPass,
      });
      this.renderPipeline?.addPass(composePass);
      this.renderPipeline?.addPass(arrowPass);
    }
  }

  updateOptions(options: Partial<UserOptions>) {
    this.options = {
      ...this.options,
      ...options,
      styleSpec: {
        ...this.options.styleSpec,
        ...options?.styleSpec,
      },
    };

    this.buildColorRamp();
    this.parseStyleSpec(true);
    this.options?.triggerRepaint?.();
  }

  resize(width: number, height: number) {
    if (this.renderPipeline) {
      this.renderPipeline.resize(width, height);
    }
  }

  /**
   * 设置填色色阶
   */
  setFillColor() {
    this.buildColorRamp();
  }

  /**
   * 设置图层透明度
   * @param opacity
   */
  setOpacity(opacity: number) {
    this.opacity = opacity;
  }

  /**
   * 设置粒子图层的粒子数量
   * @param numParticles
   */
  setNumParticles(numParticles: number) {
    this.numParticles = numParticles;
  }

  /**
   * 设置粒子图层的粒子数量
   * @param speedFactor
   */
  setSpeedFactor(speedFactor: number) {
    this.speedFactor = speedFactor;
  }

  /**
   * 设置粒子图层的粒子数量
   * @param fadeOpacity
   */
  setFadeOpacity(fadeOpacity: number) {
    this.fadeOpacity = fadeOpacity;
  }

  /**
   * 设置粒子图层的粒子数量
   * @param dropRate
   */
  setDropRate(dropRate: number) {
    this.dropRate = dropRate;
  }

  /**
   * 设置粒子图层的粒子数量
   * @param dropRateBump
   */
  setDropRateBump(dropRateBump: number) {
    this.dropRateBump = dropRateBump;
  }

  /**
   * 设置 symbol 的间距
   * @param space
   */
  setSymbolSpace(space) {
    this.space = space;
  }

  /**
   * 设置 symbol 的大小
   * @param size
   */
  setSymbolSize(size) {
    this.size = size;
  }

  /**
   * 解析样式配置
   * @param clear
   */
  parseStyleSpec(clear) {
    if (isFunction(this.options.getZoom)) {
      const zoom = this.options.getZoom();
      this.setOpacity(createZoom(this.uid, zoom, 'opacity', this.options.styleSpec, clear));
      if (this.options.renderType === RenderType.particles) {
        this.setNumParticles(createZoom(this.uid, zoom, 'numParticles', this.options.styleSpec, clear));
        this.setFadeOpacity(createZoom(this.uid, zoom, 'fadeOpacity', this.options.styleSpec, clear));
        this.setSpeedFactor(createZoom(this.uid, zoom, 'speedFactor', this.options.styleSpec, clear));
        this.setDropRate(createZoom(this.uid, zoom, 'dropRate', this.options.styleSpec, clear));
        this.setDropRateBump(createZoom(this.uid, zoom, 'dropRateBump', this.options.styleSpec, clear));
      }

      if (this.options.renderType === RenderType.arrow) {
        this.setSymbolSize(this.options.styleSpec?.size);
        this.setSymbolSpace(createZoom(this.uid, zoom, 'space', this.options.styleSpec, clear));
      }
    }
  }

  /**
   * 处理地图缩放事件
   */
  handleZoom() {
    this.parseStyleSpec(false);
  }

  /**
   * 构建渲染所需色带
   */
  buildColorRamp() {
    if (!this.options.styleSpec?.['fill-color']) return;
    const { data, colorRange } = createLinearGradient([], this.options.styleSpec?.['fill-color'] as any[]);
    this.isRasterize = isRasterize(this.options.styleSpec?.['fill-color']);

    if (colorRange) {
      this.colorRange = new Vector2(...colorRange);
    }

    if (data) {
      this.colorRampTexture = new DataTexture(this.renderer, {
        data,
        name: 'colorRampTexture',
        magFilter: this.renderer.gl.NEAREST,
        minFilter: this.renderer.gl.NEAREST,
        width: 255,
        height: 1,
      });
    }
  }

  clearStencil() {
    this.nextStencilID = 1;
  }

  stencilConfigForOverlap(tiles: any[]): [{ [_: number]: any }, Tile[]] {
    const coords = tiles.sort((a, b) => b.overscaledZ - a.overscaledZ);
    const minTileZ = coords[coords.length - 1].overscaledZ;
    const stencilValues = coords[0].overscaledZ - minTileZ + 1;
    if (stencilValues > 1) {
      if (this.nextStencilID + stencilValues > 256) {
        this.clearStencil();
      }
      const zToStencilMode = {};
      for (let i = 0; i < stencilValues; i++) {
        zToStencilMode[i + minTileZ] = {
          stencil: true,
          mask: 0xff,
          func: {
            cmp: this.renderer.gl.GEQUAL,
            ref: i + this.nextStencilID,
            mask: 0xff,
          },
          op: {
            fail: this.renderer.gl.KEEP,
            zfail: this.renderer.gl.KEEP,
            zpass: this.renderer.gl.REPLACE,
          },
        };
      }
      this.nextStencilID += stencilValues;
      return [zToStencilMode, coords];
    }
    return [
      {
        [minTileZ]: {
          // 禁止写入
          stencil: false,
          mask: 0,
          func: {
            cmp: this.renderer.gl.ALWAYS,
            ref: 0,
            mask: 0,
          },
          op: {
            fail: this.renderer.gl.KEEP,
            zfail: this.renderer.gl.KEEP,
            zpass: this.renderer.gl.KEEP,
          },
        },
      },
      coords,
    ];
  }

  moveStart() {
    if (this.renderPipeline && this.options.renderType === RenderType.particles) {
      const particlesPass = this.renderPipeline.getPass('ParticlesPass');

      if (particlesPass) {
        particlesPass.resetParticles();
      }

      this.renderPipeline.passes.forEach((pass) => {
        if (pass.id === 'ParticlesTexturePass' || pass.id === 'ScreenPass') {
          pass.enabled = false;
        }
        if (pass.id === 'ParticlesPass') {
          pass.prerender = false;
        }
      });
    }
  }

  moveEnd() {
    if (this.renderPipeline && this.options.renderType === RenderType.particles) {
      const updatePass = this.renderPipeline.getPass('UpdatePass');

      if (updatePass) {
        // updatePass.initializeRenderTarget();
        updatePass.setInitialize(true);
      }

      this.renderPipeline.passes.forEach((pass) => {
        if (pass.id === 'ParticlesTexturePass' || pass.id === 'ScreenPass') {
          pass.enabled = true;
        }

        if (pass.id === 'ParticlesPass') {
          pass.prerender = true;
          // pass.resetParticles();
        }
      });
    }
  }

  /**
   * 更新视野内的瓦片
   */
  update() {
    const tiles = this.options.getViewTiles(this.source, this.options.renderType);
    if (Array.isArray(this.source.sourceCache)) {
      this.source.sourceCache.forEach((s) => {
        s?.update(tiles);
      });
    } else {
      this.source.sourceCache?.update(tiles);
    }
  }

  onTileLoaded() {
    if (this.options.triggerRepaint && isFunction(this.options.triggerRepaint)) {
      this.options.triggerRepaint();
    }
  }

  setMask(mask: BaseLayerOptions['mask']) {
    this.options.mask = mask;

    if (this.options.mask) {
      if (!this.maskPass) {
        this.maskPass = new MaskPass('MaskPass', this.renderer, {
          mask: this.options.mask,
        });

        const raster = this.renderPipeline?.getPass('RasterComposePass');
        if (raster) {
          raster.setMaskPass(this.maskPass);
        }
        const colorize = this.renderPipeline?.getPass('ColorizeComposePass');
        if (colorize) {
          colorize.setMaskPass(this.maskPass);
        }
        const particles = this.renderPipeline?.getPass('ParticlesPass');
        if (particles) {
          particles.setMaskPass(this.maskPass);
        }

        const arrow = this.renderPipeline?.getPass('ArrowPass');
        if (arrow) {
          arrow.setMaskPass(this.maskPass);
        }
      }

      this.maskPass.updateGeometry();

      this.options?.triggerRepaint?.();
    }
  }

  async picker(pixel = [0, 0]) {
    if (!this.renderPipeline) return null;
    const pickerPass = this.renderPipeline.getPass('PickerPass');
    if (!pickerPass) return null;
    return pickerPass.render(undefined, undefined, pixel);
  }

  prerender(cameras, renderTarget?: any) {
    if (this.renderPipeline) {
      this.renderPipeline.prerender(
        {
          scene: this.scene,
          cameras,
          ...(renderTarget ? { target: renderTarget } : {}),
        },
        {
          zoom: this.options?.getZoom?.() ?? 0,
          extent: this.options?.getExtent?.(),
          opacity: this.opacity,
          fadeOpacity: this.fadeOpacity,
          numParticles: this.numParticles,
          colorRange: this.colorRange,
          colorRampTexture: this.colorRampTexture,
          sharedState: this.sharedState,
          u_drop_rate: this.dropRate,
          u_drop_rate_bump: this.dropRateBump,
          u_speed_factor: this.speedFactor,
          u_flip_y: this.options.flipY,
          u_gl_scale: this.options.glScale?.(),
          u_zoomScale: this.options.zoomScale?.(),
          symbolSize: this.size,
          symbolSpace: this.space,
          pixelsToProjUnit: this.options.getPixelsToProjUnit(),
        },
      );
    }
  }

  render(cameras, renderTarget?: any) {
    if (this.renderPipeline) {
      const state: any = {
        zoom: this.options?.getZoom?.() ?? 0,
        extent: this.options?.getExtent?.(),
        opacity: this.opacity,
        fadeOpacity: this.fadeOpacity,
        numParticles: this.numParticles,
        colorRange: this.colorRange,
        colorRampTexture: this.colorRampTexture,
        displayRange: this.options.displayRange,
        useDisplayRange: Boolean(this.options.displayRange),
        sharedState: this.sharedState,
        u_drop_rate: this.dropRate,
        u_drop_rate_bump: this.dropRateBump,
        u_speed_factor: this.speedFactor,
        u_flip_y: this.options.flipY,
        u_gl_scale: this.options.glScale?.(),
        u_zoomScale: this.options.zoomScale?.(),
        symbolSize: this.size,
        symbolSpace: this.space,
        pixelsToProjUnit: this.options.getPixelsToProjUnit(),
      };

      this.renderPipeline.render(
        {
          scene: this.scene,
          cameras,
          ...(renderTarget ? { target: renderTarget } : {}),
        },
        state,
      );
    }
  }

  /**
   * 销毁此 Renderer
   */
  destroy() {
    if (this.raf) {
      this.raf.stop();
    }
    if (this.renderPipeline) {
      this.renderPipeline.destroy();
      this.renderPipeline = null;
    }
    if (this.source) {
      if (Array.isArray(this.source.sourceCache)) {
        this.source.sourceCache.forEach((s) => {
          s.off('update', this.update);
          s.off('tileLoaded', this.onTileLoaded);
        });
      } else {
        this.source.sourceCache.off('update', this.update);
        this.source.sourceCache.off('tileLoaded', this.onTileLoaded);
      }
      this.source.destroy();
    }
  }
}
