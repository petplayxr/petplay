import { Actor, Address } from "./types.ts"

/**
 * Represents a message within the actor system.
 * Messages carry data between actors and can be serialized/deserialized for transmission.
 *
 * @template T - The generic type parameter representing the type of address associated with the message.
 */
export class Message<Actor> {
    /**
     * Constructs a new instance of Message.
     * @param address - where the message is sent.
     * @param type - command type.
     * @param payload - payload associated with the message.
     */
    constructor(
        public address: Address<Actor>,
        public type: string,
        public payload: unknown
    ) {}

    serialize(): string {
        return JSON.stringify(this);
    }

    static deserialize<Actor>(data: string): Message<Actor> {
        const { address, type, payload } = JSON.parse(data);
        return new Message<Actor>(address, type, payload);
    }
}