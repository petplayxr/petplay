import {
    Message,
    MessageAddressReal,
    System,
    ToAddress,
} from "./types.ts";
import { PostalService } from "./PostalService.ts";
import { Signal } from "./utils.ts";

export class ActorWorker extends Worker {
    static signal: Signal<ToAddress>;
    constructor(scriptURL: string | URL, options?: WorkerOptions) {
        super(scriptURL, options);
        console.log("ActorWorker constructor called");
    }

    postMessage(message: Message, transfer: Transferable[]): void;
    postMessage(message: Message, options?: StructuredSerializeOptions): void;
    postMessage(
        message: Message,
        transferOrOptions?: Transferable[] | StructuredSerializeOptions,
    ): void {

        const address = message.address as MessageAddressReal;

        if (PostalService.actors.has(address.to) || address.to == System) {
            console.log(
                `sending from actor ${address.fm} to actor ${address.to}`,
            );

            if (Array.isArray(transferOrOptions)) {
                super.postMessage(message, transferOrOptions);
            } else {
                super.postMessage(message, transferOrOptions);
            }
        } else if (address.fm == System && address.to == null) {
            console.log("sending from system to actor");
            if (Array.isArray(transferOrOptions)) {
                super.postMessage(message, transferOrOptions);
            } else {
                super.postMessage(message, transferOrOptions);
            }
        } else {
            console.log(address.to);
            throw new Error("No route found");
        }
    }
}
