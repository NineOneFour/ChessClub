# Private Chess Club

## Project Overview

Build a self-hosted, invite-only online chess clubhouse for my kids and their real-world friends.

This is **not a public chess platform** and should not be designed like one. Every user will be someone personally known to our family and intentionally invited to the server.

The goal is to give the kids a private place where they can:

- Play chess with their friends
- Hang out and chat
- Watch each other's games
- Have friendly competition
- Track how their chess is improving
- Receive useful post-game coaching
- Build confidence in their ability to play competitive chess

The application should feel more like a private chess club than a stripped-down version of Chess.com or Lichess.

---

# Core Principles

## Closed Community

There is no public component.

- No public registration
- No public matchmaking
- No strangers
- No public profiles
- No player discovery
- No global chat
- No external social features

Every member is intentionally invited by an administrator or parent.

The application can therefore assume that users are members of the same real-world social group.

## Fun First

This should not feel like school software.

Chess improvement is important, but the primary experience should be kids playing chess and hanging out with their friends.

## Improvement Over Competition

Competition is part of chess and should be encouraged, but the primary measurement should be:

> "How good am I becoming at chess?"

rather than:

> "How many times did I beat Timmy?"

---

# Expected Technology

Inspect neighboring projects before making final architectural, dependency, or styling decisions. Follow established conventions where appropriate.

The expected architecture is approximately:

- Next.js
- TypeScript
- PostgreSQL
- WebSockets or equivalent real-time communication
- Stockfish
- Mature open-source chess libraries

Investigate libraries such as:

- Chessground for the board UI
- Chessops or an equivalent TypeScript chess library
- Stockfish for engine analysis

Do **not** attempt to deploy or recreate the complete Lichess architecture.

Use mature open-source chess components where appropriate while keeping this application purpose-built and relatively small.

---

# User Model

There are three conceptual roles.

## Administrator

The server administrator has ultimate control over the private club.

The administrator can:

- Invite families
- Create/manage users
- Disable accounts
- Manage the club
- Review activity
- Moderate chat
- Manage application settings
- Manage parental permissions

## Parent

Parents manage their own children.

A parent should eventually be able to:

- Manage child accounts
- Review games
- Review chat
- View chess progress
- Configure child-specific permissions
- Control when their child can play
- Disable chat if necessary
- Manage profile settings

## Child

Children are the primary users.

Their experience should be deliberately simple:

- See who's online
- Chat with friends
- Challenge someone
- Play chess
- Watch games
- Review previous games
- See how they're improving
- Get post-game feedback

Avoid exposing administrative complexity in the child interface.

---

# Invitations

Registration is invitation-only.

There should be no signup page that allows arbitrary account creation.

Invitations should support:

- Single-use codes/links
- Expiration
- Revocation
- Association with the appropriate family/parent
- Administrative visibility

Users should not automatically receive the ability to invite additional people.

The administrator ultimately controls who belongs to the club.

---

# Clubhouse

The application's main screen should feel like walking into a small chess club.

A child should quickly be able to see:

- Who is online
- Who is currently playing
- Available challenges
- Club chat
- Recent games
- Their recent chess progress

The primary actions should be obvious:

**Play**

**Watch**

**Chat**

---

# Chess

Users should be able to play live standard chess against other members.

Initial functionality should include:

- Legal move validation
- Check
- Checkmate
- Stalemate
- Draw detection
- Draw offers
- Resignation
- Rematches
- Game clocks
- Multiple time controls
- Game history
- PGN storage/export
- Spectator mode

Game state must be authoritative on the server.

The client must never be trusted to determine legal moves, game results, clocks, or other authoritative game state.

---

# Real-Time Architecture

Chess, presence, chat, and spectating require real-time communication.

Use WebSockets or an equivalent technology for:

- Moves
- Clock synchronization
- Game status
- Player presence
- Challenges
- Chat
- Spectators

The architecture should tolerate temporary client disconnections without destroying the game.

A reconnecting player should be able to return to an active game.

---

# Spectating

Club members should be able to watch games between their friends.

Spectators should see:

- Live board state
- Moves
- Player names
- Player profiles
- Clocks
- Game status
- Game-room chat

Players and spectators must **not** have access to Stockfish evaluation during an active game.

Engine analysis happens only after the game is complete.

---

# Chat

Chat is a major feature rather than an afterthought.

The kids should be able to hang out while playing chess.

Initial chat contexts should include:

## Club Chat

A shared clubhouse conversation for everyone currently using the server.

## Game Chat

Conversation associated with a specific game.

Players and spectators can participate according to parental settings.

## Chat History

Messages should be retained.

