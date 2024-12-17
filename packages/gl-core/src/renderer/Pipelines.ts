import type { Renderer } from '@jokkicn/vis-engine';

export default class Pipelines {
  private _passes: any[] = [];

  public enabled: boolean;
  public renderer: Renderer;

  constructor(renderer) {
    this.enabled = true;
    this.renderer = renderer;
  }

  get passes() {
    return this._passes;
  }

  get length() {
    return this.passes.length;
  }

  resize(width: number, height: number) {
    const len = this._passes.length;
    for (let i = 0; i < len; i++) {
      const pass = this._passes[i];
      pass.resize?.(width, height);
    }
  }

  addPass(pass) {
    this._passes.push(pass);
  }

  removePass(pass) {
    const idx = this._passes.indexOf(pass);
    if (idx > -1) {
      this._passes.splice(pass, 1);
      pass.destroy();
    }
  }

  removePasses() {
    this._passes.forEach((pass) => pass.destroy());
    this._passes = [];
  }

  getPass(id) {
    return this._passes.find((pass) => pass.id === id);
  }

  prerender(rendererParams, rendererState) {
    const passes = this._passes.filter((p) => p.enabled && p.prerender === true);
    if (passes.length > 0) {
      const len = passes.length;
      for (let i = 0; i < len; i++) {
        const pass = passes[i];
        pass.render(rendererParams, rendererState);
      }
      this.renderer.resetState();
    }
  }

  render(rendererParams, rendererState) {
    const passes = this._passes.filter((p) => p.enabled && p.prerender !== true);
    if (passes.length > 0) {
      const len = passes.length;
      for (let i = 0; i < len; i++) {
        const pass = passes[i];
        pass.render(rendererParams, rendererState);
      }
      this.renderer.resetState();
    }
  }

  destroy() {
    this._passes.forEach((pass) => pass.destroy());
  }
}
