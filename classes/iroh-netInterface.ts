import { Iroh } from "@number0/iroh";
import { Buffer } from "node:buffer";
import { CustomLogger } from "./customlogger.ts";
import * as JSON from "./JSON.ts";
import crypto from "node:crypto";

export class HyperswarmInterface {
    private id: string;
    private messageHandler: ((data: unknown) => void) | null = null;
    private topic: number[] | null = null;

    // iroh-net properties
    private node: any;
    private sink: any;

    constructor(id: string) {
        this.id = id;
    }

    async start() {
        // Initialize the iroh-net node
        this.node = await Iroh.memory();
        const nodeId = await this.node.net.nodeId();
        CustomLogger.log("class", `Initialized iroh-net node with ID: ${nodeId.toString("hex")}`);

        // For testing purposes, you might need to connect to known peers.
        // You can use `addNodeAddr` to add known node addresses.
    }

    public onMessage(handler: (data: unknown) => void) {
        this.messageHandler = handler;
    }

    public async setTopic(topicId: string | null) {
        if (this.topic) {
            // Unsubscribe from the current topic
            if (this.sink) {
                await this.sink.close();
                CustomLogger.log("class", `Unsubscribed from topic.`);
            }
            this.topic = null;
        }

        if (topicId) {
            // Create a 32-byte topic hash
            const topicHash = crypto.createHash("sha256").update(topicId).digest();
            this.topic = Array.from(topicHash);

            // Subscribe to the new topic
            this.sink = await this.node.gossip.subscribe(this.topic, [], (error: any, event: any) => {
                if (error) {
                    CustomLogger.error("class", "Gossip error:", error);
                    return;
                }

                if (event.received) {
                    this.handleIncomingMessage(event.received);
                }
            });

            CustomLogger.log("class", `Subscribed to topic: ${topicId}`);
            return true;
        }

        return false;
    }

    public async sendMessage(message: unknown) {
        if (this.sink) {
            const messageString = JSON.stringify(message);
            const messageBuffer = Buffer.from(messageString, "utf8");
            const messageArray = Array.from(messageBuffer);

            await this.sink.broadcast(messageArray);
            CustomLogger.log("class", "Message sent:", message);
            return true;
        } else {
            CustomLogger.error("class", "Not subscribed to any topic. Cannot send message.");
            return false;
        }
    }

    private handleIncomingMessage(event: any) {
        const contentBuffer = Buffer.from(event.content);
        const contentString = contentBuffer.toString("utf8");
        const data = JSON.parse(contentString);

        CustomLogger.log("class", "Received message:", data);

        if (this.messageHandler) {
            this.messageHandler(data);
        }
    }
}
