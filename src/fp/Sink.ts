import TimeoutError from './TimeoutError';

type Finalizator = () => void | Promise<any>;

export default class Sink<A> {
  private readonly promise: Promise<void>;

  private readonly cancelOnError: boolean;

  private pending = true;

  private cancelling?: Promise<void>;

  private waitTimeoutHandler?: any;

  private resolve?: () => void;

  private reject?: (reason?: any) => void;

  private finalizator?: Finalizator;

  private pipeHandler?: (value: any) => Promise<any>;

  constructor(
    executor: (pipe: (value: A) => any, cancel: Sink<A>['cancel']) => Finalizator | void,
    cancelOnPipeError = true
  ) {
    this.cancel = this.cancel.bind(this);
    this.wait = this.wait.bind(this);
    this.catch = this.catch.bind(this);
    this.pipe = this.pipe.bind(this);
    this.onPipe = this.onPipe.bind(this);

    this.cancelOnError = cancelOnPipeError;

    this.promise = new Promise<void>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const f = executor(this.onPipe, this.cancel);
      this.finalizator = typeof f === 'function' ? f : undefined;
    }).finally(() => {
      this.pending = false;
      clearTimeout(this.waitTimeoutHandler);
    });
  }

  get isPending(): boolean {
    return this.pending;
  }

  wait(timeout?: number, errorOnTimeout = true): Promise<void> {
    if (this.isPending && timeout && timeout > 0) {
      clearTimeout(this.waitTimeoutHandler);
      this.waitTimeoutHandler = setTimeout(() => {
        void this.cancel(
          errorOnTimeout ? new TimeoutError(`Timeout of ${timeout}ms exceeded.`) : undefined
        );
      }, timeout);
    }
    return this.promise;
  }

  cancel(reason?: unknown): Promise<void> {
    if (this.cancelling) return this.cancelling;
    if (!this.isPending) return Promise.resolve();
    // if (this.cancelling) return Promise.reject(new Error('Already in cancelling state.'));

    // finalizator may works long time so cancel timer because already in cancelling state.
    clearTimeout(this.waitTimeoutHandler);

    this.cancelling = Promise.resolve()
      .then(this.finalizator)
      .catch((ex) => {
        if (reason) console.error('Cancel error:', ex);
        else throw ex;
      })
      .finally(() => {
        if (reason) {
          this.reject && this.reject(reason);
        } else {
          this.resolve && this.resolve();
        }
        this.cancelling = undefined;
        this.finalizator = undefined;
        this.reject = undefined;
        this.resolve = undefined;
        this.pipeHandler = undefined;
      });

    return this.cancelling;

    // if (!this.isPending) return;
    // this.finalizator && (await this.finalizator());
    // if (reason) {
    //   this.reject && this.reject(reason);
    // } else {
    //   this.resolve && this.resolve();
    // }
  }

  private onPipe(value: any): void {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    this.pipeHandler && this.pipeHandler(value).catch(this.cancelOnError ? this.cancel : undefined);
  }

  pipe<B>(action: (value: A) => PromiseLike<B> | B): Sink<B> {
    const prevHandler = this.pipeHandler;
    this.pipeHandler = (value) =>
      (prevHandler ? prevHandler(value) : Promise.resolve(value)).then(action);
    return (this as unknown) as Sink<B>;
  }

  once<B>(action: (value: A) => PromiseLike<B> | B): Sink<B> {
    const prevHandler = this.pipeHandler;
    this.pipeHandler = (value) =>
      (prevHandler ? prevHandler(value) : Promise.resolve(value))
        .then(action)
        .then(() => this.cancel());
    return (this as unknown) as Sink<B>;
  }

  catch<B = never>(action: (reason: any) => PromiseLike<B> | B): Sink<B> {
    const prevHandler = this.pipeHandler;
    this.pipeHandler = (value) =>
      (prevHandler ? prevHandler(value) : Promise.resolve(value)).catch(action);
    return (this as unknown) as Sink<B>;
  }
}
