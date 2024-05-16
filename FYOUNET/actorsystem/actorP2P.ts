// Import custom types from a local module for actor payloads and messages.
import { ActorPayload, ActorState, SerializedState, isCloudActorAddress } from "./types.ts";
import { ActorMessage } from "./types.ts";
import { Actor, Connection, Address } from "./types.ts"
import { actorManager } from "./actorManager.ts";
import { Message } from "./message.ts";
import { cloudSpace } from "./cloudSpace.ts";


type RPortalP2P = ActorP2P

//websocket helper
class WebSocketConnection implements Connection {
  ip: string // Public IP address of the connection.
  private sock: WebSocket // Private WebSocket instance for the connection.

  constructor(ip: string, sock: WebSocket) {
    this.ip = ip
    this.sock = sock
  }

  // Static method to create a new WebSocketConnection with optional disconnect callback.
  static create(ip: string, disconnect?: () => void): WebSocketConnection {
    const socket = new WebSocket(`ws://${ip}`) // Initialize WebSocket connection.
    socket.onclose = disconnect ?? null // Assign the disconnect callback if provided.
    return new WebSocketConnection(ip, socket) // Return a new instance of the connection.
  }



  // Sends a message to the specified address with a payload.
  send(message: Message<unknown>): Promise<void> {

    // If the socket is open, send the message immediately.
    if (this.sock.readyState === this.sock.OPEN) {
      this.sock.send(message.serialize());
      return Promise.resolve()
    }

    // If the socket is not open, wait for it to open before sending the message.
    else {
      return new Promise(resolve => {
        this.sock.addEventListener("open", () => {
          //websocket send
          this.sock.send(message.serialize());
          resolve()
        })
      })
    }
  }
}

// a networked actor
export class ActorP2P<T extends ActorP2P = RPortalP2P> extends Actor {
  private server?: Deno.HttpServer | undefined // Optional HTTP server for handling WebSocket connections.
  public publicIp: string // Public IP .
  

  constructor(actorname: string, publicIp: string, state?: SerializedState<Actor>) {
    super(state)
    this.actorname = actorname
    this.actorid
    this.publicIp = publicIp
  }

  // Handles adding the portal to the system, setting up the server for WebSocket connections.
  override async onAdd(ctx: actorManager | cloudSpace) {
    console.log(`Networking an actor ${this.actorid} at ${this.publicIp}`)
    const port = this.publicIp.split(":")[1]
    this.server = Deno.serve({ port: parseInt(port)}, req => {
      console.log(`Received request: ${req.url}`);
      if (req.headers.get("upgrade") !== "websocket") {
        // If the request is not trying to upgrade to WebSocket, return 501 Not Implemented.
        return new Response(null, { status: 501 });
      }

      const { socket, response } = Deno.upgradeWebSocket(req)
      
      // Handle incoming WebSocket messages.
      socket.onmessage = (event) => {
        
        const message = Message.deserialize(event.data);
        // deno-lint-ignore no-explicit-any
        (ctx as any).command(message.address, message.type, message.payload);
      }

      return response
    })
  }

  // Cleans up resources when the portal is removed from the system.
  override async onRemove() {
    await this.server?.shutdown()
    await this.server?.finished
  }

  // Placeholder for connection handling.
  onConnect(_ctx: actorManager | cloudSpace, _addr: Address<T>): Promise<void> {
    return Promise.resolve()
  }

  // Placeholder for disconnection handling.
  onDisconnect(_ctx: actorManager | cloudSpace, _addr: Address<T>): Promise<void> {
    return Promise.resolve()
  }

  // Broadcasts a message to all peers connected via WebSocket.

  async broadcast<K extends ActorMessage<T>>(
    ctx: actorManager | cloudSpace ,
    type: K,
    payload: ActorPayload<T, K>
  ) {
    const tasks = [];
    for (const peer of Object.keys(ctx.peers)) {
      const conn = ctx.peers[peer];
      if (conn instanceof WebSocketConnection) {
        const addr = `${peer}` as Address<T>;
        const message = new Message(addr, type, payload);
        tasks.push(conn.send(message));
      }
    }

    await Promise.all(tasks)
  }

  // helper Serializes the list of peers and their IPs for sharing.
  serializePeers(ctx: actorManager): Record<string, string> {
    const peers: Record<string, string> = {}
    //public actors: Record<string, Actor> = {};
    for (const actorId in ctx.actors) {

      const actor = ctx.actors[actorId];
      peers[actor.actorid] = this.publicIp
      for (const peer of Object.keys(ctx.peers)) {
        const conn = ctx.peers[peer]
        if (conn instanceof WebSocketConnection) {
          peers[peer] = conn.ip
        }
      }
      
    }
    return peers
  }

  // Handles connecting to a new peer and synchronizing the peer list.
  async h_connect(ctx: actorManager, ip: string) {
    console.log("connecting to", ip);
    const addr = this.actorname as Address<T>;

    //onConnect is implicit here
    //then we tell the portal to sync peers
    const message = new Message(addr, "h_syncPeers", this.serializePeers(ctx));
    //create ws with ip and send message to ip
    await WebSocketConnection.create(ip).send(message);
  }

  // Synchronizes the peer list among connected peers.
  async h_syncPeers(ctx: actorManager, ip: Record<string, string>) {
    console.log("SYNCHRONIZE ACTORS: OBJECT KEYS= " + Object.keys(ip));

    const newPeers = Object.keys(ip).map(peer => {
      // Check if the peer's IP address is already in ctx.peers or matches the current actor's IP address.
      if (ctx.peers[peer] || ip[peer] === this.publicIp) {
        return
      }
      const peerFullIp = ip[peer];
      // Return the peer's IP address directly, instead of null.
      return { [peer]: peerFullIp };
    }).filter(Boolean) as { [key: string]: string }[]; // Assert the type here
  
    for (const peer of newPeers) {
      console.log(`Attempting to open connection to peer: ${peer}`);
      let actorid = null;
      let ip2 = null;


      //write better code here to make sure actorid can not be null

      for (const [key, value] of Object.entries(peer)) {
        actorid = key;
        console.log(actorid);
        ip2 = value;
        console.log(ip2);
      }
      console.log(ip[actorid]);

      ctx.peers[actorid] = WebSocketConnection.create(ip[actorid], () => {
        delete ctx.peers[actorid];
        const addr = `${peer}:${this.actorid}` as Address<T>;
        this.onDisconnect(ctx, addr);
      });
      console.log("added peer ws");
    }

    const peers = this.serializePeers(ctx);
    //send peers back to all peers?
    const tasks = newPeers.map(async peer => {
      console.log("peer:");
      console.log(peer);
      let addr = null
      for (const [key, value] of Object.entries(peer)) {
        addr = `${key}@${value}` as Address<ActorP2P>;
        console.log(addr);

      }
      //fix this
      const message = new Message(addr, "h_syncPeers", peers);
      //deno-lint-ignore no-explicit-any
      await (ctx as any).command(addr, message.type, message.payload);
      await this.onConnect(ctx, addr as Address<T>);
    });
    await Promise.all(tasks);
  }
}
