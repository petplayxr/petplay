// @deno-types="npm:@types/ws"
import WebSocket from "ws";
import wrtc from "@roamhq/wrtc";

const peerConnections: Map<string, wrtc.RTCPeerConnection> = new Map();
const dataChannels: Map<string, wrtc.RTCDataChannel> = new Map();

let currentChannel: any = null;
const channelMembers = new Set();

const peerId = process.argv[2];
console.log(peerId);
const ipcPort = process.argv[3];
const ddnsIp = process.argv[4];
const SIGNALING_SERVER_URL = ddnsIp;
console.log(ipcPort);
const DENO_SERVER_URL = `ws://localhost:${ipcPort}`;

const wsSignaling = new WebSocket(SIGNALING_SERVER_URL);
const wsIPC = new WebSocket(DENO_SERVER_URL);

wsIPC.on("open", () => {
  console.log(`IPC CONNECTED`);
  wsIPC.send(JSON.stringify({
    peerIdSet: peerId,
  }));
});

wsIPC.on("message", (message) => {
  const data = JSON.parse(message.toString());
  handleIPCMessage(data);
});

wsSignaling.on("open", () => {
  console.log(`Connected to signaling server`);
});

wsSignaling.on("message", (message) => {
  const data = JSON.parse(message.toString());
  handleSignalingMessage(data);
});


function handleIPCMessage(data: any) {
  console.log("handleIPCMessage", data);
  switch (data.type) {
    case "set_channel":
      setChannel(data.channelId);
      break;
    case "broadcast_address":
      broadcastAddress(data.channelId);
      break;
    case "query_addresses":
      queryAddresses(data.channelId);
      break;
    case "create_offer":
      console.log("create_offer");
      createOffer(data.targetPeerId);
      break;
    case "send_message":
      sendMessage(data.targetPeerId, data.payload);
      break;
    case "query_dataPeers":
      queryDataPeers(data.from, data.targetPeerId);
      break;
    default:
      console.log("Unknown IPC message type:", data.type);
      console.log("Unknown IPC message type:", data);
  }
}

function setChannel(channelId) {
  if (currentChannel) {
    wsSignaling.send(JSON.stringify({
      channelId: currentChannel,
      to: currentChannel,
      from: peerId,
      type: "leave_channel",
    }));
  }
  currentChannel = channelId;
  if (channelId) {
    wsSignaling.send(JSON.stringify({
      channelId: currentChannel,
      to: channelId,
      from: peerId,
      type: "join_channel",
    }));
  }
}

function broadcastAddress(channelId) {
  wsSignaling.send(JSON.stringify({
    channelId: currentChannel,
    to: channelId,
    from: peerId,
    type: "broadcast_address",
  }));
}


function queryAddresses(channelId) {
  wsSignaling.send(JSON.stringify({
    channelId: currentChannel,
    to: channelId,
    from: peerId,
    type: "query_addresses",
  }));
}

function updateChannelMembers(members) {
  console.log("Updating channel members:", members);
  const newMembers = members.filter(member => !channelMembers.has(member) && member !== peerId);
  newMembers.forEach(member => {
    channelMembers.add(member);
    createOffer(member);
  });
  wsIPC.send(JSON.stringify({ type: "address_update", addresses: Array.from(channelMembers) }));
}

async function handleSignalingMessage(data: any) {
  try {
    const { channelId, to, from, type } = data;
    console.error("Received signaling message: ", channelId, to, from, type)

    if (channelId !== currentChannel) {
      console.error(`Message not for us: ${channelId} != ${currentChannel}\n skipping message ${data}`);
      return;
    }
    if (to !== peerId) {
      switch (type) {
        case "join_channel":
          console.log(`Peer ${from} joined channel ${channelId}`);
          channelMembers.add(from);
          updateChannelMembers(Array.from(channelMembers));
          break;
        case "leave_channel":
          console.log(`Peer ${from} left channel ${channelId}`);
          channelMembers.delete(from);
          updateChannelMembers(Array.from(channelMembers));
          break;
        case "broadcast_address":
          console.log(`Received broadcast from ${from} in channel ${channelId}`);
          if (!channelMembers.has(from)) {
            channelMembers.add(from);
            updateChannelMembers(Array.from(channelMembers));
          }
          break;
        case "query_addresses":
          console.log(`Received query from ${from} in channel ${channelId}`);
          wsSignaling.send(JSON.stringify({
            to: channelId,
            from: peerId,
            type: "address_response",
            channelId,
            addresses: Array.from(channelMembers)
          }));
          break;
        case "address_response":
          console.log(`Received address response in channel ${channelId}`);
          updateChannelMembers(data.addresses);
          break;
        default:
          console.log(`Unhandled message type: ${type}`);
      }

    }




    if (!peerConnections.has(from)) {
      console.log("Creating peer connection for", from);
      createPeerConnection(from);
    }

    const peerConnection = peerConnections.get(from)!;
    if (to === peerId) {
      if (type === "offer") {
        const peerConnection = peerConnections.get(from) || createPeerConnection(from);
        const offerCollision = peerConnection.signalingState !== 'stable';
        const polite = from > peerId; // Determine which peer is 'polite'

        if (offerCollision) {
          if (!polite) {
            console.log('Ignoring offer collision');
            return;
          }
          // If we're the polite peer, roll back local description
          await Promise.all([
            peerConnection.setLocalDescription({ type: "rollback" }),
            peerConnection.setRemoteDescription(new wrtc.RTCSessionDescription(data))
          ]);
        } else {
          await peerConnection.setRemoteDescription(new wrtc.RTCSessionDescription(data));
        }




        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        wsSignaling.send(JSON.stringify({
          channelId: currentChannel,
          to: from,
          from: peerId,
          type: "answer",
          sdp: answer.sdp,
        }));
      } else if (type === "answer") {

        if (peerConnections.has(from)) {
          const peerConnection = peerConnections.get(from);
          await peerConnection.setRemoteDescription(new wrtc.RTCSessionDescription(data));
        }
      } else if (type === "candidate") {
        await peerConnection.addIceCandidate(
          new wrtc.RTCIceCandidate(data.candidate),
        );
      }
    } else {
      console.error(to + "!=" + peerId);
    }
  } catch (error) {
    console.error("Error handling signaling message:", error);
  }
}

