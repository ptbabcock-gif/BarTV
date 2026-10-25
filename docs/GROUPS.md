# Groups: rating together

A group gives several people one shared leaderboard. Everyone's venues, ratings and photos
sync to a small cloud database; the app stays offline-first, so you can rate in a basement
bar and it uploads when you're back on signal.

## One-time setup (about five minutes)

The app uses [Supabase](https://supabase.com) (free tier). You create the project so the data
is in your own account.

1. Sign up at https://supabase.com and click **New project**. Pick any name and region, set
   a database password (you won't need it again) and wait for it to finish provisioning.
2. In the left sidebar open **SQL Editor**, click **New query**, paste the whole contents of
   [`supabase/schema.sql`](../supabase/schema.sql) and click **Run**. It creates the tables,
   the join/create functions, the security rules and the photo bucket.
3. In the sidebar open **Authentication → Sign In / Providers**, find **Anonymous sign-ins**
   and turn it on. This is what lets friends join with just a name and no password.
4. In the sidebar open **Project Settings → API** (or **Data API**). Copy two values:
   the **Project URL** (looks like `https://abcdefgh.supabase.co`) and the **anon public** key
   (a long string starting with `eyJ`). The anon key is meant to be embedded in apps; the
   security rules from step 2 are what protect the data.
5. Put both into `src/config.js` and push. Every copy of the app served from that code can
   now create and join groups.

## Using it

- **Start a group:** Settings → Group → enter your name and a group name → Create. You get a
  six-letter code and a **Share invite** button that sends a link.
- **Join:** open the invite link (or Settings → Group → enter the code), type your name, done.
  Anything already on your phone is shared with the group when you join.
- Ratings show who made them. You can only edit or delete your own; anyone can add photos to
  a venue and fix its details.
- The chip in the top bar shows sync state: **Synced**, **Pending** (uploads waiting),
  **Offline**, or **Sync error** (tap it for details and a **Sync now** button).
- **Leave group** stops this phone syncing. Your copy stays on the phone; the group keeps
  what you shared.

## How it works

- `src/cloud.js` talks to Supabase's REST API with `fetch` (no SDK): anonymous auth with
  token refresh, table reads/upserts, the two RPC functions, and photo uploads to Storage.
- `src/sync.js` is the sync engine. Every local change goes into a persisted queue and is
  pushed when online. Pulls fetch rows with `updated_at` newer than the last sync, so they
  are cheap. Deletes are soft (`deleted_at`) so other phones learn about them. Photos are
  uploaded and their rows store public URLs instead of data URLs.
- Identity is a Supabase anonymous user stored on the device. It survives reloads and
  reinstalls that keep browser storage; a new phone means a new identity, so you'd rejoin
  with the code (your old ratings still show your name).
- Security (`supabase/schema.sql`): row-level security limits every table to members of the
  group; inserts must carry the caller's own user id; only the author can update their
  tastings and photos; venues can be edited by any member. Join codes are 6 characters from a
  32-symbol alphabet (about a billion combinations) and are only visible to members.

## Limits and ideas

- Supabase's free tier is generous for a group of friends (500 MB database, 1 GB storage).
  Photos are downscaled to about 720 px before upload.
- Rows are not pushed in real time; the app syncs on open, after each change, when it comes
  back online, and when you return to the tab. Supabase Realtime could make it instant.
- The `#/join/CODE` link works only on copies of the app configured with the same project.
