import Field from './Field';
// import isFunction from 'lodash/isFunction';
import { isString, isNumber, isFunction } from './utils';

export const defaultOptions = {
  globalAlpha: 0.9, // 全局透明度
  lineWidth: 1, // 线条宽度
  colorScale: '#fff',
  velocityScale: 1 / 25,
  // particleAge: 90, // 粒子在重新生成之前绘制的最大帧数
  maxAge: 90, // alias for particleAge
  // particleMultiplier: 1 / 300, // TODO: PATHS = Math.round(width * height * particleMultiplier);
  paths: 800,
  frameRate: 20,
  minVelocity: 0,
  maxVelocity: 10,
  generateParticleOption: true,
};

type emptyFunc = (v?: any) => number;
type emptyGenerateParticleFunc = (v?: any) => boolean;

export interface IOptions {
  globalAlpha: number; // 全局透明度
  lineWidth: number | emptyFunc; // 线条宽度
  colorScale: string | string[] | emptyFunc;
  velocityScale: number | emptyFunc;
  particleAge?: number; // 粒子在重新生成之前绘制的最大帧数
  maxAge: number; // alias for particleAge
  particleMultiplier?: number; // TODO: PATHS = Math.round(width * height * that.particleMultiplier);
  paths: number | emptyFunc;
  frameRate: number;
  minVelocity?: number;
  maxVelocity?: number;
  generateParticleOption?: boolean | emptyGenerateParticleFunc;
}

function indexFor (m: number, min: number, max: number, colorScale: string[]) {  // map velocity speed to a style
  return Math.max(0, Math.min((colorScale.length - 1),
    Math.round((m - min) / (max - min) * (colorScale.length - 1))));
}

class BaseLayer {
  private ctx: CanvasRenderingContext2D;
  private options: IOptions;
  private field: Field;
  private particles: any[];

  static Field = Field;
  private animationLoop: number;
  private _then: number;
  private starting: boolean;
  private generated: boolean = false;

  public forceStop: boolean;

  constructor(ctx: CanvasRenderingContext2D, options: Partial<IOptions>, field?: Field) {
    this.ctx = ctx;

    if (!this.ctx) {
      throw new Error('ctx error');
    }

    this.setOptions(options);

    this.animate = this.animate.bind(this);

    if (field) {
      this.updateData(field);
    }
  }

  public setOptions(options: Partial<IOptions>) {
    this.options = Object.assign({}, defaultOptions, options);

    const { width, height } = this.ctx.canvas;

    if (('particleAge' in options) && !('maxAge' in options) && isNumber(this.options.particleAge)) {
      // @ts-ignore
      this.options.maxAge = this.options.particleAge;
    }

    if (('particleMultiplier' in options) && !('paths' in options) && isNumber(this.options.particleMultiplier)) {
      // @ts-ignore
      this.options.paths = Math.round(width * height * this.options.particleMultiplier);
    }
  }

  public getOptions() {
    return this.options;
  }

  public updateData(field: Field) {
    this.field = field;
  }

  private moveParticles() {
    const { width, height } = this.ctx.canvas;
    const particles = this.particles;
    // 清空组
    const maxAge = this.options.maxAge;
    const optVelocityScale = isFunction(this.options.velocityScale)
      // @ts-ignore
      ? this.options.velocityScale()
      : this.options.velocityScale;
    const velocityScale = optVelocityScale;

    let i = 0;
    let len = particles.length;
    for (; i < len; i++) {
      const particle = particles[i];

      if (particle.age > maxAge) {
        particle.age = 0;
        // restart, on a random x,y
        this.field.randomize(particle, width, height);
      }

      const x = particle.x;
      const y = particle.y;

      const vector = this.field.valueAtPixel(x, y);

      if (vector === null) {
        particle.age = maxAge;
      } else {
        const xt = x + vector.u * velocityScale;
        const yt = y + vector.v * -velocityScale;

        if (this.field.valueAtPixel(xt, yt)) {
          // Path from (x,y) to (xt,yt) is visible, so add this particle to the appropriate draw bucket.
          particle.xt = xt;
          particle.yt = yt;
          particle.m = vector.magnitude();
        } else {
          // Particle isn't visible, but it still moves through the field.
          particle.x = xt;
          particle.y = yt;
          // particle.age = maxAge;
        }
      }

      particle.age++;
    }
  }

  private fadeIn() {
    const prev = this.ctx.globalCompositeOperation; // lighter
    this.ctx.globalCompositeOperation = 'destination-in';
    this.ctx.fillRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
    this.ctx.globalCompositeOperation = prev;
  }

  private drawParticles() {
    const particles = this.particles;
    this.fadeIn();
    // this.ctx.globalAlpha = 0.9;

    this.ctx.fillStyle = `rgba(0, 0, 0, ${this.options.globalAlpha})`;
    this.ctx.lineWidth = (isNumber(this.options.lineWidth) ? this.options.lineWidth : 1) as number;
    this.ctx.strokeStyle = (isString(this.options.colorScale) ? this.options.colorScale : '#fff') as string;

    let i = 0;
    let len = particles.length;
    if (this.field && len > 0) {
      const [min, max] = this.field.range as [number, number];
      for (; i < len; i++) {
        this.drawParticle(particles[i], min, max);
      }
    }
  }