function createPeerConnection(targetPeerId: string) {
  const configuration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' }, // Google's public STUN server
      // Add TURN server configuration here if needed
    ]
  };
  const peerConnection = new wrtc.RTCPeerConnection(configuration);

  peerConnection.onicecandidate = (event) => {
    //console.log("ICE candidate", event.candidate);
    if (event.candidate) {
      wsSignaling.send(JSON.stringify({
        channelId: currentChannel,
        to: targetPeerId,
        from: peerId,
        type: "candidate",
        candidate: event.candidate,
      }));
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    console.log("ICE connection state changed to:", peerConnection.iceConnectionState);
  };

  peerConnection.onsignalingstatechange = () => {
    console.log("Signaling state changed to:", peerConnection.signalingState);
  };



  peerConnection.ondatachannel = (event: wrtc.RTCDataChannelEvent) => {
    console.log("ondatachannel event fired", event);
    setupDataChannel(targetPeerId, event.channel);
  };
  console.log("Created peer connection");
  peerConnections.set(targetPeerId, peerConnection);
  return peerConnection;
}

function setupDataChannel(targetPeerId: string, channel: wrtc.RTCDataChannel) {

  console.log(`Setting up data channel for peer ${targetPeerId}`);

  channel.onopen = () => {
    console.log(`Data channel opened with peer ${targetPeerId}`);
    sendMessage(targetPeerId, "Hello");
  };

  channel.onclose = () => {
    console.log(`Data channel closed with peer ${targetPeerId}`);
  };

  channel.onerror = (error) => {
    console.error(`Data channel error with peer ${targetPeerId}:`, error);
  };



  channel.onmessage = (event: MessageEvent) => {
    const eventData = JSON.parse(event.data);
    console.log(
      `Received WebRTC message from ${targetPeerId}:`,
      eventData,
    );
    if (eventData == "Hello") {
      return;
    } else {
      wsIPC.send(JSON.stringify({
        type: "webrtc_message_custom",
        rtcmessage: event.data,
      }));
    }
  };

  dataChannels.set(targetPeerId, channel);
}

async function createOffer(targetPeerId: string) {
  try {
    console.log(`Creating offer for peer ${targetPeerId}`);
    const peerConnection = peerConnections.get(targetPeerId) || createPeerConnection(targetPeerId);
    const dataChannel = peerConnection.createDataChannel("chat");
    console.log("Data channel initial state:", dataChannel.readyState);
    dataChannel.onopen = () => {
      console.log("Data channel state changed to:", dataChannel.readyState);
    };
    setupDataChannel(targetPeerId, dataChannel);

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);


    wsSignaling.send(JSON.stringify({
      channelId: currentChannel,
      to: targetPeerId,
      from: peerId,
      type: "offer",
      sdp: peerConnection.localDescription.sdp,
    }));
  } catch (error) {
    console.error("Error in createOffer:", error);
  }
}

function sendMessage(targetPeerId: string, message: string) {
  const dataChannel = dataChannels.get(targetPeerId);
  if (dataChannel && dataChannel.readyState === "open") {
    dataChannel.send(JSON.stringify(message));
    console.log(`Sent WebRTC message to ${targetPeerId}:`, message);
  } else {
    console.log(
      `Data channel not open with ${targetPeerId}. Cannot send message.`,
      message,
    );
  }
}

function queryDataPeers(CallbackReturnAddress: string, targetPeerId: string) {
  const dataChannel = dataChannels.get(targetPeerId);
  if (dataChannel && dataChannel.readyState === "open") {
    wsIPC.send(JSON.stringify({
      type: "query_dataPeersReturn",
      targetPeerId: CallbackReturnAddress,
      rtcmessage: true,
    }));
  } else {
    console.log(
      `Dataxxx channel not open with ${targetPeerId}. return false`,
    );
    wsIPC.send(JSON.stringify({
      type: "query_dataPeersReturn",
      targetPeerId: CallbackReturnAddress,
      rtcmessage: false,
    }));
  }
}