Parents and administrators should be able to review chat history when necessary.

Because every user is a known real-world friend, extensive public-platform moderation systems are unnecessary.

Basic controls should still include:

- Parent disabling chat
- Administrator muting a user
- Administrator deleting inappropriate messages
- Chat history
- Basic rate limiting
- Input sanitization

Direct/private messaging is not required for MVP.

---

# Social Features

Because this is a closed group, a complicated friend-request system is unnecessary.

Everyone in the club can essentially be treated as belonging to the same social group.

Profiles can show:

- Display name
- Avatar
- Online status
- Current estimated chess strength
- Recent games
- Achievements
- Progress

Children should be able to challenge any other active child account unless restricted by parental settings.

---

# Chess Strength Rating

The primary displayed chess rating should **not** simply be traditional opponent-based Elo.

The goal is to estimate:

> "What rating level are you currently playing like?"

For example:

> **Estimated Playing Strength: 925**

Repeatedly beating the same weaker friend should not cause someone's rating to continually increase.

Instead, completed games should be analyzed using Stockfish to estimate the quality of chess the player is actually producing.

---

# Rating Analysis

Potential inputs include:

- Average centipawn loss
- Move accuracy
- Blunders
- Mistakes
- Inaccuracies
- Missed wins
- Tactical accuracy
- Material losses
- Opening quality
- Middlegame quality
- Endgame quality
- Conversion of winning positions
- Defense of difficult positions

Do not assume that average centipawn loss alone maps directly to player rating.

The rating estimator should be its own module/service so the algorithm can evolve independently.

Store the underlying game analysis so historical ratings can be recalculated as the algorithm improves.

---

# Rating Stability

The displayed rating should represent recent playing strength rather than one game's performance.

Initially investigate a rolling sample of approximately:

**10-20 meaningful games**

Recent games should carry more weight.

The system should account for unusual games such as:

- Very short games
- Opening traps
- Early resignations
- Opponent disconnects
- Games decided primarily by one catastrophic opponent blunder

One unusually strong game should not suddenly add hundreds of rating points.

One terrible game should not destroy a player's rating.

---

# Performance Rating vs Game Performance

Individual games can still receive an estimated performance.

Example:

> You played this game at approximately a 1,050 level.

But the player's profile might still show:

> Current Estimated Strength: 925

This allows children to recognize particularly strong performances without making their overall rating unstable.

---

# Skill Breakdown

Eventually, provide more information than a single rating.

Example:

## Estimated Playing Strength: 925

| Skill | Estimated Strength |
|---|---:|
| Opening | 875 |
| Tactics | 1,050 |
| Middlegame | 925 |
| Endgame | 825 |
| Defense | 950 |

This makes the rating useful as a learning tool.

Instead of merely saying:

> You're a 925 player.

The system can explain:

> Your tactics are already around the 1,000 level, but your endgames are holding your overall rating back.

Skill categories should be extensible.

---

# Stockfish Analysis

Every meaningful completed game should be eligible for Stockfish analysis.

Analysis should happen asynchronously.

Finishing a game must never require waiting for Stockfish.

Conceptually:

```text
Completed Game
      |
      v
Analysis Queue
      |
      v
Stockfish Worker
      |
      v
Structured Analysis
      |
      +------> Game Performance
      |
      +------> Playing Strength Estimator
      |
      +------> Skill Breakdown
      |
      +------> LLM Coach
```

The Stockfish worker should be isolated from the live game server so heavy analysis cannot interfere with active games.

---

# AI Chess Coach

Stockfish determines what happened.

The LLM explains it.

The LLM should **not** be trusted to independently evaluate chess positions when Stockfish data is available.

Provide the LLM with structured analysis and use it to produce understandable, age-appropriate coaching.

Example:

> **You played around the 950 level this game.**
>
> You did a really good job developing your pieces and keeping your king safe.
>
> Your biggest problem was leaving pieces undefended. You lost your rook on move 17 because it wasn't protected.
>
> Your tactics are currently stronger than your endgames, so working on basic rook endings would probably help you the most.

Feedback should identify:

- What the player did well
- What hurt them
- Important moments
- Patterns across recent games
- What they should practice next

Feedback should be encouraging without lying about performance.

---

# Progress

The application should make improvement obvious.

Track things such as:

- Estimated playing strength
- Rating history
- Individual game performance
- Games played
- Wins
- Losses
- Draws
- Accuracy
- Blunders
- Mistakes
- Tactical performance
- Opening performance
- Middlegame performance
- Endgame performance

A child should be able to look back several months and clearly see:

> "I used to play around 700 and now I'm playing around 900."

