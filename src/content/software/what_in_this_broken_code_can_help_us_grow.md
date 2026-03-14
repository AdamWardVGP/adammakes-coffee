---
title: "What in This Broken Code Could Help Us Grow"
description: "Just because there's 0 bugs in your JIRA board doesn't mean your code isn't problematic."
date: 2026-03-07
---

There's a particular kind of broken that's hard to fix. Not the kind that throws exceptions or brings down prod. The kind that just... slows you down. Quietly. Consistently. Until one day someone looks at the DAU graph and asks why it's trending the wrong direction.

It didn't start that way, but it's one of the problems I found myself solving during my career.

---

## The System That Worked Until It Didn't

Before I joined, someone had built something genuinely clever. The app I worked on was content-heavy (music, artists, albums, discovery surfaces) and they needed a way to drive what showed up on screen without shipping a new client every time product had an idea. So they built a server-driven content system.

The server would respond with a document. The client would parse it. Layouts, links, content all specified server-side. The client's job was a boring front end left to just render what it was told.

For a while, this was great. Ship a new content experience? Update the server. No app release needed. For a mobile team in the early days of aggressive content iteration, that's a real win.

But systems have a way of calcifying around their original assumptions.

The client-side implementation had grown into nested XML parsers each bound to a Fragment. Each layout was essentially a hardcoded contract between a server document shape and a client rendering path. Adding a new layout meant touching both ends in a very specific, very fragile way. The content engine on the backend had its own complexity that made new layout support expensive to build and expensive to maintain.

So product and design would come with ideas. And we'd say: "that layout doesn't exist yet." And building it would take longer than anyone wanted. ideas would get scoped down or deferred indefinitely.

This was a slow painful realization that took us 3 years to see once I had joined.

When I looked at the codebase I didn't see a broken system. I saw a system that had been asked to do more than it was designed for, by people who wanted to grow a product, and it just... couldn't keep up.

The question I kept coming back to wasn't *how do we fix this*. It was: **what in this broken code could help us grow?**

---

## Rethinking the Contract

The old system's core assumption was: the server knows how to lay things out. That assumption made sense when layout flexibility was the goal. But it created a tight coupling between content structure and presentation that made both sides harder to change.

What if we inverted it?

What if the server's job was to say what content exists and who should see it and the client's job was to decide how to show it?

**That reframe changed everything.**

The server wouldn't send layout instructions anymore. It would send a manifest: an ordered list of content IDs, typed by content kind, filtered by user profile. The client already knew how to render every content type. That knowledge lived in a component registry on the client. So the client could receive a manifest, look up each content type, know exactly what data it needed to fetch, and go get it.

Product and design could now control what appears, in what order, for which users, and we got to keep the original benefit we wanted. Server side content without touching client code. AND now client could evolve its presentation of any content type independently without touching the server.

The coupling was gone.

**Old world:**
```
Server → [layout + content + order] → Client renders
```

**New world:**
```
Server → [content IDs + types + order] → Client resolves → Client fetches → Client renders
```

---

## The Architecture

Here's what the system actually looked like end to end.

### The Manifest

The server response wasn't a page. It was a description of a page and critically, **it was a tree**, not a list.

This is one constraint where the old system had quietly painted us into a corner. A flat list of content is easy to render but it only supports one kind of layout: top to bottom. Real screens aren't like that. 

- Sometimes you need a pinned top bar and a body. 
- Sometimes you want split screen. 
- Sometimes a designer wants a layout with independent scroll behaviors for different regions, or relational positioning between widgets that doesn't fit neatly into a linear sequence. 
- And if you want to sell dynamic ad placements to advertisers (which we did) you need to be able to say "this slot, in this position, in this region" without hardcoding it.

The server expressed hierarchy. A screen could be composed of multiple independent content trees. A split screen was two trees. A top bar with a scrolling body was two trees. Each tree had its own layout type, its own scroll behavior, its own content.

Something like:
```json
{
  "regions": [
    {
      "layoutType": "TOP_BAR",
      "nodes": [
        { "contentId": "artist_123", "contentType": "ARTIST_HERO" }
      ]
    },
    {
      "layoutType": "SCROLLABLE_BODY",
      "nodes": [
        { "contentId": "playlist_456", "contentType": "PLAYLIST_RAIL" },
        {
          "contentId": "station_789",
          "contentType": "STATION_CARD",
          "nodes": [
            { "contentId": "track_012", "contentType": "TRACK_ROW" }
          ]
        }
      ]
    }
  ]
}
```

