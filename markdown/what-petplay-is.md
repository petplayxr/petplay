# What PetPlay is

## Origin

It started as "two people in VRChat should be able to share a text editor". That became an
XSOverlay clone with peer-to-peer primitives. Then, by traditional Finnish yak shaving, it became a
userspace OS/kernel whose basic unit of processing is the web-worker actor.

## What it is

- **A runtime of actors.** Web-worker actors are the unit of computation, and they're meant to live
  in transient, time-varying peer-to-peer graphs between people.
- **Modular at the level of an OS or a web browser.** WebXR, display capture, the keyboard and the
  wrist menu are modules. The desktop overlay is the first app built on it, not its identity.
- **Computationally transparent from the start.** Every actor is addressable, can be messaged and
  can be inspected while running. The agent REPL (`/registry`, `/message`, `/eval`) is that
  property showing through, not a debug add-on.

## An always-on service with clients

PetPlay is meant to run as an always-on service. The things that look like "the app" are its
clients:

- the SteamVR overlay,
- a desktop view or control surface,
- a headless agent client driving and capturing it.

Client and server blur once everything is an actor: a client is just actors that attach to the
graph, and a server is just actors that stay up. The service doesn't start and stop with
SteamVR. SteamVR attaching or detaching is a client coming or going.

It's VR-first, but nothing ties it to VR. Something like an ordinary remote-desktop app could be
built on the same pieces. This is another sense in which PetPlay is a userspace OS: a long-lived
substrate that outlives any one interface to it.

## Everything is a module

WebXR is a module, VRChat integration is a module, display capture is a module. A metaverse
client wouldn't be a rewrite. It would be the WebXR modules extended past the OS UX into worlds.
A planned direction (around 3.0) is good primitives for making an overlay part of an
external coordinate space, such as a VRChat world.

## A modular metaverse client where agents are first-class

Another way to see PetPlay: a highly modular metaverse client. Because everything is an
addressable actor, agent access isn't bolted on. An agent attaches to the graph the same way the
SteamVR overlay or a desktop view does, and gets the same view into it. A headless agent client
is a normal client.

There's deliberately no separate agent API (no MCP: it's too inflexible and complex). The
deeper reason is granularity. Something like "an agent's embodiment in a live, programmable 3D
space" is far too fine-grained to capture in an MCP tool list or any static API: whatever set of
calls you freeze, the next thing the agent wants to do falls between them. Agents
interface the usual way: message actors, and if something needs to be reusable, write an actor
and have the OS load it (`/create`). The interface is that everything is dynamic, like an OS.

Talking to an agent while in VR follows the same pattern. An `agent-viz` actor would be the
agent's presence in the scene: it shows the agent's text responses, and it draws a dynamic 3D
pointer at the thing being discussed ("do you mean this element?"). It's an ordinary actor the
agent loads. It builds on the same scene queries the playtest actors use, in reverse: instead of
reporting what the user points at, the agent points. This is the case that shows why a static API
can't work: the agent's embodiment is whatever code it loads into the scene.

Eventually PetPlay could substitute for something like
[eidoverse-worlds](https://github.com/anima-research/eidoverse-worlds) ("a shared, persistent
platform for people and AIs"). Eidoverse has a central Bun server that orders an append-only world
log and relays presence. Humans join from a three.js/WebGPU browser client, and agents join
through an MCPL server at conversational pace. PetPlay would reach a similar place from the other
direction: no central server, transient p2p actor graphs, and agents as actors rather than a
separate frontend.

## What it is not

- **Not just a desktop overlay.** The overlay is one app on the substrate.
- **Not a VR window manager** (StardustXR, Frametop, ...). PetPlay sits a layer below. Something
  like StardustXR could be a PetPlay module, the way the WebXR module is.
- **Not AardvarkXR or Exokit.** The goals are similarly broad, but PetPlay puts simplicity first.
- **Not a security or capability system.** There are no capability or permission primitives, and
  they're out of scope: deciding them now would constrain or overcomplicate the initial design.
  Traditional primitives also assume a fixed environment, while PetPlay is built around transient
  graphs. The trust boundary is whatever you sign up for: connecting to a specific person, a friend
  system, or whatever people build on top as an improvement.

## Simplicity, by example

There's no single yardstick. The choices show what it means:

- use r3f for interaction instead of building an interaction system;
- TypeScript, not C++;
- p2p actors instead of a massive architecture.

## Open by design

What happens to an actor's state when its peer leaves depends on the situation. Stageforge
offers snapshotting and other mechanisms, but there's no single correct answer, and the kernel
doesn't choose one.
