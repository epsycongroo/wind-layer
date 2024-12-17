import type { Renderer } from '@sakitam-gis/vis-engine';

const ERR_PASS_METHOD_UNDEFINED = 'Pass subclass must define virtual methods';

export default class Pass<T> {
  public id: string;

  public readonly renderer: Renderer;

  public options: T;

  public maskPass: any;

  private _enabled = true;

  constructor(id: string, renderer: Renderer, options: T = {} as T) {
    this.id = id;
    this.renderer = renderer;
    this.options = options;

    this.setMaskPass((this.options as any).maskPass);
  }

  get enabled() {
    return this._enabled;
  }

  set enabled(state) {
    this._enabled = state;
  }

  setMaskPass(pass) {
    this.maskPass = pass;
  }

  render(rendererParams, rendererState, cb) { // eslint-disable-line
    throw new Error(ERR_PASS_METHOD_UNDEFINED);
  }

  destroy() {
    throw new Error(ERR_PASS_METHOD_UNDEFINED);
  }
}