The server controlled order, hierarchy, layout type, and inclusion - all filtered by user agent params, locale, feature flags, ad buy configuration. Local client logic could even apply a second pass to filter based on things we didn't want to pass over the wire - or retrieve data that didn't come from our servers.

### The Component Registry

The client maintained a registry mapping content type and layout type to specific rendering paths:

```kotlin
val registry = mapOf(
    RegistryKey(ContentType.ARTIST_HERO, LayoutType.TOP_BAR) to ArtistHeroTopBarComponent,
    RegistryKey(ContentType.PLAYLIST_RAIL, LayoutType.SCROLLABLE_BODY) to PlaylistRailBodyComponent,
    RegistryKey(ContentType.STATION_CARD, LayoutType.SCROLLABLE_BODY) to StationCardBodyComponent,
    // ...
)
```

This solved a problem we hadn't fully articulated before: in the old system, layout code was shared across contexts with unknown behavioral differences. Nobody knew which layouts appeared on which screens or how behaviors differed per screen. So engineers were afraid to modify **anything**. Touch one layout? You might break a screen you weren't thinking about, and you can't know because it's all dynamically decided on the server. You can't use "Find References" to save you. So little got changed and most product requests went nowhere.

With layout type as a first-class key in the registry, the blast radius of any change became knowable. A component for `ARTIST_HERO` in a `TOP_BAR` was explicitly different from the same content in a `SCROLLABLE_BODY`. Subviews could be shared across registry entries where it made sense, or isolated where it didn't. That choice was now deliberate rather than everywhere, all at once, cross your fingers and pray you don't break something somewhere you didn't look when you modified that one widget.

There was another thing the old system did that I haven't mentioned yet because it deserves its own moment of silence: it specified font sizes, text colors, and widget sizes from the server.

(**Dramatic pause**)

I understand the impulse. If the server controls layout, why not let it control presentation too? But on mobile, this is a trap. Nothing ever scaled properly across device sizes. You couldn't use platform-native widgets because their built-in behaviors (dynamic type, scaling, system color semantics) conflict with hardcoded server values. Every screen felt slightly off in a way that was hard to articulate but easy to feel. And every fix required a server change, a client change, and coordination so that they shipped together.

In the new system the server had no opinion about presentation. It said what content existed and where. The client decided how to render it, using platform conventions, native widgets, and its own design system. The server got out of the mobile rendering business entirely. Screens started feeling like they belonged on the platform they were running on.

### And now I'll pull a rabbit out of my hat too!
> aka You Don't Always Need a Server

One more thing worth saying explicitly: not every screen needs a manifest from a server.

Sometimes you just want a static screen. A settings page. An about screen. A one-time onboarding flow. In the old world, even these required coordination. A server engineer had to publish a stub document just so the client had something to parse. That's overhead for a screen that never changes.

Or, sometimes you know your own layout, it's constant, and you want to live blissfully in the evergreen fields of MVVM land like all the rest of the industry. You wish you could make a REST call to fetch data and then just emit from a flow to a composable. That would be the promised land and now it's not a dream, now that too is possible.

In the new system, the manifest was just a data structure. Nothing stopped the client from constructing one locally. If a screen didn't need dynamic content, you baked in a local registry and built the screen without touching the server at all. No coordination. No stub. No waiting.

That sounds small. It wasn't. It meant the client team could move independently on any surface that didn't genuinely need server-driven content. The server integration was opt-in, not mandatory, and it let us ship. Fast.

### The Dispatcher

This is where it got interesting.

Multiple independent content trees on the same screen meant multiple traversals — but the same content could appear in different regions and different trees. Fetching the same resource twice is wasteful. So as each tree was traversed, every component would attempt to register its required API call with the dispatcher. If a call for that resource already existed, it simply received a hook to the existing deferred. No duplicate request. No coordination logic scattered across ViewModels.

