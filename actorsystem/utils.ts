import { CustomLogger } from "../classes/customlogger.ts";

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(() => resolve(), ms));
}

export class Signal<T> {
  private resolve: ((value: T) => void) | null = null;
  private promise: Promise<T> | null = null;

  constructor() {
    this.promise = new Promise((res) => {
      this.resolve = res;
    });
  }

  wait(): Promise<T> {
    return this.promise!;
  }

  trigger(value: T): void {
    if (this.resolve) {
      CustomLogger.log("actorsys", "signal triggered");
      this.resolve(value);
    }
  }
}
