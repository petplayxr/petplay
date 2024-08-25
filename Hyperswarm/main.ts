// deno-lint-ignore-file
import Hyperswarm from "hyperswarm";
import crypto from "crypto";
import WebSocket from "ws";

interface TopicInfo {
  name: string;
  hash: Buffer;
  peerIds: Map<string, string>; // Map of Deno peerId to Hyperswarm ID
}

interface IPCMessage {
  type: string;
  [key: string]: any;
}

const peerId: string = process.argv[2];
const ipcPort: string = process.argv[3];
console.log("PeerId:", peerId);
console.log("IPC Port:", ipcPort);

const DENO_SERVER_URL: string = `ws://localhost:${ipcPort}`;

const swarm: Hyperswarm = new Hyperswarm();
let currentTopic: TopicInfo | null = null;
const ourHyperswarmId = swarm.keyPair.publicKey.toString("hex");

let wsIPC: WebSocket;

function createTopicBuffer(topicName: string): TopicInfo {
  const hash = crypto.createHash("sha256").update(topicName).digest();
  return { name: topicName, hash, peerIds: new Map() };
}

async function initIPC(): Promise<void> {
  return new Promise((resolve, reject) => {
    wsIPC = new WebSocket(DENO_SERVER_URL);
    wsIPC.on("open", () => {
      console.log(`IPC CONNECTED`);
      wsIPC.send(JSON.stringify({ peerIdSet: peerId }));
      wsIPC.on("message", (message: WebSocket.Data) => {
        const data: IPCMessage = JSON.parse(message.toString());
        handleIPCMessage(data);
      });
      resolve();
    });
    wsIPC.on("error", reject);
  });
}

function handleIPCMessage(data: IPCMessage): void {
  console.log("handleIPCMessage", data);
  switch (data.type) {
    case "set_topic":
      setTopic(data.topicId);
      break;
    case "send_message":
      console.log(data.targetPeerId, data.payload);
      sendMessage(data.targetPeerId, data.payload);
      break;
    default:
      console.log("Unknown IPC message type:", data.type);
  }
}

async function setTopic(topicName: string | null) {
  if (currentTopic) {
    await swarm.leave(currentTopic.hash);
    console.log(
      `Left topic: ${currentTopic.name} (${currentTopic.hash.toString("hex")})`,
    );
  }

  if (topicName === null) {
    currentTopic = null;
    console.log("No active topic");
    return;
  }

  currentTopic = createTopicBuffer(topicName);
  console.log(
    `Joining topic: ${currentTopic.name} (${
      currentTopic.hash.toString("hex")
    })`,
  );

  swarm.join(currentTopic.hash, { server: true, client: true });
  console.log(
    `Topic joined, not flushed`,
  );
  
  await writePeerIdToTopic(currentTopic, peerId, ourHyperswarmId);
  wsIPC.send(
    JSON.stringify(
      {
        type: "topic_connected",
        topicId: topicName,
      },
    ),
  );
  await swarm.flush();
  console.log(
    `Topic fully announced and connected to available peers: ${currentTopic.name}`,
  );
}

async function writePeerIdToTopic(
  topic: TopicInfo,
  denoPeerId: string,
  hyperswarmId: string,
) {
  console.log(`Writing peerId to topic: ${topic.name}`);
  const message = JSON.stringify({ type: "peerId", denoPeerId, hyperswarmId });
  for (const conn of swarm.connections) {
    (conn as any).write(message);
  }
}

function startPeerIdCheck() {
  setInterval(() => {
    console.log("Checking for new peers...");
    if (currentTopic) {
      for (const conn of swarm.connections) {
        (conn as any).write(JSON.stringify({ type: "requestPeerIds" }));
      }
    }
  }, 10000);
}

