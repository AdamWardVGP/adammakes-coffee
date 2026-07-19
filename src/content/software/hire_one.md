---                                                                                                                                                                              
title: "Hire one. No PM. Port this 7-year-old iOS app to Android."                                                                                                         
description: "The most useful thing I did that year was not do that."
date: 2026-07-19
---        

# Hire one. No PM. Port this 7-year-old iOS app to Android.

That was the brief. Word for word.

Seven years of iOS made by a team of four iOS developers - none of them would help build it. The project was an enterprise drone platform linked to a photogrammetry pipeline, cloud sync, fleet metrics, eight flight plan modes, three auth services, preflight safety checks, the list goes on. And the target was roughly 90% parity. All of it on a controller six years behind modern hardware, too underpowered to run our own Maps SDK.

I was hire one. I had no product manager, no designers. I had no drone experience.

I also didn't build that app.

---

## The Question Nobody Had Asked

I was new, so I did what new people do: I talked to everyone. The iOS developers. The QA team. The drone testers out in the field.

One of the testers showed me something. A supporting product for another drone: a controller running an even older version of Android, talking to an iPad over WiFi, sending just enough data to fly the drone and monitor it.

That was it. Just: here's the drone state, here's what you can tell it to do.

And it clicked. The reason I'd been hired at all was that iOS couldn't talk to this hardware — the DJI controller ran Android, and the SDK lived there. Someone had to bridge the drone to the app, and the plan on the table was to translate seven years of iOS onto that Android controller as a second full app. But if Android already had to sit between the drone and everything else, why build a whole app instead of a thin translation layer?

I went back to my desk and asked the question I couldn't stop thinking about.

Why don't we build that instead?

Not the 90% parity app. Not N years of translating a seven-year iOS codebase onto underpowered hardware. Just Android as the translation layer between DJI and JSON. iOS keeps the brains, the front-end UI, the business logic, everything it had spent seven years getting right. Android becomes the hardware abstraction layer the iOS team never had to build.

The scope was completely different. The timeline was completely different. And it was weird.

---

## Where Do We Start?

As it turned out, on my interview day I'd walked past a developer from another company who was onsite doing consulting work. We'd shaken hands, and I'd completely failed to connect the dots about what he actually did. Luckily, when I first floated the idea of abstracting the DJI API, someone else connected them for me: the consultant I'd met was the person who'd built the very thing I wanted to copy.

That engineer had done this before, more than once. So we got on a video call.

The main question: how do we manage the traffic? The obvious modern default was gRPC. It's what you reach for: typed contracts, code generation, bidirectional streaming, a mature ecosystem. On paper, the responsible choice. Jonas talked me out of it.

gRPC is HTTP/2 and protobuf underneath, built around reliable, ordered streams. That's the wrong shape for this problem. Telemetry is high frequency and lossy by nature — an old packet is worse than no packet. It's a framework built to guarantee delivery and ordering instead of just serving packets. And while I'd have assumed TCP over WiFi would be good enough, it's a good thing we didn't bet on it: that traffic became a real problem later. I've got Wireshark logs and channel scans showing how congested a network can get on budget hardware. But we're getting ahead of ourselves.

There were other options like MQTT and RabbitMQ, but he had another up his sleeve: ZeroMQ. You get framing, routing, and packet-loss policies out of the box. Start there, and build the protocol yourself.

---

## Selling a Weird Idea

"Who builds their own protocol?" is a reasonable question when someone with zero drone experience and one month at the company walks into a room and suggests scrapping an entire project initiative.

The resistance wasn't just technical - it was reputational. A high-risk solution, with an unusual approach, from the brand-new hire.

So I didn't argue architecture. I argued timeline and evidence. Here's a product already running in the field. Here's roughly how it was built. Here's how long parity takes us the way we're currently planning it, and how much sooner we ship if we build the lean version instead.

Product owners and the head of mobile engineering signed off. Conditionally. First, prove it works.