That visible improvement is one of the primary purposes of the rating system.

---

# Leaderboard

Friendly competition is appropriate and desirable.

Provide a simple club leaderboard based primarily on estimated playing strength.

Potential additional rankings:

- Current playing strength
- Most improved
- Best recent performance
- Games played
- Winning streaks

The leaderboard should exist without becoming the entire purpose of the application.

Personal progress should remain highly visible.

---

# Fun

The application should have personality.

Potential features include:

- Avatars
- Board themes
- Piece themes
- Achievements
- Reactions
- Rematches
- Challenges
- Winning streaks
- Friendly tournaments
- Club events
- Personal milestones

Achievements should reward more than winning.

Examples:

- First Checkmate
- First Draw
- 10 Games Played
- No Blunders
- Comeback Win
- Successful Promotion
- First Tournament
- 100 Rating Points Improved
- Five Games Without Hanging a Queen
- Won a Rook Endgame

Don't bury chess underneath excessive gamification.

The chess and social experience remain the point.

---

# Parental Controls

Parental controls should be useful without turning the application into enterprise identity management wearing a chess hat.

Parents should eventually be able to configure:

- Chat enabled/disabled
- Playing hours
- Account availability
- Spectator chat
- Profile customization

Parents should be able to review:

- Games
- Chat history
- Activity
- Chess progress

The administrator retains ultimate control over all accounts.

---

# Self-Hosting

The entire application should be self-hostable.

Prefer containerized services.

A likely architecture is:

```text
                 Reverse Proxy
                       |
                       v
                Next.js Application
                 /      |       \
                /       |        \
               v        v         v
         PostgreSQL  Realtime   Job Queue
                                |
                                v
                         Stockfish Worker
                                |
                                v
                           LLM Service
```

The core application must continue functioning if:

- Stockfish is temporarily unavailable
- Analysis is backed up
- The LLM is unavailable

AI analysis is an enhancement to chess, not a dependency for playing chess.

The LLM integration should be abstracted so either a hosted API or locally hosted model can be used later.

---

# Security Model

This application is a **closed, trusted social environment**, but normal application security still applies.

Implement:

- Invite-only registration
- Secure authentication
- Server-side authorization
- Parent/child relationships
- Role-based permissions
- Rate limiting
- Input validation
- Chat sanitization
- Secure session management
- Invitation expiration
- Administrative audit logging
- Minimal personal information collection

Do not build extensive public-platform abuse prevention systems unless a real need develops.

Never expose the application to arbitrary account creation.

---

# MVP

Keep the first version deliberately focused.

## Phase 1: Clubhouse

Implement:

1. Authentication
2. Administrator account
3. Parent accounts
4. Child accounts
5. Invitations
6. User profiles
7. Online presence
8. Club chat

## Phase 2: Chess

Implement:

1. Chess board
2. Server-side legal move validation
3. Live two-player games
4. Game clocks
5. Challenges
6. Resignation/draws
7. Reconnection
8. Game completion
9. Game history
10. PGN storage
11. Spectator mode
12. Game-room chat

At this point the core experience should work:

> A kid logs in, sees their friends, chats with them, challenges someone to chess, plays a complete game while other friends watch, and can review the game afterward.

## Phase 3: Analysis

Add:

1. Stockfish worker
2. Analysis queue
3. Per-move analysis
4. Mistake/blunder detection
5. Game performance estimates
6. Historical analysis storage
7. Initial playing-strength estimator
8. Rating history

## Phase 4: Coaching

Add:

1. LLM integration
2. Post-game summaries
3. Strength identification
4. Weakness identification
5. Practice recommendations
6. Multi-game trend analysis
7. Skill breakdowns

## Phase 5: Fun

Add:

1. Achievements
2. Board customization
3. Piece customization
4. Reactions
5. Club leaderboard
6. Tournaments
7. Additional statistics
8. Other social features that emerge naturally from actual use

---

# Definition of Success

The project succeeds when the kids voluntarily use it because their friends are there and chess is fun.

The technology should support that rather than become the point of the application.

The long-term experience should combine:

### Play

Play real chess against real friends.

### Hang Out

Chat, joke around, watch games, challenge each other, and spend time together.

### Improve

Use Stockfish analysis to understand what each player is actually doing well and poorly.

### Measure

Estimate the level of chess each child is currently playing rather than simply measuring who they beat.

### Build Confidence

Give them concrete evidence that they're improving so walking into a real chess tournament feels exciting rather than intimidating.

This is ultimately a **self-hosted digital chess clubhouse for a small group of real-world friends**, with serious chess analysis quietly running underneath the fun.