```
Manifest
├── Region: TOP_BAR (tree traversal)
│     └── ARTIST_HERO → register artist_123 fetch → Deferred A
│
└── Region: SCROLLABLE_BODY (tree traversal)
      ├── PLAYLIST_RAIL → register playlist_456 fetch → Deferred B
      └── STATION_CARD
            └── TRACK_ROW → register artist_123 fetch → Deferred A (already exists, reuse hook)

                 │
                 ▼
   ┌─────────────────────────────────┐
   │           Dispatcher            │
   │  deduplicates + fans out calls  │
   └──┬──────────────┬───────────────┘
      │              │
      ▼              ▼
  API Call A     API Call B
  (artist_123)  (playlist_456)
      │              │
      └──────┬───────┘
             ▼
      Deferred Results
      distributed to
        ViewModels
```

Each ViewModel subscribed to the results it cared about. If a view needed data from two different API calls, it joined its relevant deferreds. The view didn't care how many calls were made or in what order — it just awaited its data.

---

## Living With Two Systems

We couldn't migrate everything at once. Older clients were still in the wild hitting the old service. We couldn't force updates. So for a meaningful stretch of time, both systems ran in parallel.

Old screens called the old service. New screens used the new one. We migrated highest-traffic surfaces first; the places where content velocity mattered most and where the DAU signal would be clearest. The old system didn't need to change. It just needed to keep working, which it did.

There was no big bang cutover. Just a slow, deliberate transfer of surface area from one architecture to the other, one screen at a time.

```
Client
├── Screen A (legacy)  ──► Old Service
├── Screen B (legacy)  ──► Old Service
├── Screen C (new) ────► Manifest API ──► Dispatcher ──► APIs
└── Screen D (new) ────► Manifest API ──► Dispatcher ──► APIs
└── Screen E (new) ──► Direct API call
```

---

## The Part That Wasn't Technical

I want to be honest about something. The architecture was the easier part.

Before a line of this was written, I spent months on calls with people who had every reason to be skeptical. Product managers wondering why I'm burning time not shipping features. Backend engineers who were being asked to change how they thought about their API surface. Frontend client developers whose contracts with the server would shift. Leadership who needed to believe a few months of investment would reverse a trend line.

I wrote spec docs. I revised them based on feedback. I ran sessions to walk through the data flow. I designed the API contracts collaboratively, not unilaterally. I wanted to make sure that when we finally built it, nobody felt like it had been built at them.

I did all of this remotely, by the way. A distributed team, very few in a shared office. I mention this not to earn a badge but because I think it matters for a conversation the industry keeps having badly.

The problem was never remote work. The problem is silos. Silos are an organizational choice, not a geography and warm seat problem. When you silo teams in the name of efficiency you get local optimization and global fragility. On paper, it looks clean. In practice, it means nobody understands the system end to end, knowledge doesn't transfer, and the only person who can explain why something was built a certain way is the one person who built it. You're lucky if they're still around.

What made this architecture work wasn't that it was clever. It was that the people who had to live with it helped shape it. That process was slow and sometimes frustrating. But it's also why it worked. A system this distributed, configurable, with manifest server, component registry, dispatcher, multiple ViewModels, deduplication layer, parallel legacy support only holds together if everyone who touches it understands the intent behind it. You can't get that from a doc. You get it from the conversations that produce the doc.

Building trust is an investment. And like any investment, you have to know where to put it. I put it there because I believed the architecture could unlock something real. It did.

---

## What Actually Happened

After about a year of running the new system on our highest-traffic surfaces, product and design were shipping at a pace that hadn't been possible before. New content experiences that would have taken a month of coordination were out the door in weeks. Layouts that previously required client releases could be adjusted server-side, and client page redesigns that just modify content display could be done just on the client side.

And the DAU graph, which had been trending toward a cliff, started recovering.

That's not a coincidence. Content drives engagement. Engagement drives retention. Retention drives DAU. When you remove the friction between an idea and its execution, you compress the feedback loop between product intuition and user behavior. That compression is worth more than any individual feature.

---

## The Thing I Keep Coming Back To

The old system wasn't a failure. It was a success that had lived long enough to become a constraint. That happens to good systems. It will happen to the ones we're building now.

The question worth asking (especially when the complaints start coming in from a reluctant stakeholder that the timelines start slipping) isn't *how do we patch this*. It's: **what in this broken code could help us grow?**

Sometimes the answer is nothing. Rewrite and move on.

But sometimes the broken thing is pointing at exactly the problem the business most needs solved. And if you can see that, and earn the trust to act on it, you get to do the most satisfying thing an engineer can do: write code that changes a number that matters.

The architecture was the mechanism. A team with trust was the prerequisite. The DAU recovery was just proof that both were worth building.
