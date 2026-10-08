# Reading Quiz Live

A responsive English reading-comprehension quiz for classroom use. The UI includes student join/lobby/quiz/results views and a teacher dashboard with question editing, room controls, a leaderboard, and CSV export.

## Important: demo mode vs real multiplayer

- **Demo mode** runs without Supabase and is useful for previewing the interface and editing questions. It stores data in the browser's `localStorage`; it is **not** shared across different devices or browsers.
- **Real multiplayer** requires a Supabase project, the SQL schema, and the Edge Function. Configure `config.js` with your Supabase project URL and publishable/anon key.
- This starter includes server-side answer checking and score calculation. Before using it publicly, **add teacher authentication and authorization** for `create`, `start`, `next`, and `end` actions in `supabase/functions/quiz-api/index.ts`. As currently scaffolded, those teacher actions are not yet protected by an authenticated teacher identity. Do not use it for a public high-stakes event until that is implemented.
- For a robust production release, add rate limiting, room ownership, room expiration, and automated load testing.

## Files

- `index.html`, `style.css`, `app.js` — student app
- `teacher.html`, `teacher.js` — teacher dashboard
- `questions.js` — sample reading quiz content
- `config.js` — public Supabase URL and publishable/anon key
- `supabase-schema.sql` — database schema
- `supabase/functions/quiz-api/index.ts` — server-side API

## 1. Run the demo locally

The app uses JavaScript modules only through CDN scripts, so a simple local web server is recommended. Open a terminal in this folder and run:

```bash
python -m http.server 8080
```

Then open:
- Student page: `http://localhost:8080`
- Teacher page: `http://localhost:8080/teacher.html`

Demo mode uses the same browser's local storage. Open both pages in the same browser to try the basic flow. It does not sync between devices.

## 2. Configure Supabase

1. Create a project at https://supabase.com.
2. In **SQL Editor**, run all of `supabase-schema.sql`.
3. In **Project Settings → API**, copy the project URL and the publishable/anon key.
4. Put those values into `config.js`:

```js
window.QUIZ_CONFIG = {
  SUPABASE_URL: "https://YOUR_PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY"
};
```

The publishable/anon key is intended for frontend use with proper policies. Never put a `service_role` key in `config.js` or any browser file.

## 3. Deploy the Edge Function

Install the Supabase CLI and log in, then from the project folder:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy quiz-api
```

The Edge Function uses `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the server environment. Supabase supplies these to deployed functions. Never print or expose the service-role key.

### Before production

Implement teacher login and verify the authenticated user is the owner of the room before allowing `create`, `start`, `next`, and `end`. The provided endpoint marks this as a required hardening step. Also consider making room codes random, adding rate limits, and setting room expiry.

## 4. Publish on GitHub and Vercel

1. Create a GitHub repository.
2. Upload the project files, including the `supabase` folder.
3. Import the repository into https://vercel.com, or use GitHub Pages for static hosting.
4. If using GitHub Pages, open **Settings → Pages**, choose **Deploy from a branch**, select `main` and `/ (root)`.
5. `config.js` is a static public configuration file, so it must contain only the project URL and publishable/anon key, never a service-role key.
6. Deploy the Edge Function separately using the Supabase CLI.

## 5. Classroom use

1. Open `teacher.html`, edit questions, and create a room code.
2. Students open `index.html`, enter their nickname and the same room code.
3. Teacher starts the quiz and advances through questions.
4. Export the leaderboard to CSV at the end.

## Testing 50 participants

Start with 5–10 real devices and verify join, answer submission, duplicate-answer prevention, timer behavior, and final ranking. Then run a controlled load test against the deployed Edge Function and database. Do not assume the app has been validated for 50 simultaneous users until that test passes and your Supabase plan limits are checked.

## Known starter limitations

- Demo mode is local to one browser and is not a true multi-device multiplayer server.
- Supabase mode needs a production teacher-authentication gate before public use.
- Realtime channels are used for best-effort live notifications; clients also refresh session state periodically.
- The starter focuses on a single active room per teacher dashboard. For a larger deployment, add room ownership and a teacher session list.