  drawParticle(particle: any, min: number, max: number) {
    // TODO 需要判断粒子是否超出视野
    // this.ctx.strokeStyle = color;
    const pointPrev: [number, number] = [particle.x, particle.y];
    // when xt isn't exit
    const pointNext: [number, number] = [particle.xt, particle.yt];

    // const pointPrev = this.project(source);
    // const pointNext = this.project(target);

    if (pointPrev && pointNext) {
      this.ctx.beginPath();
      this.ctx.moveTo(pointPrev[0], pointPrev[1]);
      this.ctx.lineTo(pointNext[0], pointNext[1]);

      if (isFunction(this.options.colorScale)) {
        // @ts-ignore
        this.ctx.strokeStyle = this.options.colorScale(particle.m) as string;
      } else if (Array.isArray(this.options.colorScale)) {
        const colorIdx = indexFor(particle.m, min, max, this.options.colorScale);
        this.ctx.strokeStyle = this.options.colorScale[colorIdx];
      }

      if (isFunction(this.options.lineWidth)) {
        // @ts-ignore
        this.ctx.lineWidth = this.options.lineWidth(particle.m) as number;
      }

      particle.x = particle.xt;
      particle.y = particle.yt;

      this.ctx.stroke();
    }
  }

  // private drawParticle(particle: any, min: number, max: number) {
  //   // TODO 需要判断粒子是否超出视野
  //   // this.ctx.strokeStyle = color;
  //   const source: [number, number] = [particle.x, particle.y];
  //   // when xt isn't exit
  //   const target: [number, number] = [particle.xt || source[0], particle.yt || source[1]];
  //
  //   if (
  //     this.intersectsCoordinate(target)
  //     && particle.age <= this.options.maxAge
  //   ) {
  //     const pointPrev = this.project(source);
  //     const pointNext = this.project(target);
  //
  //     if (pointPrev && pointNext) {
  //       this.ctx.beginPath();
  //       this.ctx.moveTo(pointPrev[0], pointPrev[1]);
  //       this.ctx.lineTo(pointNext[0], pointNext[1]);
  //       particle.x = particle.xt;
  //       particle.y = particle.yt;
  //
  //       if (isFunction(this.options.colorScale)) {
  //         // @ts-ignore
  //         this.ctx.strokeStyle = this.options.colorScale(particle.m) as string;
  //       } else if (Array.isArray(this.options.colorScale)) {
  //         const colorIdx = indexFor(particle.m, min, max, this.options.colorScale);
  //         this.ctx.strokeStyle = this.options.colorScale[colorIdx];
  //       }
  //
  //       if (isFunction(this.options.lineWidth)) {
  //         // @ts-ignore
  //         this.ctx.lineWidth = this.options.lineWidth(particle.m) as number;
  //       }
  //
  //       this.ctx.stroke();
  //     }
  //   }
  // }

  private prepareParticlePaths() { // 由用户自行处理，不再自动修改粒子数
    const { width, height } = this.ctx.canvas;
    const particleCount = typeof this.options.paths === 'function' ? this.options.paths(this) : this.options.paths;
    const particles = [];
    if (!this.field) return [];
    this.field.startBatchInterpolate(width, height, this.project);
    let i = 0;
    for (; i < particleCount; i++) {
      particles.push(this.field.randomize({
        age: this.randomize()
      }, width, height));
    }
    return particles;
  }

  private randomize() {
    return Math.floor(Math.random() * this.options.maxAge); // 例如最大生成90帧插值粒子路径
  }

  // @ts-ignore
  project(...args: any[]): [number, number] | null {
    throw new Error('must be overriden');
  }

  intersectsCoordinate(coordinates: [number, number]): boolean {
    throw new Error('must be overriden');
  }

  start() {
    this.starting = true;
    this.forceStop = false;
    this._then = Date.now();
    this.animate();
  }

  stop() {
    cancelAnimationFrame(this.animationLoop);
    this.starting = false;
    this.forceStop = true;
  }

  animate() {
    if (this.animationLoop) cancelAnimationFrame(this.animationLoop);
    this.animationLoop = requestAnimationFrame(this.animate);
    const now = Date.now();
    const delta = now - this._then;
    if (delta > this.options.frameRate) {
      this._then = now - (delta % this.options.frameRate);
      this.render();
    }
  }

  /**
   * 渲染前处理
   */
  prerender() {
    const gen = isFunction(this.options.generateParticleOption) ?
      // @ts-ignore
      this.options.generateParticleOption() : this.options.generateParticleOption;
    if (!gen && !this.generated) {
      this.particles = this.prepareParticlePaths();
      this.generated = true;
    } else if (gen) {
      this.particles = this.prepareParticlePaths();
      this.generated = true;
    }

    if (!this.starting && !this.forceStop) {
      this.starting = true;
      this._then = Date.now();
      this.animate();
    }
  }

  /**
   * 开始渲染
   */
  render() {
    this.moveParticles();
    this.drawParticles();
    this.postrender();
  }

  /**
   * each frame render end
   */
  postrender() {}
}

export { default as Field } from './Field';
export { default as Vector } from './Vector';
export * from './utils';

export default BaseLayer;