swarm.on("connection", (conn, info) => {
  const remotePeerId = info.publicKey.toString("hex");
  console.log(`Connected to peer: ${remotePeerId}`);

  conn.on("data", (data) => {
    try {
      const message = JSON.parse(data.toString());
      handlePeerMessage(message, remotePeerId);
    } catch (error) {
      console.error("Error parsing peer message:", error);
    }
  });

  conn.on("close", () => {
    console.log(`Disconnected from peer: ${remotePeerId}`);
    wsIPC.send(JSON.stringify({
      type: "peer_disconnected",
      peerId: remotePeerId,
    }));
  });
});

function handlePeerMessage(message: any, remotePeerId: string) {
  switch (message.type) {
    case "peerId":
      if (currentTopic) {
        currentTopic.peerIds.set(message.denoPeerId, remotePeerId);
        /* console.log(
          `initAssociated Deno peerId ${message.denoPeerId} with Hyperswarm ID ${remotePeerId}`,
        ); */
        notifyDenoOfPeerAvailability(message.denoPeerId);
      }
      break;
    case "requestPeerIds":
      if (currentTopic) {
        console.log(`received requestPeerIds from ${remotePeerId}`)
        const conn = Array.from(swarm.connections).find((c) =>
          (c as any).remotePublicKey.toString("hex") === remotePeerId
        );
        if (conn) {
          (conn as any).write(JSON.stringify({
            type: "peerIdResponse",
            denoPeerId: peerId,
            hyperswarmId: ourHyperswarmId,
          }));
        }
      }
      break;
    case "peerIdResponse":
      if (currentTopic) {
        currentTopic.peerIds.set(message.denoPeerId, message.hyperswarmId);
        /* console.log(
          `Associated Deno peerId ${message.denoPeerId} with Hyperswarm ID ${message.hyperswarmId}`,
        ); */
        notifyDenoOfPeerAvailability(message.denoPeerId);
      }
      break;
    case "petplay_message":
      wsIPC.send(JSON.stringify(
        {
          type: "petplay_message",
          payload: JSON.stringify(message.payload),
        },
      ));
      break;
    default:
      console.log("Unknown peer message type:", message.type);
      break;
  }
}

function notifyDenoOfPeerAvailability(denoPeerId: string) {
  wsIPC.send(JSON.stringify({
    type: "peer_available",
    peerId: denoPeerId,
  }));
}

function sendMessage(targetPeerId: string, payload: any): void {
  if (currentTopic && currentTopic.peerIds.has(targetPeerId)) {
    const targetHyperswarmId = currentTopic.peerIds.get(targetPeerId);
    const targetConn = Array.from(swarm.connections).find((
      conn,
    ) => ((conn as any).remotePublicKey.toString("hex") ===
      targetHyperswarmId)
    );
    if (targetConn) {
      (targetConn as any).write(JSON.stringify(
        {
          type: "petplay_message",
          payload: payload
        }
      ));
      console.log(`Message sent to ${targetPeerId} (${targetHyperswarmId})`);
    } else {
      console.log(
        `Connection not found for ${targetPeerId} (${targetHyperswarmId})`,
      );
    }
  } else {
    console.log(`No Hyperswarm ID found for Deno peerId: ${targetPeerId}`);
  }
}

async function main(): Promise<void> {
  await initIPC();
  console.log("Hyperswarm peer initialized");
  startPeerIdCheck();
}

main().catch(console.error);

setInterval(() => {
  /* console.log(`Current connections: ${swarm.connections.size}`);
  console.log(`Current topic: ${currentTopic ? currentTopic.name : "None"}`);
  console.log(`Peers: ${swarm.peers.size}`); */
  /* for (const [key, peerInfo] of swarm.peers) {
    console.log(`  Peer ${key}: ${peerInfo.publicKey.toString("hex")}`);
    console.log(`    Topics: ${peerInfo.topics.map((t) => t.toString("hex")).join(", ")}`);
  } */
}, 10000);

process.on("SIGINT", async () => {
  console.log("Closing connections and leaving swarm...");
  for (const conn of swarm.connections) {
    conn.destroy();
  }
  await swarm.destroy();
  process.exit(0);
});
