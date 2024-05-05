import { Address } from "./types.ts"

export class Message<T> {
    constructor(
        public address: Address<T>,
        public type: string,
        public payload: unknown
    ) {}

    serialize(): string {
        return JSON.stringify(this);
    }

    static deserialize<T>(data: string): Message<T> {
        const { address, type, payload } = JSON.parse(data);
        return new Message<T>(address, type, payload);
    }
}