---

## The Prototype Phase

Prototyping under organizational drag is its own skill.

Hardware procurement took seven months. Seven months to get the devices I needed to test the actual network topology. So I prototyped on what I had: emulators. I hit issues I didn't know existed and despite Stack Overflow's decline in usage I still hope [my last SO post](https://stackoverflow.com/questions/78209147/how-do-i-receive-tcp-messages-on-an-android-emulator-from-a-physcal-device) saves some future engineer the headache I went through. (I'm sure it's been scraped by an LLM already anyway.)

With everything in place, the data channel prototype came together over ZeroMQ. I could get two Android devices talking. In theory, this could work.

Device-to-device video streaming was harder. I spent real time learning C++, GStreamer, and Makefiles. The tutorials got me to "kind of working." I understood enough to know I didn't understand enough. Around then, the same developer got caught in a round of layoffs. Needless to say, we hired him and he brought his video streaming library with him. (Shoutout to Jonas for [Sambaza](https://github.com/Auterion/sambaza)!)

That's twice now the same person saved me months of wrong turns.

With those pieces in place, I set up some benchmarking to measure throughput for when I'd eventually get real hardware. Until then, I had the next piece to tackle: what's the shape of the protocol?

---

## The Design That Came Out of It

Fortunately, ZeroMQ has some of the best documentation I've encountered in my career. For someone with zero experience in protocol design, its tutorials actually walked me through a range of distributed network topologies, and strategies for stateful connections.

From there, the protocol design came together in about a month.

The core insight from Jonas: there are two fundamentally different kinds of data moving between controller and drone, and they need different transports.

Telemetry - position, altitude, battery, GPS signal — is high frequency, time-sensitive, and inherently lossy. An old packet is worse than no packet. You want the next one, not a retransmission of the stale one.

Commands - upload a mission, query the SD card, send return-to-home. Those have real consequences, and they need to arrive.

```
Telemetry:  UDP  →  pub/sub   →  fire and forget, newest wins
Commands:   TCP  →  req/rep   →  reliable, timeout-aware, RPC-style
```

Eventually we ran into a real problem: large file transfers over the req/rep socket were causing command timeouts. Downloading photos across the command socket meant losing the ping/pong heartbeat that ran over that same channel. So we added a third channel.

```
Data:       TCP  →  req/rep   →  large transfers
```

Splitting data transfer onto its own socket kept commands snappy and made timeouts meaningful again. A timeout on the command channel meant something was actually wrong, not just slow.

Chunked file transmission would have been nicer, but moving the traffic to its own port and letting the hardware soak up the bytes despite my short-sighted design meant we could keep moving. Sometimes you have to ship fast.

So what else was there?

We had a ping/pong heartbeat and we let req/rep commands stand in for it, so we weren't needlessly flooding the network.

With drones, we wanted to enforce that only one client could connect to and control a drone at a time. It was a decision that mattered more than I expected it to later.

The other must-have: versioning. While we were iterating, we needed to guarantee the client and server could actually talk, so the protocol carried a version. Two levels: semver for the app, and a strict version at the protocol level. No backward compatibility here, at least not in these early POCs, but if we needed it, we could add it.

On serialization: JSON. Simple, debuggable, cross-platform — and the readability made field debugging dramatically easier.

On service discovery: it's not the drone that announces itself, it's the Android embedded in the controller hardware. Discovery makes that presence legible to the rest of the system automatically. Beyond joining the network, customers never had to do anything to pair the devices.

ZeroMQ has one significant constraint: it's not thread-safe. That pushed me toward thread confinement and as it turned out a design I'd have wanted anyway.

The month before, I'd been building a game in Unreal Engine, and its blackboard AI pattern had stuck with me: a single loop that reads a set of states, makes decisions, and dispatches outcomes. That was exactly my problem. Managing the protocol and scaling its messages meant new inputs arriving constantly, and new strategies keyed off whatever data landed in a given loop. The pattern mapped almost perfectly onto pulling messages off sockets and managing a stateful connection.

It also made testing easy. Each strategy is isolated, handed an input context by the loop, so you can unit test it without ever spinning up the threading loop.

What it led to: the whole protocol layer runs on a single-threaded dispatcher. Read, update state, write outputs, reschedule. Jonas called it "the game loop." No shared mutable state. And because I knew this would eventually be ported to iOS, threading lives at the top of the stack, not inside the protocol. The internals stayed in common language primitives, so the port would be a consistent translation with each platform supplying its own threading model at the edge.

That last part mattered more than I realized at the time.

---

## The Protocol Held. The Field Didn't.

The protocol held. Everything around it was another story.

I expect errors. I design for them. To me, a timeout isn't a failure - it's the system being honest. You signal it, you surface it, and you recover from it. An error you can see is an error you can handle.

The testers didn't see it that way. They came from a hardware background, where an error is a fault: something is broken. So every time they saw "timeout," I got a new bug report. Neither of us was wrong we just had completely different mental models of what an error is. I'd built a system that told the truth about failure, and the people using it read that honesty as brokenness.

It wasn't until I saw a random field photo that I understood what was actually happening. Three testers, huddled together under a single tent for shade, RC antennas all pointed at each other. They weren't hitting protocol bugs. They were making too much noise for each other to hear over. The timeouts were real they were just reporting a problem at the physical layer, one below where everyone was looking.

The infrastructure had the same trick up its sleeve. Our deployment topology was drone controller ↔ portable device hotspot ↔ iOS device, and we'd assumed the hotspot in the middle infrastructure. It wasn't. It was a device running consumer WiFi hardware under RF conditions we hadn't tested. Intermittent failures looked like protocol bugs and were actually hotspot instability. Debugging "it works until it doesn't" in the field takes a while when you're looking at the wrong layer.

And the fixes weren't always mine to make. Spread the operators out, coordinate over radios, host the hotspot directly on the controller instead of relying on a cheap portable one, and - last resort - put up tents to separate the antennas and operators. All reasonable. Then we ran into organizational reality - Corporate didnt want to pay for the tents.

Some problems aren't engineering problems.

---

## What I'd Build Today

The iOS team ported the protocol layer in about three weeks. That wasn't luck. It was the threading boundary and the primitive-only API paying off exactly as intended. No ZeroMQ knowledge required. No threading model to reason about. Data in, data out, timeouts surfaced cleanly.

That port validated the design more than any internal review could have.

But I'd do it differently today.

KMP from day one. The iOS port in three weeks was a win. The iOS port being unnecessary would have been better. Kotlin Multiplatform would have meant adapting only the socket layer — JeroMQ on the JVM, a Swift wrapper over the C lib on iOS — and shipping everything above it once.

Kotlin-first API. Flows for telemetry. Suspending functions for req/rep. Structured concurrency instead of manual thread-boundary management at the app layer. The one-message-at-a-time restriction disappears. I'd probably keep a single loop reading sockets and dispatching, though not because ZeroMQ forced it, but because it's still a clean way to manage a stateful connection.

Open source. The developer who gave me thirty minutes of hard-earned advice probably saved me months of wrong turns. Twice. The least I can do is make the thing I built available to the next person staring at the same problem.

In my growing list of projects, I hope this one sees the light of day sometime.

---

## The Thing About Being New

There's a version of this story where I take the brief, open a ticket, and start translating iOS source code. It would have been reasonable. It's what was asked.

What I actually did was talk to people, pay attention, notice a pattern in a product we already used, and ask a question out loud that nobody else had asked yet.

I didn't have domain expertise. I didn't have organizational credibility. What I had was fresh eyes and no attachment to the way things had always been done.

The architecture is interesting. The protocol design held up. But the decision that made all of it possible wasn't a technical one it was asking "why don't we build this instead?" before writing a single line of code.

That question cost nothing. The answer changed the whole project.